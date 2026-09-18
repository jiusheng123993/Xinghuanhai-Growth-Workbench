/**
 * 宠物形象生成服务 - 调用 Seedream API 生成宠物形象
 * 支持卡通/写实单张生成（旧接口），以及多风格候选批量生成（新接口）
 */
import { config } from '../config.js';
import { callSeedream } from './image2DService.js';
import { analyzeImage } from './visionService.js';
// 宠物提示词公共模块：统一按提示词库 §0.6/§四 规范构造（角色锁定 + 主体锁定 + 品种兜底）
import { petSubjectText, PET_IDENTITY_KEEP, PET_ONLY_ONE } from './petPrompt.js';
// AI 生图转存（去 Seedream 平台水印后转存本站图床，见 imageBadge 模块注释）
import { hostAiImage } from './imageBadge.js';

/** 宠物形象生成请求参数 */
export interface GeneratePetImageParams {
  petId: string;
  species: string;
  breed: string;
  gender: string;
  photoUrl?: string;
  style?: string;
}

/** 宠物形象生成结果 */
export interface GeneratePetImageResult {
  url: string;
  isPlaceholder: boolean;
}

const DEFAULT_STYLE = 'cartoon';

/**
 * 默认生成画风池（不传 styleKey 时的候选集，保持原 5 种）
 * AVATAR_STYLE_OPTIONS 扩充到 15 种后，照片生成等"批量候选"场景不应因此
 * 变成 15 张（成本与体验）；单画风选择（文字生成）才用完整 15 种池
 */
export const DEFAULT_STYLE_KEYS = ['q', 'japanese', 'american', 'watercolor', 'clay'] as const;

/**
 * 多风格候选定义（15 种画风 × 猫/狗各一套描述）
 * - 多宠家庭里猫狗可能同时存在，所以每种画风都要有猫、狗专属提示词，
 *   避免把猫咪生成成狗狗脸、或狗狗生成成猫咪脸
 * - 提示词必须把各画风写得很"极端"且互相排斥，否则带参考照片图生图时
 *   所有图都会往参考照片写实方向收敛，看起来几乎一样
 * - 画风来源：现有 5 种（q/japanese/american/watercolor/clay）+ 项目提示词库
 *   《宠物回忆录-提示词库.md》§6/§7.1 通用视觉风格库（吉卜力/皮克斯3D/像素/水墨/
 *   油画/赛博朋克/极简北欧/低多边形/线稿/暗黑奇幻，共 10 种）；
 *   VHS 复古与故障艺术对宠物头像效果难保证，暂不收录（需要可再加）
 */
export const AVATAR_STYLE_OPTIONS = [
  {
    key: 'q',
    label: 'Q版萌系',
    dog: '典型Q版二头身狗狗，超大头小身体，圆脸占画面一半，大圆眼带高光，腮红，耳朵软萌下垂，线条圆润无棱角，萌系贴纸质感',
    cat: '典型Q版二头身猫咪，超大头小身体，圆脸占画面一半，大圆眼带高光，腮红，猫耳小巧，胡须简洁，线条圆润无棱角，萌系贴纸质感',
  },
  {
    key: 'japanese',
    label: '日系治愈',
    dog: '日系治愈系狗狗插画，水彩晕染，奶油色柔和渐变，吉卜力式温馨氛围，毛发细腻柔和笔触',
    cat: '日系治愈系猫咪插画，水彩晕染，奶油色柔和渐变，吉卜力式温馨氛围，皮毛细腻柔和笔触',
  },
  {
    key: 'american',
    label: '美式卡通',
    dog: '美式动画电影风格狗狗角色（类似皮克斯/迪士尼），粗描边，高饱和撞色，夸张五官和生动表情',
    cat: '美式动画电影风格猫咪角色（类似皮克斯/迪士尼），粗描边，高饱和撞色，夸张五官和生动表情',
  },
  {
    key: 'watercolor',
    label: '水彩手绘',
    dog: '清新水彩手绘狗狗头像，透明水彩晕染，留白边缘，纸张纹理，淡雅清新',
    cat: '清新水彩手绘猫咪头像，透明水彩晕染，留白边缘，纸张纹理，淡雅清新',
  },
  {
    key: 'clay',
    label: '黏土萌宠',
    dog: '黏土玩偶质感狗狗，软陶立体，手作质感，圆润可爱，柔和影棚光',
    cat: '黏土玩偶质感猫咪，软陶立体，手作质感，圆润可爱，柔和影棚光',
  },
  {
    key: 'ghibli',
    label: '吉卜力动画',
    dog: '吉卜力动画风格狗狗头像，Studio Ghibli style, hand-painted watercolor, Hayao Miyazaki aesthetic，手绘水彩背景，软绒质感，宫崎骏式温暖治愈，柔和光线，微风拂动毛发，梦幻色调',
    cat: '吉卜力动画风格猫咪头像，Studio Ghibli style, hand-painted watercolor, Hayao Miyazaki aesthetic，手绘水彩背景，软绒质感，宫崎骏式温暖治愈，柔和光线，微风拂动皮毛，梦幻色调',
  },
  {
    key: 'pixar',
    label: '皮克斯3D',
    dog: '皮克斯3D动画风格狗狗头像，Pixar style, Disney 3D animation, smooth rendering, expressive eyes, subsurface scattering，光滑材质，立体渲染，大眼睛高光，次表面散射透光毛发，表情生动，细节丰富',
    cat: '皮克斯3D动画风格猫咪头像，Pixar style, Disney 3D animation, smooth rendering, expressive eyes, subsurface scattering，光滑材质，立体渲染，大眼睛高光，次表面散射透光皮毛，表情生动，细节丰富',
  },
  {
    key: 'pixel',
    label: '像素艺术',
    dog: '像素艺术风格狗狗头像，16-bit pixel art, SNES game aesthetic, sprite animation, chiptune，块状像素边缘，复古游戏质感，色彩分明，俏皮可爱',
    cat: '像素艺术风格猫咪头像，16-bit pixel art, SNES game aesthetic, sprite animation, chiptune，块状像素边缘，复古游戏质感，色彩分明，俏皮可爱',
  },
  {
    key: 'ink',
    label: '水墨国风',
    dog: '中国水墨画风格狗狗头像，Chinese ink wash painting, sumi-e brush strokes, rice paper texture, zen，浓淡干湿墨韵，宣纸纹理，留白意境，禅意，墨色勾勒毛流感',
    cat: '中国水墨画风格猫咪头像，Chinese ink wash painting, sumi-e brush strokes, rice paper texture, zen，浓淡干湿墨韵，宣纸纹理，留白意境，禅意，墨色勾勒毛流感',
  },
  {
    key: 'oil',
    label: '油画印象派',
    dog: '印象派油画风格狗狗头像，oil painting, impasto, thick brush strokes, canvas texture, Monet, Van Gogh，厚涂笔触，油画布纹理，色彩浓郁，笔触可见，艺术感',
    cat: '印象派油画风格猫咪头像，oil painting, impasto, thick brush strokes, canvas texture, Monet, Van Gogh，厚涂笔触，油画布纹理，色彩浓郁，笔触可见，艺术感',
  },
  {
    key: 'cyberpunk',
    label: '赛博朋克',
    dog: '赛博朋克风格狗狗头像，cyberpunk, neon lights, rain-slicked streets, holographic, purple and cyan palette，霓虹灯光，雨夜反光，紫色青色色调，全息投影元素，未来都市氛围，酷炫',
    cat: '赛博朋克风格猫咪头像，cyberpunk, neon lights, rain-slicked streets, holographic, purple and cyan palette，霓虹灯光，雨夜反光，紫色青色色调，全息投影元素，未来都市氛围，酷炫',
  },
  {
    key: 'nordic',
    label: '极简北欧',
    dog: '极简北欧风格狗狗头像，minimalist Scandinavian design, clean lines, negative space, muted tones，低饱和莫兰迪色，几何构图，大量留白，高级宁静',
    cat: '极简北欧风格猫咪头像，minimalist Scandinavian design, clean lines, negative space, muted tones，低饱和莫兰迪色，几何构图，大量留白，高级宁静',
  },
  {
    key: 'lowpoly',
    label: '低多边形',
    dog: '低多边形风格狗狗头像，low poly 3D, geometric faceted, flat shading, indie game aesthetic，几何切面，扁平着色，多面体轮廓，游戏质感，简洁现代',
    cat: '低多边形风格猫咪头像，low poly 3D, geometric faceted, flat shading, indie game aesthetic，几何切面，扁平着色，多面体轮廓，游戏质感，简洁现代',
  },
  {
    key: 'lineart',
    label: '线稿素描',
    dog: '线稿素描风格狗狗头像，line art sketch, charcoal drawing, ink illustration, cross-hatching，铅笔线稿，炭笔质感，排线阴影，留白画纸，艺术手绘感',
    cat: '线稿素描风格猫咪头像，line art sketch, charcoal drawing, ink illustration, cross-hatching，铅笔线稿，炭笔质感，排线阴影，留白画纸，艺术手绘感',
  },
  {
    key: 'dark',
    label: '暗黑奇幻',
    dog: '暗黑奇幻风格狗狗头像，dark fantasy, gothic moonlight, mysterious fog, Tim Burton style，哥特月光，神秘雾气，戏剧性光影，深沉神秘氛围',
    cat: '暗黑奇幻风格猫咪头像，dark fantasy, gothic moonlight, mysterious fog, Tim Burton style，哥特月光，神秘雾气，戏剧性光影，深沉神秘氛围',
  },
] as const;

/** 多风格候选生成请求参数 */
export interface GeneratePetImageOptionsParams {
  petId: string;
  species: string;
  breed: string;
  gender: string;
  /** 参考照片 URL（有则图生图保证像宠物本人，无则文生图） */
  photoUrl?: string;
  /** 基础基调：cartoon（卡通）/ realistic（写实） */
  style?: string;
  /**
   * 用户文字描述（可选，如"橘色英短、圆脸胖乎乎的"）
   * 描述会拼进提示词参与生图；空则只用宠物档案自动描述。
   * ⚠️ 清洗：截断 100 字 + 去换行；提醒用户不要写宠物名字（防「烧鸡」被画成鸡）
   */
  description?: string;
  /**
   * 指定画风 key（q / japanese / american / watercolor / clay）
   * 传了则只生成该画风 1 张；不传生成全部 5 种候选
   */
  styleKey?: string;
  /** 表情 key（happy / excited / ...，拼进提示词），可选 */
  expression?: string;
  /**
   * 背景 key（sky / sakura / ...，AVATAR_BACKGROUND_OPTIONS 白名单），可选
   * 文生图换景：替换提示词尾部的"干净背景"；不传=默认干净背景。设定图不受影响（恒纯白）
   */
  background?: string;
}

/**
 * 表情 key → 中文提示词片段（12 种，对齐 2D 表情包 EXPRESSIONS）
 * 拼进生图提示词，让形象带上表情（文生图用正向描述）
 */
export const EXPRESSION_PROMPTS: Record<string, string> = {
  happy: '开心的表情，嘴角上扬，眼睛弯弯',
  sad: '难过的表情，耳朵微微下垂',
  excited: '兴奋的表情，眼睛发亮，尾巴翘起',
  sleepy: '困倦的表情，半眯着眼，懒洋洋',
  love: '温柔的表情，眼神充满爱意',
  cool: '得意的表情，嘴角微扬，酷酷的',
  angry: '生气的表情，耳朵竖起，气鼓鼓',
  thinking: '思考的表情，歪着头，若有所思',
  surprised: '惊讶的表情，眼睛瞪大，嘴巴微张',
  crying: '委屈的表情，眼角带泪，可怜巴巴',
  celebrate: '庆祝的表情，咧嘴大笑，活力满满',
  naughty: '调皮的表情，吐舌头，俏皮',
};

/**
 * 背景目录（文生图换景，9 选 1 含默认）
 * 纯提示词层实现：把"干净背景"替换为场景多维描写（时间光源+环境+氛围+光效，
 * 对齐提示词技能 §场景公式），不多花生图调用、不影响配额。
 * 仅作用于头像；全方位设定图恒为纯白背景（参考图价值在精确记录外貌，不能被场景污染）
 */
export const AVATAR_BACKGROUND_OPTIONS = [
  { key: 'sky', label: '蓝天白云', prompt: '晴朗蓝天与蓬松白云背景，明亮自然光，清新开阔' },
  { key: 'sakura', label: '樱花', prompt: '春日樱花树下粉色花瓣飘落的背景，柔和逆光，浪漫温柔，浅景深虚化' },
  { key: 'grass', label: '草坪花园', prompt: '阳光洒落的绿色草坪花园背景，午后暖阳，清新自然' },
  { key: 'christmas', label: '圣诞', prompt: '圣诞壁炉、彩灯与松枝装饰的温暖背景，暖黄灯光，节日温馨氛围' },
  { key: 'birthday', label: '生日派对', prompt: '生日派对彩带气球与小蛋糕背景，缤纷马卡龙色，欢乐庆祝氛围' },
  { key: 'beach', label: '夏日海边', prompt: '夏日海边沙滩与浅蓝海浪背景，明媚阳光，清爽度假感' },
  { key: 'night', label: '星空夜', prompt: '深蓝星空夜晚背景，点点星光与柔和辉光，梦幻静谧氛围' },
  { key: 'cozy', label: '奶油毛毯', prompt: '奶油色针织毛毯与软靠垫的温馨室内背景，暖调柔光，治愈慵懒' },
] as const;

/** 背景 key → 提示词片段（路由层白名单校验后按 key 取用） */
export const AVATAR_BACKGROUND_PROMPTS: Record<string, string> = Object.fromEntries(
  AVATAR_BACKGROUND_OPTIONS.map((o) => [o.key, o.prompt]),
);

/** 单个风格候选结果（一套两张：头像 + 全方位角色设定图） */
export interface PetImageOption {
  style: string;
  label: string;
  /** 头像图 URL（正面特写，用于小程序内展示） */
  url: string;
  /**
   * 全方位角色设定图 URL（正面特写/侧面/顶部/背面四视图合一，全身描绘）
   * 用途：回忆录视频与全家福的角色参考图——全身多视角比单头像更能锁定体型花纹。
   * 设定图生成失败时为 null（头像仍可用，前端隐藏设定图卡片）
   */
  sheetUrl: string | null;
}

/**
 * 照片批量生成流程的"一套候选"数量（每套=头像+设定图共 2 次生图调用）。
 * 2026-09-08 商业化立项 v0.2 P0-1 降本：3 套（6 次调用≈33.6 元/次）→ 2 套（4 次≈22.4 元/次），
 * 会员权益成本仍高于订阅月均，需配合照片月配额收紧（avatar.ts MEMBER_PHOTO_OPTIONS_MONTHLY_LIMIT）。
 */
const PHOTO_SET_COUNT = 2;

/**
 * 构建全方位角色设定图提示词（四视图合一：正面特写/侧面/顶部俯视/背面）
 * 对应提示词技能 §三 公式：主体+外貌+画风+画质+角色锁定+主体锁定；
 * 关键差异：设定图的主体锁定要说明"四个视图是同一只宠物的不同角度"，防止模型画成四只不同的宠物。
 * 背景固定纯白——设定图的价值在于精确记录外貌细节，供后续生图/生视频当参考。
 * @param identityKeep 有参考图时传 PET_IDENTITY_KEEP（"以参考照片为准"），
 *   无参考图绝不写（金科玉律 #4：没有图却说"与照片一致"是说谎）；设定图与头像共用参考图，锁定话术同样适用
 */
function buildMultiviewSheetPrompt(params: {
  subject: string;
  userDesc: string;
  exprText: string;
  styleText: string;
  styleKeywords: string;
  identityKeep?: string;
}): string {
  const segments = [
    // 版式指令：明确四视图内容与排布，降低模型自由发挥空间
    `${params.subject}的全身角色设定图，四视图合一画在同一张图中：左上=正面特写头像，右上=完整侧面全身，左下=顶部俯视角度，右下=背面全身`,
    params.userDesc,
    params.exprText,
    `${params.styleText}，${params.styleKeywords}`,
    params.identityKeep,
    // 主体锁定（设定图特化版）：强调同一只的多视角，而非多只宠物
    '四个视图必须是同一只宠物从不同角度观察的样子，绝不是四只不同的宠物：毛色、花纹、体型、五官在所有视图中完全一致',
    '不要出现其他动物、人物、文字、水印或表格线以外的装饰元素',
    '纯白色干净背景，高质量，细节丰富',
  ].filter(Boolean);
  return segments.join('，').replace(/，+/g, '，');
}

/**
 * 生成形象候选（照片流程一套 = 头像 + 全方位角色设定图；文字流程单张头像）
 * - 文字生成（无参考图）：只出头像——没有真实照片锚定外貌，四视图全靠想象，
 *   作为"角色参考图"价值低还翻倍成本（用户决策 2026-08-24）
 * - 照片生成（带参考图）：1 套两张，设定图用于回忆录/全家福的角色参考
 *   （全身多视角比单头像更能锁定体型花纹）
 * - 容错：整套失败跳过；仅设定图失败时返回 sheetUrl=null（头像照常可用）
 * @returns 候选列表；AI 服务不可用时返回 null（不返回丑陋占位图）
 */
export async function generatePetImageOptions(
  params: GeneratePetImageOptionsParams,
): Promise<PetImageOption[] | null> {
  const apiKey = config.seedream.apiKey;
  if (!apiKey) return null;

  const style = params.style || DEFAULT_STYLE;
  const genderLabel = params.gender === 'male' ? '公' : params.gender === 'female' ? '母' : '';
  const isDog = params.species === 'dog';
  const styleText = style === 'realistic' ? '写实风格，真实细腻' : '可爱卡通风格';
  // 主体用公共模块（品种兜底 + 绝不写名字）；图生图时追加角色锁定与主体锁定
  const subject = petSubjectText(params.breed, params.species, genderLabel);

  // 用户文字描述：清洗换行/控制字符 + 截断 100 字，拼进提示词（空则只用档案自动描述）
  const userDesc = (params.description || '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, 100);
  // 背景（文生图换景）：选了则用场景描写替换"干净背景"——纯提示词层实现，不加调用不加费用；
  // key 已由路由层白名单校验，这里再兜底一次（非法 key 视同默认）
  const bgText = params.background ? AVATAR_BACKGROUND_PROMPTS[params.background] || '' : '';
  const bgTail = bgText || '干净背景';
  const basePrompt = userDesc
    ? `${subject}的头像，${userDesc}，高质量，细节丰富，${bgTail}`
    : `${subject}的头像，高质量，细节丰富，${bgTail}`;

  // 表情：拼进提示词（正向描述，如"开心的表情，嘴角上扬"）
  const exprText = params.expression ? EXPRESSION_PROMPTS[params.expression] || '' : '';

  // 画风范围：传 styleKey 只生成该画风 1 套（15 种可选，文字流程）；
  // 不传取默认池前 PHOTO_SET_COUNT 种（照片流程，一套两张控制成本与耗时）
  const styleItems = params.styleKey
    ? AVATAR_STYLE_OPTIONS.filter((item) => item.key === params.styleKey)
    : AVATAR_STYLE_OPTIONS.filter((item) => (DEFAULT_STYLE_KEYS as readonly string[]).includes(item.key))
        .slice(0, PHOTO_SET_COUNT);

  // 并发生成每"套"（套内头像+设定图并行），互不阻塞；某套失败不影响其余
  const results = await Promise.allSettled(
    styleItems.map(async (item) => {
      const itemText = isDog ? item.dog : item.cat;
      // 角色锁定条件化（审查修复）：只有真传了参考图才写"以参考照片为准"，
      // 文字生成流没有图，写了就是说谎（违反提示词技能金科玉律 #4）
      const identityKeep = params.photoUrl ? PET_IDENTITY_KEEP : '';
      const headPrompt = [
        basePrompt,
        exprText,
        styleText,
        itemText,
        identityKeep,
        PET_ONLY_ONE,
      ]
        .filter(Boolean)
        .join('，')
        .replace(/，+/g, '，');
      const sheetPrompt = buildMultiviewSheetPrompt({
        subject,
        userDesc,
        exprText,
        styleText,
        // 设定图是全身四视图：画风关键词里若含"头像"字样会与版式指令打架
        //（审查发现 watercolor/ghibli/pixar 等描述含"头像"），统一替换为"形象"
        styleKeywords: itemText.replace(/头像/g, '形象'),
        identityKeep,
      });
      // 头像为必出项；设定图仅在照片流程生成（文字流没有参考图，四视图全靠想象，
      // 作为角色参考价值低且多花一次生图——用户决策：文生图回归单张）
      const [headUrl, sheetUrl] = await Promise.all([
        callSeedream(headPrompt, params.photoUrl || '', apiKey),
        params.photoUrl
          ? callSeedream(sheetPrompt, params.photoUrl, apiKey).catch(() => null)
          : Promise.resolve(null),
      ]);
      if (!headUrl) return null;
      return { style: item.key, label: item.label, url: headUrl, sheetUrl: sheetUrl ?? null };
    }),
  );

  const options: PetImageOption[] = [];
  for (const result of results) {
    if (result.status === 'fulfilled' && result.value) {
      options.push(result.value);
    } else if (result.status === 'rejected') {
      console.warn('[AvatarOptions] 某个风格生成失败:', result.reason);
    }
  }

  // 至少成功 1 套才算可用；全部失败视为服务不可用
  return options.length > 0 ? options : null;
}

/**
 * 清洗自定义背景描述（对齐全家福 cleanCustomScene 口径）：
 * 换行/制表符→空格、压缩连续空白、截断 60 字；纯空白返回空串（视同未填）
 */
export function cleanCustomBackground(raw: string): string {
  return raw.replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
}

/**
 * 真·背景替换（图生图局部语义编辑）：以用户已有形象图为参考，
 * 保持宠物本身完全不变，仅把背景更换为所选场景
 * - 参考图 = 用户选定的形象/照片 URL（callSeedream 传 image 字段走图生图，身份锚点）
 * - 背景 = 预设 key（AVATAR_BACKGROUND_OPTIONS 白名单）或用户自定义描述（清洗截断 60 字，优先于预设）
 * - 提示词按技能 §角色锁定：以参考照片为准（有图才写）+ 只出现这一只 + 边缘干净自然
 * - 水印/角标：Seedream 侧统一 `watermark:false`（去平台水印）；
 *   **自有品牌角标已于 2026-09-19 按产品决策关闭**（全链路不做可见角标），
 *   转存与**隐式 AIGC 元数据**仍由 `hostAiImage` 承担（见 imageBadge.ts）
 * @returns 新图 URL；无 key/背景为空/生成失败返回 null（调用方明确报错）
 */
export async function generateBackgroundSwap(params: {
  petId: string;
  species: string;
  breed: string;
  /** 用户选定的源形象 URL（当前形象或形象库条目） */
  imageUrl: string;
  /** 背景 key（AVATAR_BACKGROUND_OPTIONS 白名单内），与 customBackground 二选一 */
  background?: string;
  /** 用户自定义背景描述（自由文本，服务端清洗截断 60 字），优先于 background */
  customBackground?: string;
}): Promise<string | null> {
  const apiKey = config.seedream.apiKey;
  if (!apiKey) return null;
  const customText = params.customBackground ? cleanCustomBackground(params.customBackground) : '';
  // 自定义优先，其次预设；两者皆空不发请求（路由已校验，双保险）
  const bgText = customText || (params.background ? AVATAR_BACKGROUND_PROMPTS[params.background] : '') || '';
  if (!bgText) return null;
  const subject = petSubjectText(params.breed, params.species, '');
  const prompt = [
    `以这张${subject}的照片为准，进行背景替换`,
    '保持这只宠物完全不变：毛色、花纹、体型、五官、姿态与参考图完全一致，不改变外貌，不增减数量',
    `仅将背景更换为：${bgText}`,
    '宠物轮廓边缘干净自然，与背景融合真实',
    '画面中只出现这一只宠物，不要出现其他动物、人物、文字、水印',
    '高质量，细节丰富',
  ]
    .join('，')
    .replace(/，+/g, '，');
  return callSeedream(prompt, params.imageUrl, apiKey);
}

/**
 * 宠物照片 → 详细外貌描述（DeepSeek 视觉模型提取）
 * 对应提示词库 §0.9「细节描写清单」：毛色/花纹/体型/脸型/眼睛/鼻子/胡须/特殊标记，
 * 让生图提示词包含"具体样貌"而不是只有品种名
 * @param photoUrl - 宠物真实照片 URL
 * @returns 外貌描述（清洗换行/截断 100 字）；无 key/失败返回 null（调用方降级）
 */
export async function extractPetAppearance(photoUrl: string): Promise<string | null> {
  const raw = await analyzeImage({
    imageUrl: photoUrl,
    prompt:
      '你是宠物外貌描述专家。请仔细观察这张宠物照片，用中文描述它的外貌特征，用于AI生成它的卡通头像。' +
      '必须包含：毛色（主色与层次）、花纹图案、体型胖瘦、脸型、眼睛颜色、鼻子颜色、胡须、耳朵形状、特殊标记（如白下巴/白手套/异色瞳）。' +
      '只描述外貌，不要提背景、环境、照片质量；控制在60字以内。',
    maxTokens: 200,
  });
  if (!raw) return null;
  return raw.replace(/[\r\n\t]+/g, ' ').trim().slice(0, 100);
}

function generateSvgPlaceholder(params: GeneratePetImageParams): string {
  const colorMap: Record<string, string> = {
    dog: '#F5A623',
    cat: '#7ED321',
  };
  const speciesEmoji: Record<string, string> = {
    dog: '🐕',
    cat: '🐱',
  };
  const color = colorMap[params.species] || '#8B5CF6';
  const emoji = speciesEmoji[params.species] || '🐾';

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400">
  <rect width="400" height="400" fill="${color}" rx="20"/>
  <text x="200" y="180" text-anchor="middle" font-size="100">${emoji}</text>
  <text x="200" y="260" text-anchor="middle" font-size="24" fill="white" font-family="sans-serif">${params.breed}</text>
  <text x="200" y="300" text-anchor="middle" font-size="16" fill="rgba(255,255,255,0.7)" font-family="sans-serif">AI 形象生成暂不可用</text>
  <text x="200" y="330" text-anchor="middle" font-size="14" fill="rgba(255,255,255,0.5)" font-family="sans-serif">请配置 SEEDREAM_API_KEY</text>
</svg>`;

  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

export async function generatePetImage(
  params: GeneratePetImageParams,
): Promise<GeneratePetImageResult> {
  const apiKey = config.seedream.apiKey;

  if (!apiKey) {
    return {
      url: generateSvgPlaceholder(params),
      isPlaceholder: true,
    };
  }

  const style = params.style || DEFAULT_STYLE;
  const genderLabel = params.gender === 'male' ? '公' : params.gender === 'female' ? '母' : '';

  // 纯文生图（无参考照片）：主体用公共模块，不追加"以参考照片为准"（无图可参考），
  // 但保留主体锁定，防模型加戏/多画
  const prompt = `${petSubjectText(params.breed, params.species, genderLabel)}的${style}风格头像，高质量，细节丰富，可爱温馨，${PET_ONLY_ONE}`;

  try {
    const response = await fetch('https://ark.cn-beijing.volces.com/api/v3/images/generations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'doubao-seedream-4-0-250828',
        prompt,
        size: '1024x1024',
        n: 1,
        // 去掉 Seedream 平台水印（样式不可控），生成图随后由 hostAiImage 转存本站
        watermark: false,
      }),
    });

    if (!response.ok) {
      console.error('[Seedream] API error:', response.status);
      return {
        url: generateSvgPlaceholder(params),
        isPlaceholder: true,
      };
    }

    const data = (await response.json()) as {
      data: Array<{ url: string }>;
    };

    if (data.data && data.data.length > 0 && data.data[0].url) {
      return {
        // 转存本站 uploads（失败降级返回原图 URL，见 imageBadge 模块注释）
        url: await hostAiImage(data.data[0].url),
        isPlaceholder: false,
      };
    }

    return {
      url: generateSvgPlaceholder(params),
      isPlaceholder: true,
    };
  } catch (error) {
    console.error('[Seedream] Error:', error);
    return {
      url: generateSvgPlaceholder(params),
      isPlaceholder: true,
    };
  }
}
