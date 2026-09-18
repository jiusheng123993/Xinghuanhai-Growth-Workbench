/**
 * 回忆录提示词模板库（回忆录 2.0 M2 模块）
 * 职责：把分镜脚本组装成最终发给 Seedance 的提示词
 * 这是"方法论固化"的执行层——用户在小程序里的每次生成，
 * 最终 prompt 都经过本模块按 Seedance 2.5 prompt contract 强制组装。
 *
 * 方法论来源（已吸收最新版）：
 * - OpenMontage Seedance 2.5 技能：十段结构（GLOBAL STYLE→SCENE→CHARACTERS→
 *   LOCATION→FIRST FRAME→Shots→OPTICS→PHYSICS→LIGHTING→AUDIO）
 * - Locks 连续性锁（共 5 把，顺序与实现 appendLocks 的 locks 数组一致，逐把对应一个防错点）：
 *   1. COUNT LOCK       —— 只出现照片里已有的角色，防凭空多出一只猫/狗/人、防镜面或玻璃倒影出现第二个
 *   2. SCREEN DIRECTION —— 锁定主体朝向与屏幕运动方向，防多镜拼接时左右翻转、防镜头中途换向
 *   3. IDENTITY LOCK    —— 外貌与参考图一致（毛色/花纹/体型/五官 + 色彩三元占比 + 细节密度量级），
 *                          防主体换脸，防出现 logo、可读文字、字幕与水印
 *   4. ANATOMY LOCK     —— 身体结构自然、四肢数量正确，防多腿、肢体畸形、脸部扭曲、主体复制与穿模
 *   5. QUALITY LOCK     —— 画质与运动边界，防闪烁、抖动、形象漂移与画质软塌
 *
 * 关键设计：
 * - LLM 生成的 seedance_prompt 可能缺段/缺身份锚点，本模块做"补全 + 强制注入"：
 *   1. 身份锚点强制注入（即使 LLM 没写，也会加进 CHARACTERS 段）
 *   2. 缺失的十段用默认值补齐（保证 Seedance 2.5 的"跳段会坏在可预期的地方"不出现）
 *   3. Locks 追加到 prompt 尾部 —— 这一步每次生成都会执行（不判断 LLM 写没写），
 *      所以改它等于改所有输出，务必克制；锁条数与锁名由单测「锁条数与锁名齐全」守住，防注释再次漂移
 */
import type { MemoirSegmentScript } from '../schemas/memoirScript.js';

/** 十段结构段落名（Seedance 2.5 prompt contract） */
const SECTION_KEYS = [
  'GLOBAL STYLE',
  'SCENE',
  'CHARACTERS',
  'LOCATION',
  'FIRST FRAME',
  'Shot',
  'OPTICS',
  'PHYSICS',
  'LIGHTING',
  'AUDIO',
] as const;

/** 默认段落（LLM 输出缺段时补齐） */
const DEFAULT_SECTIONS: Record<string, string> = {
  'GLOBAL STYLE':
    '写实照片级质感，电影质感，色彩自然，细节丰富，柔和暖调；严格排除黑白、手绘、插画、动画与塑料CG；避免生成任何文字或字幕、logo、水印。',
  'SCENE': '参考照片中的宠物保持原始姿态，呈现自然日常片刻。',
  'CHARACTERS': '宠物=参考图1（与原始照片一致的宠物），毛色、花纹、体型与五官保持一致。',
  'LOCATION': '严格保持参考照片原始场景、道具、空间关系与构图，不新增物体。',
  'FIRST FRAME': '沿用参考照片原始景别与主体位置，保持首帧稳定。',
  // Shot 默认段（只在 LLM 没写 Shot 段时兜底）——本轮吸收外部资料包的两条写法：
  //   ① 运镜位移速度量化：给出「速度约 2 秒/帧 + 全程匀速」，让运镜节奏可判定，而不是「缓慢」这类主观词；
  //   ② 节奏声明「静→动→静」：放在 Shot 而不是 GLOBAL STYLE —— GLOBAL STYLE 管画面观感，
  //      且 LLM 几乎每次都写满（默认值根本不生效）；而「静→动→静」描述的是镜头内的时间结构，
  //      与「只做小幅微动」同属运动边界，归 Shot 更贴，缺段兜底时也才真正生效；
  //   ③ 原有静图安全边界全部保留：只使用一种运镜、只做小幅自然微动，不引入「快速/剧烈」类措辞。
  'Shot':
    '缓慢推镜，从原始景别匀速向主体面部收拢，速度约 2 秒/帧，全程匀速、无卡顿无骤停；整体节奏：静→动→静，起幅静置、中段小幅微动、收幅回到静置；主体保持原始姿态，缓慢眨眼并伴随轻微呼吸，随后耳朵或尾巴尖做小幅自然动作；只使用一种运镜。',
  'OPTICS': '50mm自然视角，机位与宠物视线同高，浅景深，焦点持续锁定眼睛与面部。',
  // PHYSICS 默认段（只在 LLM 没写 PHYSICS 段时兜底）——本轮吸收外部资料包的「宠物专有信号」：
  // 补齐耳位、胡须、尾尖、皮肤与毛发竖立、舔鼻、瞬膜（第三眼睑）等只有宠物才有的可读微动作。
  // 两条硬约束（写在注释里，防止后续被改坏）：
  //   ① 静图安全：全部限定为「小幅、低缓、连续」，不出现奔跑、跳跃、甩头等大幅动作；
  //   ② Anti-Subjective：只写视觉事实（例如「耳廓向后压低」），绝不写「害怕」「开心」这类情绪词。
  'PHYSICS':
    '只有低缓连续的微动：耳廓可小幅转向或向后压低，胡须随呼吸轻微摆动，尾尖小幅摆动，被毛与皮肤沿脊背出现幅度极小的竖立起伏，偶有舌头轻扫鼻头后收回，瞬膜（第三眼睑）缓慢开合；身体结构自然，无额外四肢、肢体畸形或主体复制。',
  'LIGHTING': '参考照片原始光线作为唯一主光源，保持光线方向、明暗关系与色温。',
  'AUDIO': '<与参考场景匹配的低音量环境声>；无人物对白，无模型字幕，无模型BGM。',
};

/** 角色锚点输入（多宠物/多人场景：每个在场角色一个锚点） */
export interface CharacterAnchorInput {
  /** 角色唯一 id（对应 segments.characters_present） */
  id: string;
  /** 角色类型：宠物 / 人 */
  type: 'pet' | 'human';
  /** 物理特征描述（3-6 个特征，全片逐字重复） */
  desc: string;
}

/** 组装参数 */
export interface BuildPromptParams {
  /** 单镜脚本（LLM 生成） */
  segment: MemoirSegmentScript;
  /** 全部角色锚点（多宠物/多人；每镜只注入 characters_present 声明的在场角色） */
  anchors: CharacterAnchorInput[];
  /** 兼容旧单锚点（旧脚本无 anchors 时兜底） */
  identityAnchor?: string;
  /** 屏幕方向锁定：'right' | 'left'（默认 right，保证多镜方向一致） */
  screenDirection?: 'right' | 'left';
}

/**
 * 检查 prompt 是否包含指定段落标记（段首为段落名）
 * @param prompt - 待检查的 prompt
 * @param key - 段落名
 * @returns 是否包含
 */
function hasSection(prompt: string, key: string): boolean {
  // 段落名出现在行首（允许前面有空白）；Shot 段允许 "Shot 1:" 格式
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern =
    key === 'Shot'
      // 兼容官方工程型写法：Shot 1（特写，缓慢推镜）：……，避免误判缺段后重复追加 Shot。
      ? `(^|\\n)\\s*Shot(\\s+\\d+)?(?:\\s*[（(][^）)\\n]*[）)])?\\s*[:：]`
      : `(^|\\n)\\s*${escaped}\\s*[:：]`;
  return new RegExp(pattern, 'i').test(prompt);
}

/**
 * 补全缺失的十段段落
 * Seedance 2.5 的特性：跳段不会整体变差，但会在"可预期的特定方式"上坏掉，
 * 所以缺失段必须补齐，保证结构完整。
 * @param prompt - LLM 生成的 seedance_prompt
 * @returns 补全后的 prompt（保持原有内容顺序，缺失段追加在尾部对应位置）
 */
export function completeSections(prompt: string): string {
  let result = prompt.trim();
  const missing = SECTION_KEYS.filter((key) => !hasSection(result, key));

  // 缺失段按十段顺序追加到末尾（保持段落间有空行）
  if (missing.length > 0) {
    const tail = missing.map((key) => `${key}: ${DEFAULT_SECTIONS[key] ?? ''}`).join('\n\n');
    result = `${result}\n\n${tail}`;
  }
  return result;
}

/**
 * 强制注入角色锚点（多宠物/多人场景：每镜只注入 characters_present 声明的在场角色）
 * 策略：检查 CHARACTERS 段是否存在，存在则在段尾追加锚点；不存在则整段补上。
 * @param prompt - 补全后的 prompt
 * @param charactersText - 本镜在场角色的锚点文本（已拼好）
 * @returns 注入锚点后的 prompt
 */
export function injectCharacters(prompt: string, charactersText: string): string {
  if (!charactersText.trim()) return prompt;
  if (hasSection(prompt, 'CHARACTERS')) {
    // 在 CHARACTERS 段内追加锚点（段尾）
    return prompt.replace(
      /((?:^|\n)\s*CHARACTERS\s*[:：][^\n]*\n)([\s\S]*?)(?=\n\s*(?:LOCATION|Shot|OPTICS|PHYSICS|LIGHTING|AUDIO)\s*[:：])/i,
      `$1${charactersText}\n$2`,
    );
  }
  // 无 CHARACTERS 段：在 GLOBAL STYLE 后插入
  return prompt.replace(
    /((?:^|\n)\s*GLOBAL STYLE\s*[:：][^\n]*\n)/i,
    `$1\nCHARACTERS: ${charactersText}\n`,
  );
}

/**
 * 追加连续性锁（Locks）
 * - COUNT LOCK：只出现照片中已有的角色（多宠物/多人通用），防多余动物/人物/镜面倒影
 * - SCREEN DIRECTION：方向锁定，防多镜拼接方向漂移
 * - IDENTITY LOCK：主体外貌与参考图一致（毛色/花纹/体型/五官 + 主色/辅色/强调色三元占比 +
 *   细节密度对齐参考图量级），无 logo/文字/水印/模型字幕
 * - ANATOMY LOCK：宠物身体结构自然，防额外四肢、肢体畸形与主体复制
 * - QUALITY LOCK：补齐官方工程型公式中的画质与自然运动边界
 * @param prompt - 注入锚点后的 prompt
 * @param screenDirection - 屏幕方向
 * @returns 追加锁后的 prompt
 */
export function appendLocks(
  prompt: string,
  screenDirection?: 'right' | 'left',
): string {
  const directionLock = screenDirection
    ? `SCREEN DIRECTION：主体始终朝向画面${screenDirection === 'right' ? '右侧' : '左侧'}，永不反转。`
    : 'SCREEN DIRECTION：保持参考照片首帧中的原始朝向与屏幕运动方向，不左右翻转，不在镜头中途换向。';
  const locks = [
    // 固定 5 把锁，顺序即此数组顺序；条数与锁名由 promptTemplates.test.ts 的「锁条数与锁名齐全」断言守住，
    // 增删锁时注释、本数组与该断言必须同步改（历史上注释只列 3 把的漂移就是这样发生的）。
    'COUNT LOCK：画面只出现照片中已有的宠物与人，不出现额外动物、人物，无镜面/玻璃倒影出现第二个。',
    directionLock,
    // IDENTITY LOCK 本轮吸收外部资料包的两条「形式」（只学结构，绝不照抄它的数值）：
    //   ① 三元色彩占比：颜色写成主色/辅色/强调色的占比结构，比例互换或额外加色都算破功；
    //   ② 参考图当量级基准：参考图不只定身份，还定「细节密度/信息量」的量级，防模型自己加戏堆花纹；
    // 顺带把原来重复两遍的文字禁令（无字幕 / 避免生成任何文字或字幕）合并，压缩每次追加的净增长度。
    'IDENTITY LOCK：保持每个主体的毛色、花纹、体型、五官与参考图一致，色彩按主色/辅色/强调色三层占比复现、比例不得互换或额外加色；细节密度与纹理量级对齐参考图，不额外堆砌花纹或配饰；无 logo、无可读文字、无水印，避免生成任何文字或字幕。',
    'ANATOMY LOCK：身体结构自然，四肢数量正确，无肢体畸形、额外肢体、脸部扭曲、主体复制或穿模。',
    'QUALITY LOCK：高质量，细节丰富，电影质感，色彩自然，动作低缓连续，焦点稳定，无闪烁、抖动或形象漂移。',
  ];
  return `${prompt}\n\n${locks.join('\n')}`;
}

/**
 * 组装最终 Seedance 提示词（M2 主入口）
 * 三步：补全十段 → 注入本镜在场角色锚点（多宠物/多人）→ 追加 Locks
 * 锚点逻辑：优先 anchors + segments.characters_present（每镜只注入在场角色）；
 * 旧脚本（无 anchors）用 identityAnchor 兜底。
 * @param params - 组装参数
 * @returns 最终提示词
 */
export function buildFinalSegmentPrompt(params: BuildPromptParams): string {
  const { segment, anchors, identityAnchor, screenDirection } = params;

  // 计算本镜在场角色锚点文本
  let charactersText = '';
  if (Array.isArray(anchors) && anchors.length > 0) {
    // 每镜只注入 characters_present 声明的角色；未声明则全部在场
    const presentIds = segment.characters_present?.length
      ? segment.characters_present
      : anchors.map((a) => a.id);
    const present = anchors.filter((a) => presentIds.includes(a.id));
    charactersText = present
      .map((a) => {
        const label = a.type === 'human' ? '人物' : '宠物';
        return `${label}=参考图（${a.desc}）。保持与参考照片完全一致，不改变${a.type === 'human' ? '容貌、发型、体型' : '毛色、体型、五官'}。`;
      })
      .join('\n');
  } else if (identityAnchor) {
    // 旧脚本兜底（单锚点）
    charactersText = `角色=参考图1（${identityAnchor}）。保持与原始照片完全一致，不改变毛色、体型、五官。`;
  }

  const base = completeSections(segment.seedance_prompt);
  const anchored = injectCharacters(base, charactersText);
  return appendLocks(anchored, screenDirection);
}

// 导出内部函数供单测覆盖
export { hasSection, DEFAULT_SECTIONS, SECTION_KEYS };
