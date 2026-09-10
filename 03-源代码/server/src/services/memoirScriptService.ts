/**
 * 回忆录分镜脚本生成器（回忆录 2.0 M1 模块）
 * 职责：调用 DeepSeek 生成结构化分镜脚本（CREST 叙事 + Seedance 2.5 prompt contract）
 *
 * 方法论来源（已吸收最新版）：
 * - OpenMontage Seedance 2.5 技能（十段 prompt contract + Locks 连续性锁）
 * - OpenMontage Storytelling（Anti-Subjective 规则：写情绪的视觉成因，不写情绪词）
 * - 《回忆录2.0-设计规格-2026-08-22.md》§4（本模块的实现依据）
 *
 * 安全/健壮性：
 * - LLM 输出必须过 zod 校验，失败自动重试（最多 2 次重试）
 * - 全部失败用内置兜底模板，保证功能可用（质量降级但不断服）
 * - 输入不包含密钥，日志脱敏
 */
import { chat } from './aiService.js';
import {
  MemoirScriptSchema,
  type MemoirScript,
  type MemoirSegmentScript,
} from '../schemas/memoirScript.js';
import { petSubjectText, translatePetNames } from './petPrompt.js';
// 档位照片数校验复用 videoGenerationService 的既有实现（其边界取自 config.ts 的 MEMOIR_TIER_CONFIG）
import { validateTierPhotoCount } from './videoGenerationService.js';
import type { MemoirTier } from '../config.js';

/** 产品线类型（与 videoGenerationService 保持一致） */
export type MemoirProductLine = 'daily' | 'memorial';

/** 分镜生成输入（由 memoirProcessor 在生成视频前调用） */
export interface MemoirScriptInput {
  /** 宠物档案关键字段（来自 pet_profiles 表） */
  petProfile: {
    name: string;
    species: string;
    breed: string;
    gender?: string | null;
    birth_date?: string | null;
    notes?: string | null;
    is_deceased?: boolean;
  };
  /** AI 记忆摘要（memory-body 生成，可空） */
  memorySummary?: string;
  /** 照片数量（决定镜头数） */
  photoCount: number;
  /**
   * 回忆录档位（light 1-3 / standard 5-7 / full 8-15）
   *
   * 为什么必须传：照片数边界属**档位**（唯一事实源 config.ts 的 MEMOIR_TIER_CONFIG），
   * 而产品线是多对一的（standard 与 full 共用 memorial 线），按产品线校验必然挡住其中一档。
   * 2026-09-11 修复的标准档无法支付事故，根因就是这里只按产品线校验。
   */
  tier: MemoirTier;
  /** 产品线：纪念Vlog / 日常回忆录 */
  productLine: MemoirProductLine;
  /** 目标时长（秒） */
  targetDuration: number;
  /** 用户写的回忆文字（可空） */
  sourceText?: string | null;
  /** 用户选择的音乐风格（可空） */
  musicStyle?: string | null;
  /** 用户选择的画风/氛围预设（可空；2026-09-09 画风选择，注入 GLOBAL STYLE） */
  stylePreset?: string | null;
  /** 每张照片的可见事实摘要（与 source_photos 顺序一致；识别失败可为空） */
  photoDescriptions?: string[];
}

/** 画风预设 → GLOBAL STYLE 质感描述（2026-09-09；与前端画风选项对齐，注入分镜 prompt） */
const STYLE_PRESET_HINTS: Record<string, string> = {
  cinematic: '电影叙事质感：电影级运镜感、电影调色、浅景深、画面有层次与故事张力',
  anime: '动画风：二次元温馨插画质感，柔和色板、干净线条、治愈系氛围（与"写实"相悖时以画风为准）',
  realistic: '写实记录风：纪实照片级质感、自然光、真实色彩、无滤镜感，突出真实与陪伴',
  warmheal: '温暖治愈风：柔和暖色调、逆光柔光、低对比、给人抚慰与治愈感',
};

/**
 * 产品线元信息（**仅**用于提示词与展示：标签 / 时长文案 / 情感曲线）
 *
 * ⚠️ 照片数量边界**不在这里，也不要加回来**：
 * 边界属于「档位」，唯一事实源是 config.ts 的 MEMOIR_TIER_CONFIG；
 * 而产品线与档位是多对一（standard 与 full 共用 memorial 线），
 * 一旦把某一档的边界写到产品线上，另一档必然被挡住。
 * 2026-09-11 事故正是如此：memorial 曾写死 minPhotos: 8（完整档门槛），
 * 导致标准档 5-7 张在预览阶段直接抛错 → 剧本确认闸门打不开 → 支付按钮永久不可用。
 * 校验照片数请用 validateTierPhotoCount(tier, count)。
 */
const PRODUCT_LINE_META: Record<
  MemoirProductLine,
  { label: string; durationText: string; curve: string }
> = {
  memorial: {
    label: '纪念Vlog',
    durationText: '60-90秒',
    curve: 'CREST六段式：背景→铺垫→冲突→留白→释怀→主题',
  },
  daily: {
    label: '日常回忆录',
    durationText: '5-30秒',
    curve: '温暖片段：一个完整的小情绪弧线',
  },
};

/** 最大尝试次数（1 次正常 + 2 次重试） */
const MAX_ATTEMPTS = 3;

/** 分镜生成参数（chat 调用配置） */
const SCRIPT_CHAT_OPTIONS = {
  temperature: 0.8, // 创意生成需要一定随机性
  // 纪念线最多 15 镜，升级后的十段 prompt 信息更完整；保留足够 JSON 输出空间，避免末段截断重试。
  max_tokens: 8000,
  // 关闭思考模式：否则 reasoning_content 会吃掉 max_tokens，导致 content 为空/JSON 截断
  thinking: 'disabled' as const,
} as const;

/**
 * 构建导演系统提示词
 * 核心规则：Anti-Subjective（写视觉成因）、身份锚点、CREST 情感曲线、Seedance 2.5 十段结构
 * @returns 系统提示词（不随输入变化，可缓存）
 */
function buildSystemPrompt(): string {
  return `你是一位宠物纪念视频导演兼编剧。根据素材为一个宠物家庭生成情感克制的分镜脚本。
禁止煽情过度、禁止虚构不存在的经历，只能基于素材合理延展氛围。

【产品线说明】
- 纪念Vlog：60-90秒，CREST六段式（背景→铺垫→冲突→留白→释怀→主题）
- 日常回忆录：5-30秒，温暖片段

【硬性要求】
1. 严格输出 JSON（结构见下），不要输出任何其他文字。
2. Anti-Subjective 规则（最重要）：描述"情绪的视觉成因"，禁止用主观情绪词。
   例：不写"氛围温馨感人"，写"黄昏暖光从窗台洒入，猫在光斑里眯眼"；
   不写"悲伤的回忆"，写"空了的猫窝，窗帘被风轻轻吹动"。
   旁白和 prompt 都必须遵守：每个情绪点都要对应一个看得见的具体画面。
3. 提示词安全红线：宠物名字仅可用于 title/narration/subtitle 等给人看的文案，绝不能写进 anchors.desc 或 seedance_prompt。
   CHARACTERS 与 Shot 中只能用“参考图中的宠物”“这只猫咪/狗狗”或毛色、花纹、体型、五官等外貌指代。
4. 角色锚点（anchors，多宠物/多人场景核心）：照片里**每一个需要保持一致的在场角色**（宠物和人）各提取
   3-6 个"能一眼认出它/他/她"的物理特征（宠物：毛色/花纹/体型/五官/特殊标记；人：发型/身高体型/服装/眼镜
   等稳定特征，不用表情），写进 JSON 顶部的 anchors 数组（每项 {id, type: pet/human, desc}）。
   每个锚点的 desc 在它出现的每一镜 seedance_prompt 里**逐字重复**（Seedance 一致性核心）。
   每镜的 characters_present 声明本镜在场角色 id（这镜只有猫就只写猫的 id）。
5. 每镜 seedance_prompt 用中文，按十段结构组装：
   GLOBAL STYLE（题材、写实质感、统一调色、画质与严格排除）
   → SCENE（一句话概述主体+地点+事件）→ CHARACTERS（参考图+本镜在场角色锚点逐字重复）
   → LOCATION（只写对应照片可见的空间、前中后景和关键道具）→ FIRST FRAME（按参考照片原始构图）
   → Shot 1（景别+一种运镜+主体微动作+相对节奏词）→ OPTICS（焦段/机位/景深）
   → PHYSICS（毛发、耳朵、胡须、尾巴、衣角等低缓连续物理细节）
   → LIGHTING（单一主光源、方向与色温）→ AUDIO（用<>标环境音；无对白、无模型字幕、无模型BGM）。
6. 官方工程型公式必须完整：精准主体 + 动作细节 + 场景环境 + 光影色调 + 镜头运镜 + 视觉风格 + 画质 + 约束条件。
   GLOBAL STYLE 必须包含“写实照片级质感、电影质感、色彩自然、细节丰富”，并排除黑白、手绘、插画、动画、塑料CG。
   每镜只用一种运镜，从缓慢推镜/平稳横移/固定机位轻微漂移/轨道推进/缓慢上摇中选择；不要同镜堆叠推拉摇移。
7. 动作只写照片中可见姿态能自然延续的低缓微动作，并写清幅度与速度；例如缓慢眨眼、耳朵轻转、尾巴尖小幅摆动、胸腹轻微呼吸。
   禁止凭空让静卧宠物奔跑、跳跃、转身，禁止增加照片中不存在的互动；前后动作使用“缓慢、随后、片刻后、轻轻”等相对节奏词，不写硬时间戳。
8. 旁白文案：口语化、克制、有画面感，每镜 1-2 句话（20-50 字），
   写具体细节，避免“永远爱你”式空话。字幕短句（≤15 字），可含时间节点。
9. 情感曲线遵循产品线说明：开头平静留白，中段温暖回忆，转折点到为止，不渲染痛苦，结尾释怀与感激。
10. **结尾全家福镜头（必须）**：最后一镜使用角色最多的照片，并标记 source="static_photo"；
    只做缓慢推近或拉远，旁白写“一家人/一大家子在一起”的释怀收尾。若所有照片都是单角色，则最后一张也使用 static_photo 温暖收尾。
11. 避免：同镜超过 3 个动作、可读文字/模型字幕/logo/水印、冲突光线、肢体畸形、额外四肢、主体复制和镜面倒影。

【记忆锚定规则（防编造，优先级仅次于安全红线）】
- 分镜叙事（SCENE 的具体事件、narration、subtitle）只能以【记忆摘要】【用户文案】【逐张照片视觉摘要】为事实来源。
- 素材里出现的具体回忆（如"到家的那天""最爱的玩具""某次生病""陪你去过草地"）必须优先写进对应分镜的旁白，形成真实回忆感；素材为空时禁止虚构任何具体事件、具体日期、对话与人物关系。
- 照片可见事实与记忆文本冲突时，以照片为准（照片是首帧权威），记忆文本只用于旁白情感层。
- 通用中性描写（光线、季节感、天气、陪伴氛围）不在此限，可以自由使用。

【输出 JSON 结构】
{
  "title": "视频标题（≤30字）",
  "theme": "主题词（≤15字）",
  "emotion_curve": ["calm","memory","pain","relief","lingering"],
  "narration_voice": "zh_female_vv_uranus_bigtts",
  "music_mood": "nostalgic 或 warm/piano/gentle/bright",
  "anchors": [
    {"id": "doubao", "type": "pet", "desc": "橘色短毛猫，白色胸脯，右耳缺一小角，绿眼睛"},
    {"id": "mama", "type": "human", "desc": "女性，长发，米色毛衣，圆框眼镜"}
  ],
  "segments": [
    {
      "photo_index": 0,
      "shot_type": "push_in 或 pan_left/tilt_up/zoom_slow/static_drift/dolly_in",
      "camera": "close_up 或 medium/wide/over_shoulder",
      "lighting": "golden_hour 或 soft_afternoon/warm_indoor/moonlight",
      "transition": "revealing 或 disappearing/switching/cut",
      "atmosphere": "氛围（供理解，不进prompt）",
      "characters_present": ["doubao", "mama"],
      "duration_sec": 5,
      "seedance_prompt": "完整十段中文提示词（CHARACTERS 段含本镜在场锚点逐字重复）",
      "narration": "旁白文案",
      "subtitle": "字幕",
      "music_mood": "本镜音乐情绪（可省略）"
    }
  ]
}`;
}

/**
 * 构建用户上下文（素材描述）
 * @param input - 分镜生成输入
 * @returns 用户消息内容
 */
function buildUserContext(input: MemoirScriptInput): string {
  const {
    petProfile,
    memorySummary,
    photoCount,
    productLine,
    targetDuration,
    sourceText,
    musicStyle,
    stylePreset,
    photoDescriptions,
  } = input;
  const meta = PRODUCT_LINE_META[productLine];

  // 宠物档案描述
  const genderText =
    petProfile.gender === 'male' ? '公' : petProfile.gender === 'female' ? '母' : '';
  const ageText = petProfile.birth_date
    ? `（出生日期 ${petProfile.birth_date}）`
    : '';
  const deceasedText = petProfile.is_deceased ? '（已离世）' : '';

  // 视觉摘要是分镜唯一可依赖的照片内容事实；缺失时明确要求模型保守处理，避免凭空编剧情。
  const photoText = `${photoCount} 张照片，按时间排序`;
  const photoContext = photoDescriptions?.length
    ? `【逐张照片视觉摘要】\n${photoDescriptions.slice(0, photoCount).join('\n')}\n` +
      '严格按 photo_index 一一对应：不得把照片2的动作或场景写入照片1对应分镜；摘要未识别时只做轻微镜头运动，不新增动作或场景。'
    : '【逐张照片视觉摘要】（未提供；每镜只允许保持参考照片原始主体、姿态、场景与构图，并做低缓微动作）';

  // 记忆依据分级（防编造核心）：有真实回忆 → 叙事锚定素材；记忆与自述全空 → 明示只许照片事实与中性叙事。
  // 注意：【无记忆约束】仅在记忆与用户自述"双双为空"时输出——自述本身也是真实素材，
  // 若只缺记忆引擎数据就宣布"没有任何素材"，会与【用户文案（真实回忆）】段自相矛盾。
  const hasMemory = Boolean(memorySummary && memorySummary.trim());
  const hasSourceText = Boolean(sourceText && sourceText.trim());
  const memoryContext = hasMemory
    ? `【记忆摘要（用户在小程序中沉淀的真实回忆，叙事必须优先锚定其中的具体事件）】\n${memorySummary?.trim()}`
    : hasSourceText
      ? '【记忆摘要】（暂无；叙事以【用户文案】与照片可见事实为准，不得凭空补充记忆里没有的事件）'
      : '【记忆摘要】（暂无）\n【无记忆约束】当前没有任何用户真实回忆素材：分镜与旁白只允许描述照片可见事实与中性通用氛围（光线、季节感、陪伴感），禁止虚构具体事件、具体日期、人物对话与关系（如"第一次到家""最爱的玩具""那次生病"均不得出现）。';

  // 用户自述与记忆同为真实素材；无自述时不得引导模型"合理构思"（等于邀请编造）。
  const sourceTextContext = sourceText && sourceText.trim()
    ? `【用户文案（用户亲述的真实回忆，旁白叙事的核心依据，事件细节以此为准）】\n${sourceText.trim()}`
    : '【用户文案】（无；旁白只允许从记忆摘要与照片可见事实取材，不得虚构具体事件）';

  return `【宠物档案】${petProfile.species === 'cat' ? '猫' : petProfile.species === 'dog' ? '狗' : petProfile.species}，
品种 ${petProfile.breed}，${genderText}${ageText}，名字「${petProfile.name}」${deceasedText}
${petProfile.notes ? `档案备注：${petProfile.notes}` : ''}

${memoryContext}

${sourceTextContext}

【照片信息】${photoText}
${photoContext}

【产品线】${meta.label}（${meta.durationText}），情感曲线：${meta.curve}
目标时长：${targetDuration} 秒${musicStyle ? `，音乐风格偏好：${musicStyle}` : ''}
${stylePreset && STYLE_PRESET_HINTS[stylePreset] ? `\n【画风要求】整体采用「${STYLE_PRESET_HINTS[stylePreset]}」：每镜 GLOBAL STYLE 的质感/调色/氛围以此画风为准（与"写实照片级"冲突时以此画风优先，但保持主体真实、不畸形）。` : ''}
${petProfile.is_deceased ? '\n【基调要求】这是对已故宠物的纪念：请用克制、温暖、释怀的基调（F7），不渲染痛苦、不假装它还活着，旁白强调"回忆与感激"，如"它还在我们的记忆里晒太阳"。' : ''}`;
}

/**
 * 从 LLM 回复中提取 JSON 文本
 * 兼容 markdown 代码块包裹、前后杂音等常见情况
 * @param raw - LLM 原始回复
 * @returns 提取到的 JSON 字符串（失败返回原文本）
 */
function extractJson(raw: string): string {
  // 去掉 ```json ... ``` / ``` ... ``` 代码块包裹
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) return fence[1].trim();
  // 直接截取第一个 { 到最后一个 }（容忍前后杂音）
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start >= 0 && end > start) return raw.slice(start, end + 1);
  return raw.trim();
}

/**
 * 清洗仅供 Seedance 消费的身份与画面提示词，阻止宠物名字泄漏给生成模型。
 * 标题、旁白、字幕仍保留名字，因为它们是展示给用户的正常文案，不参与画面生成。
 * @param script - 已通过 zod 校验的分镜脚本
 * @param input - 当前宠物档案，用于名字到外貌指代的安全转译
 * @returns 仅 anchors/identity_anchor/seedance_prompt 被清洗的新脚本
 */
export function sanitizeMemoirScriptPrompts(
  script: MemoirScript,
  input: MemoirScriptInput,
): MemoirScript {
  const pets = [{
    name: input.petProfile.name,
    breed: input.petProfile.breed,
    species: input.petProfile.species,
  }];
  /** 清洗单行锚点控制字符后，把已知名字替换为不含名字的外貌指代。 */
  const cleanInline = (text: string, maxLength: number): string =>
    translatePetNames(text.replace(/[\r\n\t]+/g, ' ').replace(/ {2,}/g, ' ').trim(), pets)
      .slice(0, maxLength);
  /** Seedance 十段结构依赖换行识别段落，因此仅移除制表符并保留换行。 */
  const cleanPrompt = (text: string, maxLength: number): string =>
    translatePetNames(text.replace(/\r\n?/g, '\n').replace(/\t+/g, ' ').trim(), pets)
      .slice(0, maxLength);

  /** 宠物名字不得残留在任何生成字段；异常长文本也必须有安全外貌兜底。 */
  const safePetAnchor = (text: string): string => {
    const cleaned = cleanInline(text, 150);
    return cleaned.length >= 4
      ? cleaned
      : petSubjectText(input.petProfile.breed, input.petProfile.species).replace(/^一只/, '');
  };

  return {
    ...script,
    identity_anchor: script.identity_anchor
      ? safePetAnchor(script.identity_anchor).slice(0, 120)
      : script.identity_anchor,
    anchors: script.anchors?.map((anchor) => ({
      ...anchor,
      desc: anchor.type === 'pet'
        ? safePetAnchor(anchor.desc)
        : cleanInline(anchor.desc, 150),
    })),
    segments: script.segments.map((segment) => ({
      ...segment,
      seedance_prompt: cleanPrompt(segment.seedance_prompt, 1500),
    })),
  };
}

/**
 * 修正分镜脚本（LLM 输出校验通过后的规范化）
 * - segments 数量对齐照片数（多了截断、少了补最后一张的复刻）
 * - 每镜时长修正到 3-8 秒
 * - 总时长按产品线缩放（在 3-8 秒约束内尽量贴近目标）
 * @param script - zod 校验通过的脚本
 * @param input - 原始输入（照片数/产品线/目标时长）
 * @returns 修正后的脚本
 */
function normalizeScript(script: MemoirScript, input: MemoirScriptInput): MemoirScript {
  const { photoCount, productLine, targetDuration } = input;
  const meta = PRODUCT_LINE_META[productLine];

  // 0. 角色锚点归一化：优先 anchors（多角色）；旧脚本只有 identity_anchor 时转成单个 pet 锚点
  let anchors = script.anchors;
  if (!anchors || anchors.length === 0) {
    const legacy = script.identity_anchor?.trim();
    if (legacy) {
      anchors = [{ id: 'pet1', type: 'pet', desc: legacy }];
    } else {
      // 都没有 → 用宠物档案兜底（保证锚点存在）
      // 名字绝不进入身份锚点；无视觉锚点时只使用经过品种兜底清洗的主体描述。
      anchors = [{
        id: 'pet1',
        type: 'pet',
        desc: petSubjectText(input.petProfile.breed, input.petProfile.species).replace(/^一只/, ''),
      }];
    }
  }

  // 1. segments 数量对齐照片数
  let segments: MemoirSegmentScript[] = script.segments.slice(0, photoCount);
  // 照片数多于 LLM 输出的镜数时，用最后一镜的样式补足（保证每张照片都有镜头）
  while (segments.length < photoCount && segments.length > 0) {
    const last = segments[segments.length - 1];
    segments.push({
      ...last,
      photo_index: segments.length,
      duration_sec: Math.min(last.duration_sec, 8),
    });
  }

  // 2. 每镜时长修正到 3-8 秒
  segments = segments.map((seg) => ({
    ...seg,
    duration_sec: Math.min(8, Math.max(3, Math.round(seg.duration_sec))),
  }));

  // 3. 总时长按产品线缩放（3-8 秒约束内尽量贴近目标时长）
  const currentTotal = segments.reduce((sum, seg) => sum + seg.duration_sec, 0);
  if (currentTotal > 0 && segments.length > 0) {
    // 目标每镜时长（clamp 3-8）
    const targetPerSeg = Math.min(8, Math.max(3, Math.round(targetDuration / segments.length)));
    segments = segments.map((seg) => ({ ...seg, duration_sec: targetPerSeg }));
    // 如果还有剩余时长空间且允许，给第一镜加时长（累计到上限）
    const newTotal = segments.reduce((sum, seg) => sum + seg.duration_sec, 0);
    if (newTotal < targetDuration && targetPerSeg < 8 && segments.length > 0) {
      const headroom = Math.min(8 - targetPerSeg, targetDuration - newTotal);
      if (headroom >= 1) {
        segments[0] = { ...segments[0], duration_sec: segments[0].duration_sec + headroom };
      }
    }
  }

  // 4. 按 photo_index 排序，并强制重分配下标（防 LLM 输出重复/乱序 photo_index 导致取错照片）
  segments.sort((a, b) => a.photo_index - b.photo_index);
  segments = segments.map((seg, i) => ({ ...seg, photo_index: i }));

  return sanitizeMemoirScriptPrompts({ ...script, anchors, segments }, input);
}

/**
 * 内置兜底分镜模板（LLM 连续失败时使用，保证功能可用）
 * 基于产品线生成基础分镜：纪念=CREST 六段式，日常=温暖单镜/双镜
 * @param input - 分镜生成输入
 * @returns 基础分镜脚本
 */
function fallbackTemplate(input: MemoirScriptInput): MemoirScript {
  const { petProfile, photoCount, productLine, targetDuration, musicStyle } = input;
  // 兜底锚点只描述品种与物种，绝不把名字交给视频生成模型。
  const anchor = petSubjectText(petProfile.breed, petProfile.species).replace(/^一只/, '');

  // 按情感曲线给每镜分配情绪与基础 prompt（纪念用 CREST，日常用温暖）
  // 注意：这里是情感名（calm/memory/pain...），不是转场原语
  const emotionCycle: ReadonlyArray<'calm' | 'memory' | 'pain' | 'relief' | 'lingering'> =
    productLine === 'memorial'
      ? ['calm', 'calm', 'memory', 'memory', 'pain', 'relief', 'relief', 'lingering']
      : ['calm'];

  const lightingCycle: MemoirSegmentScript['lighting'][] = [
    'golden_hour',
    'soft_afternoon',
    'warm_indoor',
    'moonlight',
  ];

  const perSegDuration = Math.min(8, Math.max(3, Math.round(targetDuration / Math.max(1, photoCount))));

  const segments: MemoirSegmentScript[] = Array.from({ length: Math.max(1, photoCount) }, (_, i) => {
    const emotion = emotionCycle[i % emotionCycle.length] ?? 'calm';
    const lighting = lightingCycle[i % lightingCycle.length] ?? 'golden_hour';
    // 十段结构简化模板（身份锚点用占位，M2 会强制注入）
    const prompt = `GLOBAL STYLE：写实照片级质感，电影质感，色彩自然，细节丰富，柔和暖调；严格排除黑白、手绘、插画、动画与塑料CG；避免生成任何文字或字幕、logo、水印。
SCENE：参考照片中的宠物保持原始姿态，呈现${emotion === 'pain' ? '短暂停顿的安静片刻' : '自然日常片刻'}。
CHARACTERS：宠物=参考图1（${anchor}），毛色、花纹、体型与五官保持一致。
LOCATION：严格保持参考照片原始场景、道具、空间关系与构图，不新增物体。
FIRST FRAME：沿用参考照片原始景别与主体位置，保持首帧稳定。
Shot 1（${i === 0 ? 'wide' : 'close_up'}，缓慢推镜）：主体保持原始姿态，缓慢眨眼并伴随轻微呼吸，随后尾巴尖或耳朵做小幅自然动作；只使用一种运镜。
OPTICS：50mm自然视角，机位与宠物视线同高，浅景深，焦点持续锁定眼睛与面部。
PHYSICS：毛发、胡须和耳缘仅有低缓连续微动，身体结构自然，无额外四肢、肢体畸形或主体复制。
LIGHTING：${lighting === 'moonlight' ? '柔和月光' : '温暖自然光'}作为唯一主光源，保持参考照片原始明暗关系与色温。
AUDIO：<与参考场景匹配的低音量环境声>；无人物对白，无模型字幕，无模型BGM。`;
    return {
      photo_index: i,
      shot_type: i === 0 ? 'push_in' : 'static_drift',
      camera: i === 0 ? 'wide' : 'close_up',
      lighting,
      transition: i === 0 ? 'revealing' : 'cut',
      duration_sec: perSegDuration,
      seedance_prompt: prompt,
      narration: `${petProfile.name}的${emotion === 'pain' ? '安静时刻' : '日常一瞬'}，值得被记住。`,
      subtitle: i === 0 ? `${petProfile.name} · 回忆录` : '',
    };
  });

  return sanitizeMemoirScriptPrompts({
    title: `${petProfile.name}的回忆录`,
    theme: '陪伴',
    emotion_curve: productLine === 'memorial' ? ['calm', 'memory', 'relief'] : ['calm'],
    narration_voice: 'zh_female_vv_uranus_bigtts',
    music_mood: (musicStyle as MemoirScript['music_mood']) ?? (productLine === 'memorial' ? 'nostalgic' : 'warm'),
    anchors: [{ id: 'pet1', type: 'pet', desc: anchor }],
    segments,
  }, input);
}

/**
 * 生成回忆录分镜脚本（主入口）
 * 流程：组装 prompt → chat → 提取 JSON → zod 校验 → 修正 → 返回
 * 失败重试 MAX_ATTEMPTS 次，全部失败用兜底模板
 * @param input - 分镜生成输入
 * @returns 校验并修正后的分镜脚本
 */
export async function generateMemoirScript(input: MemoirScriptInput): Promise<MemoirScript> {
  // 参数预校验：照片数量必须落在**档位**边界内（不是产品线边界，见 PRODUCT_LINE_META 上方说明）
  const photoError = validateTierPhotoCount(input.tier, input.photoCount);
  if (photoError) {
    throw new Error(`[MemoirScript] ${photoError}`);
  }

  // 组装消息（系统提示词固定 + 用户上下文动态）
  const messages = [
    { role: 'system' as const, content: buildSystemPrompt() },
    { role: 'user' as const, content: buildUserContext(input) },
  ];

  let lastError: unknown = null;

  // 尝试生成（最多 MAX_ATTEMPTS 次）
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const raw = await chat(messages, SCRIPT_CHAT_OPTIONS);
      const jsonText = extractJson(raw);
      const parsed = JSON.parse(jsonText) as unknown;
      const script = MemoirScriptSchema.parse(parsed);
      // 校验通过 → 规范化后返回
      return normalizeScript(script, input);
    } catch (err) {
      lastError = err;
      console.warn(`[MemoirScript] 第 ${attempt}/${MAX_ATTEMPTS} 次生成失败:`, (err as Error).message);
    }
  }

  // 全部失败 → 兜底模板（记录日志，质量降级但不断服）
  console.warn(
    `[MemoirScript] LLM 生成失败 ${MAX_ATTEMPTS} 次，使用兜底模板（productLine=${input.productLine}）:`,
    (lastError as Error)?.message,
  );
  return fallbackTemplate(input);
}

// 导出内部函数供单测覆盖（不影响业务入口）
export { buildSystemPrompt, buildUserContext, extractJson, normalizeScript, fallbackTemplate };
