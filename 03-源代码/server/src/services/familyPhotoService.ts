/**
 * 全家福AI合成服务 - 调用 Seedream API 多图合成宠物全家福
 * 从提示词库映射风格到提示词模板，调用 Seedream 多图输入后入库
 * Seedream 4.0 内置安全过滤，无需额外内容审核
 * 参考 image2DService 的 Seedream 调用、重试、并发控制模式
 */
import { config } from '../config.js';
import { pool } from '../db.js';
import { delay } from '../utils/delay.js';
// 宠物提示词公共模块：主体描述（品种兜底 + 绝不写名字）统一从这里取
import { petSubjectText, petSpeciesLabel, translatePetNames } from './petPrompt.js';
// AI 生图转存（去 Seedream 平台水印后转存本站图床，见 imageBadge 模块注释）
import { hostAiImage } from './imageBadge.js';

const SEEDREAM_API = 'https://ark.cn-beijing.volces.com/api/v3/images/generations';

/** 支持的全家福合成风格 */
export const FAMILY_PHOTO_STYLES = [
  'pixar',
  'ghibli',
  'oil',
  'ink',
  'nordic',
  'cyberpunk',
] as const;

export type FamilyPhotoStyle = (typeof FAMILY_PHOTO_STYLES)[number];

/**
 * 支持的全家福场景（用户可在特定场景生成全家福）
 * 五大主题 22 个场景，前端按主题分组展示；场景 key 一旦上线不可改名（历史照片入库值兼容）
 * 场景描写对齐提示词库方法论（§0.9 细节粒度 / §二 场景卡 / §5.2 光影配对），
 * 每个场景 = 时间光线 + 色彩基调 + 前中后景层次 + 道具细节 + 氛围质感 的多维组合，
 * 避免"温馨客厅"式的单一贫瘠描写（用户明确要求精美场景）
 */
export const FAMILY_PHOTO_SCENES = [
  // 居家时光
  'livingroom', 'window', 'futon', 'bookshelf',
  // 四季自然
  'sakura', 'garden', 'autumn', 'snow', 'lavender', 'forest',
  // 节日庆典
  'christmas', 'birthday', 'lunarnewyear', 'midautumn',
  // 旅行见闻
  'seaside', 'roof', 'cafe', 'camping',
  // 梦幻唯美
  'aurora', 'clouds', 'monet', 'ocean',
] as const;

export type FamilyPhotoScene = (typeof FAMILY_PHOTO_SCENES)[number];

/**
 * 场景 → 提示词片段
 * 写法公式（对齐提示词库）：{时间与光线} + {环境层次} + {道具细节} + {色彩基调} + {氛围质感}，
 * 叠加英文光效词（golden hour / volumetric light / bokeh 等）提升模型出图精度
 */
const SCENE_PROMPTS: Record<FamilyPhotoScene, string> = {
  // ===== 居家时光 =====
  livingroom:
    '温馨客厅一角，布艺沙发上散落针织毯和抱枕，暖色落地灯与窗外暮色交融，茶几上一杯冒热气的红茶，绿植垂叶入画，木地板映着柔和光晕，浅景深背景虚化',
  window:
    '飘窗洒满午后阳光，白纱窗帘半透随风轻扬，毛毯软垫松软堆叠，尘埃在光柱中化作金色微粒浮动，窗外绿意朦胧失焦，慵懒惬意慢时光，柔和逆光',
  futon:
    '日式和室，榻榻米上摆着矮方桌与橘色暖桌被褥，纸拉门透进柔和天光，铁壶冒着袅袅白气，墙上一幅浮世绘，陶碗与竹帘细节精致，简约侘寂美学',
  bookshelf:
    '复古书房，顶天立地的原木书架摆满旧书，绿色玻璃罩台灯洒下暖黄光晕，皮面扶手椅与花纹地毯，壁炉火光微微跳动，灰尘在光束中漂浮，静谧文艺的英伦气息',
  // ===== 四季自然 =====
  sakura:
    '盛放的樱花树下，粉色花瓣如雪片飘落，花团锦簇遮出斑驳花影，春日柔光穿过花隙洒下点点光斑，青草地上铺满落瓣，空气清透明亮，浪漫唯美的日系春景',
  garden:
    '夏日花园，玫瑰与绣球竞相盛开，绿草茵茵缀着晶莹露珠，阳光穿过树叶洒下丁达尔光束，蝴蝶翩跹，藤编野餐篮与格纹餐布摆放整齐，明媚治愈的田园风光',
  autumn:
    '深秋庭院，金黄银杏与火红枫叶交织成穹顶，落叶铺成松软地毯，暖橙色夕照为万物镀上金边，木长椅上搭着一条格纹围巾，光斑温柔，浓郁醇厚的秋日诗意',
  snow:
    '冬日雪原，皑皑白雪压满松枝，鹅毛雪花正簌簌飘落，蓝色调天光清透干净，雪地上留着一串通向远方的脚印，冷冽空气中透着温暖，纯净梦幻的冰雪世界',
  lavender:
    '薰衣草花田，紫色花穗一路铺展到地平线，黄昏金光低角度斜照，花浪随微风起伏泛起紫色涟漪，远方孤树剪影静立，紫金撞色的普罗旺斯浪漫画卷',
  forest:
    '魔法森林深处，巨型蕨类植物层层叠叠，翡翠色苔藓覆盖倒木，丁达尔光束穿透薄雾斜射而下，萤火虫点点漂浮，伞状蘑菇散发微光，童话般的奇幻秘境',
  // ===== 节日庆典 =====
  christmas:
    '装饰华丽的圣诞树前，彩灯串闪烁着暖金色光斑，缎带礼盒高高堆叠，壁炉炉火跳动映红墙面，窗外大雪纷飞，松枝清香扑面，红绿金色调的温馨圣诞夜',
  birthday:
    '生日派对现场，粉金气球拱门与流苏彩带，奶油蛋糕上蜡烛烛光摇曳，三角彩旗悬挂，亮片折射细碎光芒，纸帽与礼盒点缀四周，欢乐明快的高饱和庆祝氛围',
  lunarnewyear:
    '中式新春庭院，红灯笼成串高挂随风轻晃，金色福字与手写春联贴上门楣，红梅枝头绽放，烟花在靛蓝夜空绚烂绽开，红金配色的浓浓年味',
  midautumn:
    '中秋庭院，一轮满月悬于靛蓝天幕，桂花树影婆娑，石桌上摆着月饼与温热的桂花酒，烛灯点点如星，银白月光洒在青瓦上，宁静团圆的中式意境',
  // ===== 旅行见闻 =====
  seaside:
    '海边日落，天空从橘粉渐变到淡紫，海面碎金万点随波闪烁，浪花轻吻沙滩留下白色泡沫蕾丝边，贝壳与海星散落，椰林剪影摇曳，黄金时刻的温暖逆光',
  roof:
    '城市天台，晚霞把天际线染成橘红与玫紫，远处高楼灯火次第点亮如星河，栏杆串灯散发着温暖光晕，晚风轻拂，都市浪漫的 blue hour 蓝调时刻',
  cafe:
    '复古咖啡馆临街落地窗边，木质吧台与手冲器具泛着温润光泽，暖黄吊灯与门外霓虹交相辉映，一杯拉花拿铁冒着热气，雨珠缓缓滑过玻璃，慵懒法式情调',
  camping:
    '山谷露营地，帆布帐篷透出暖黄灯光，篝火火星袅袅升腾，头顶银河横贯夜空繁星璀璨，远山剪影层层叠叠，草丛间萤火虫明灭，静谧浪漫的夏夜',
  // ===== 梦幻唯美 =====
  aurora:
    '极地雪原上空，绿紫色极光如绸带般舞动舒展，星辰璀璨低垂，冰晶地表反射着流动极光，雪丘起伏如凝固海浪，梦幻震撼的极夜奇景，冷色调大片质感',
  clouds:
    '柔软云端之上，巨大双彩虹横跨天际，棉花糖般的云朵蓬松立体，光晕柔和弥散，远处热气球缓缓漂浮，马卡龙粉彩色调，梦幻治愈的天空之城',
  monet:
    '莫奈笔下 impressionist 印象派花园，睡莲池上木桥静卧，鸢尾与睡莲色彩斑斓交融，光斑在水面轻轻跃动，笔触朦胧柔和，油画质感的法式光影花园',
  ocean:
    '清澈热带海底，珊瑚丛色彩斑斓如花园，气泡串串升起，光束从水面折射而下形成神圣光柱，银色鱼群穿梭而过，白沙上散落贝壳珍珠，晶莹剔透的海底仙境',
};

/** 默认场景（用户不选时用温馨客厅） */
export const DEFAULT_FAMILY_PHOTO_SCENE: FamilyPhotoScene = 'livingroom';

/**
 * 风格 → 提示词模板
 * 基于项目提示词库《宠物回忆录-提示词库.md》§六「通用视觉风格库」的官方风格关键词，
 * 按「生图场景」裁剪并中英混排（pixar=§6.4 皮克斯 / ghibli=§6.3 吉卜力 / oil=§6.7 油画 /
 * ink=§6.6 水墨 / nordic=§6.9 极简北欧 / cyberpunk=§6.1 赛博朋克），
 * 不再使用此前硬编码的简版英文模板
 */
const STYLE_PROMPTS: Record<FamilyPhotoStyle, string> = {
  pixar:
    '皮克斯3D动画风格, Pixar style, Disney 3D animation, cartoon render, smooth textures, expressive eyes, exaggerated proportions, subsurface scattering',
  ghibli:
    '吉卜力动画风格, Studio Ghibli style, hand-drawn animation, soft watercolor backgrounds, cel-shaded, Hayao Miyazaki aesthetic',
  oil:
    '印象派油画风格, oil painting, impasto, thick brush strokes, canvas texture, Monet, impressionist, palette knife',
  ink:
    '中国水墨画风格, Chinese ink wash painting, sumi-e, brush strokes, rice paper texture, zen aesthetic, black ink on cream paper',
  nordic:
    '极简北欧风格, minimalist, Scandinavian design, clean lines, negative space, muted tones, geometric, zen',
  cyberpunk:
    '赛博朋克风格, cyberpunk, neon lights, rain-slicked streets, holographic, dystopian, LED, futuristic city, purple and cyan',
};

const MAX_429_RETRIES = 2;

/** 家庭成员宠物信息（导出供单测构造提示词用例） */
export interface MemberInfo {
  petId: string;
  name: string;
  species: string;
  /** 品种可能为空（档案未填），构建提示词时必须兜底，不能出现空串/undefined */
  breed: string | null;
  /**
   * 全家福参考图 URL（仅真实形象：用户上传的真实照片 或 基于照片生成的 AI 形象）
   * 品牌默认头像（预设/家庭页兜底图）已在此字段置 null，不会进参考图
   */
  photoUrl: string | null;
  /**
   * 是否有真实形象（真实照片 / AI 生成形象）；false = 只有默认头像或无头像
   * 由 collectMemberPhotos 填充；直接手造成员（如单测 buildPrompt）可省略（undefined 视为无真实形象）
   */
  hasRealImage?: boolean;
}

/**
 * 品牌默认头像判定
 * 预设形象库 / 家庭页兜底头像（home-style 系列）只是"默认图"，不是小猫的真实样子，
 * 绝不能作为全家福参考图（否则生成的"全家福"是默认卡通图而非真实宠物）。
 * 品牌头像两个来源：
 * - 服务端 `/uploads/avatars/home-style/`（家庭页按品种兜底展示）
 * - 本地预设资源 `preset-home`（形象定制页"预设形象"保存进 avatar_cartoon_url）
 */
export function isBrandPresetUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  // 按路径段匹配（带斜杠），避免用户真实照片 URL 恰好含该子串被误杀
  return url.includes('/home-style/') || url.includes('/preset-home/');
}

interface GenerateFamilyPhotoParams {
  familyId: string;
  userId: string;
  style: FamilyPhotoStyle;
  /** 全家福场景（不传用默认温馨客厅） */
  scene?: FamilyPhotoScene;
  /**
   * 用户自定义场景描述（如"在我家的院子里"）
   * 服务端清洗（去换行/控制字符、截断 60 字）后拼进提示词，并存入 description 字段供相册展示
   */
  customScene?: string;
  /**
   * 成员排位（petId 有序数组）：前端全家福面板让用户排左右座次，
   * 提示词按此顺序写"从左到右依次是…"，参考图顺序同步对应。
   * 缺省/含未知 id 时：排位内的按给定顺序靠前，其余保持原顺序追加
   */
  memberOrder?: string[];
}

/**
 * 清洗用户自定义场景描述
 * 防注入与排版破坏：去换行/制表符等控制字符 → 压缩连续空白 → 截断 60 字
 * （与提示词库"清洗兜底"金科玉律一致：自由文本进 prompt 前必须过清洗）
 */
function cleanCustomScene(raw: string | undefined): string | null {
  if (!raw) return null;
  const cleaned = raw
    .replace(/[\r\n\t\f\v]+/g, ' ')   // 换行/制表符统一替换为空格，防止提示词被断行注入
    .replace(/\s+/g, ' ')             // 压缩连续空格
    .trim()
    .slice(0, 60);                    // 截断兜底（schema 已限 60，双保险防绕过 schema 的调用方）
  return cleaned || null;             // 清洗后为空串视同未填
}

/**
 * 构建宠物列表描述与数量汇总
 * ⚠️ 关键：绝不把宠物名字写进提示词！
 * 名字对文生图模型是噪声甚至灾难——猫咪叫「烧鸡」就会被模型画成一只烧鸡，
 * 且会把多张参考猫图全部覆盖成一只鸡。外貌一致性靠参考照片保证，
 * 提示词只写「品种 + 物种」，名字只用于入库记录（member_names），不进 prompt。
 */
function buildPetList(members: MemberInfo[]): { list: string; summary: string } {
  // 逐只描述：一只英短猫咪、一只美短猫咪……（主体描述统一走公共模块，含品种兜底）
  const list = members.map((m) => petSubjectText(m.breed, m.species)).join('、');

  // 数量汇总：如「4只猫咪」或「3只猫咪和1只狗狗」，明确告诉模型画几只
  const catCount = members.filter((m) => m.species !== 'dog').length;
  const dogCount = members.length - catCount;
  const parts: string[] = [];
  if (catCount > 0) parts.push(`${catCount}只猫咪`);
  if (dogCount > 0) parts.push(`${dogCount}只狗狗`);

  return { list, summary: parts.join('和') };
}

/**
 * 构建全家福合成提示词
 * 结构 = 风格（提示词库 §六） + 场景（§二/§5.2，多维精美描写） + 自定义场景补充 + 数量/物种
 *   + 宠物列表 + 角色一致性 + 主体锁定
 * 场景层与风格层正交：场景负责"环境"，画风交给风格层；角色一致性靠参考图锁定，
 * 场景再华丽也不会改变宠物外貌。
 * 角色一致性与主体锁定对应提示词库 §0.6「全局角色锁定表」与 §四「角色一致性模板」：
 * 多图合成时外观以参考照片为准，禁止模型自由发挥、增减数量或混入其他主体
 */
export function buildPrompt(
  members: MemberInfo[],
  style: FamilyPhotoStyle,
  scene?: FamilyPhotoScene,
  customScene?: string,
): string {
  const { list, summary } = buildPetList(members);
  const total = members.length;
  // 有任一成员照片才声明"以参考照片为准"，否则提示词会"说谎"（无图可参考却要求完全一致）
  const hasReference = members.some((m) => m.photoUrl);
  // 场景（默认温馨客厅）：时间光线+空间层次+材质细节+色彩基调+氛围的多维精美描写
  const sceneText = SCENE_PROMPTS[scene ?? DEFAULT_FAMILY_PHOTO_SCENE];
  // 用户自定义场景描述：清洗后自然拼在预设场景之后，作为环境补充
  const customText = cleanCustomScene(customScene);

  // 多只时显式声明"从左到右依次是"——成员数组顺序=排位顺序=参考图数组顺序，
  // 把用户的座次意图翻译成模型可执行的方位语言（名字不出现，靠外貌+顺序区分）
  const introText =
    total > 1
      ? `画面中共有${summary}，从左到右依次是：${list}。`
      : `画面中共有${summary}：${list}。`;

  const parts = [
    STYLE_PROMPTS[style],
    `一张温馨的全家福合影，${sceneText}${customText ? `，${customText}` : ''}，${introText}`,
    '所有宠物并排坐在一起，表情自然温馨，构图完整。',
  ];
  if (hasReference) {
    parts.push('以参考照片为准：保持每只宠物的毛色、花纹、体型、五官与参考图完全一致，不改变外貌，不增减数量。');
    if (total > 1) {
      parts.push('参考照片的顺序与画面从左到右的宠物顺序一一对应。');
    }
  }
  parts.push(`画面中只出现这${total}只宠物，不要出现其他动物、人物或食物。`, '高质量，细节丰富。');
  return parts.join(' ');
}

/**
 * 收集家庭成员宠物照片URL
 * 从 pet_family_members JOIN pet_profiles 获取成员信息和照片
 * 分级：photoUrl 只保留"真实形象"（真实照片/AI 生成形象），
 * 品牌默认头像（home-style 预设/兜底图）一律视为无真实形象
 */
async function collectMemberPhotos(familyId: string, userId: string): Promise<MemberInfo[]> {
  const result = await pool.query(
    `SELECT
       p.id AS "petId",
       p.name,
       p.species,
       p.breed,
       -- 参考图优先级：真实照片 > 全方位角色设定图（迁移 030，四视图全身参考，
       -- 比单头像更能锁定体型花纹） > 卡通头像
       COALESCE(p.avatar_photo_url, p.avatar_multiview_url, p.avatar_cartoon_url) AS "photoUrl"
     FROM pet_family_members m
     JOIN pet_profiles p ON p.id = m.pet_id
     JOIN pet_families f ON f.id = m.family_id AND f.user_id = $2
     WHERE m.family_id = $1
     ORDER BY m.joined_at ASC`,
    [familyId, userId],
  );
  // 真实形象判定：URL 非空且不是品牌默认头像
  return result.rows.map((r) => {
    const real = !!r.photoUrl && !isBrandPresetUrl(r.photoUrl);
    return { ...r, photoUrl: real ? r.photoUrl : null, hasRealImage: real };
  });
}

/**
 * 调用 Seedream API 多图合成
 * 尝试传入多张参考图，若不支持多图则降级为纯文本生图
 */
async function callSeedreamMulti(
  prompt: string,
  imageUrls: string[],
  apiKey: string,
  retryCount: number = 0,
): Promise<string | null> {
  const body: Record<string, unknown> = {
    model: 'doubao-seedream-4-0-250828',
    prompt,
    size: '1024x1024',
    n: 1,
    // 去掉 Seedream 平台水印（样式不可控且带平台色彩），
    // 生成图改由 imageBadge.hostAiImage 转存到本站 uploads 后再入库
    watermark: false,
  };

  // Seedream 4.0 支持多图输入：传入 images 数组做参考图合成
  if (imageUrls.length > 0) {
    body.images = imageUrls;
  }

  const response = await fetch(SEEDREAM_API, {
    method: 'POST',
    signal: AbortSignal.timeout(60_000), // 2026-09 审查 P1：补超时防上游挂起拖死同步请求（生图较慢取 60s）
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    if (response.status === 429 && retryCount < MAX_429_RETRIES) {
      const backoff = 5000 * (retryCount + 1);
      await delay(backoff);
      return callSeedreamMulti(prompt, imageUrls, apiKey, retryCount + 1);
    }
    console.error(`[FamilyPhoto] Seedream API error: ${response.status}`);
    return null;
  }

  const data = (await response.json()) as { data: Array<{ url: string }> };
  return data.data?.[0]?.url || null;
}

/**
 * 检查同家庭是否有进行中的生成任务
 */
async function hasActiveTask(familyId: string): Promise<boolean> {
  const result = await pool.query(
    `SELECT 1 FROM family_photos
     WHERE family_id = $1 AND status IN ('pending', 'processing')
     LIMIT 1`,
    [familyId],
  );
  return (result.rowCount ?? 0) > 0;
}

/**
 * 生成全家福主入口
 * 1. 校验家庭归属 + 成员数
 * 2. 收集成员照片
 * 3. 构建提示词
 * 4. 调用 Seedream 多图合成
 * 5. 入库
 */
export async function generateFamilyPhoto(params: GenerateFamilyPhotoParams): Promise<{
  success: boolean;
  photoId?: string;
  photoUrl?: string;
  message?: string;
  /** 业务错误码（前端据此做引导，如 MEMBER_NO_REAL_IMAGE） */
  code?: string;
  /** 缺少真实形象的成员（引导前端跳转生成形象） */
  missingMembers?: Array<{ petId: string; name: string }>;
}> {
  const { familyId, userId, style, scene, customScene, memberOrder } = params;
  // 自定义场景清洗一次复用：拼提示词 + 入库 description（相册展示用户当时写的场景描述）
  const cleanedCustomScene = cleanCustomScene(customScene);
  const apiKey = config.seedream.apiKey;

  if (!apiKey) {
    return { success: false, message: 'AI 图像生成服务未配置' };
  }

  // 检查并发生成
  if (await hasActiveTask(familyId)) {
    return { success: false, message: '该家庭已有进行中的全家福生成任务，请稍后再试' };
  }

  // 收集成员信息
  const members = await collectMemberPhotos(familyId, userId);
  if (members.length === 0) {
    return { success: false, message: '该家庭没有宠物成员，请先添加成员' };
  }
  if (members.length < 2) {
    return { success: false, message: '全家福需要至少2位家庭成员' };
  }

  // 分级校验：全家福参考图必须是"真实形象"（真实照片 / AI 生成形象）。
  // 只有品牌默认头像或无头像的成员，先引导生成形象，不硬生成——
  // 否则生成的是"默认卡通图全家福"，不是真实的小猫（用户明确要求）
  const missingReal = members.filter((m) => !m.hasRealImage);
  if (missingReal.length > 0) {
    const names = missingReal.map((m) => m.name).join('、');
    return {
      success: false,
      code: 'MEMBER_NO_REAL_IMAGE',
      message: `「${names}」还没有真实形象，请先为它上传照片或生成专属形象，再生成全家福`,
      missingMembers: missingReal.map((m) => ({ petId: m.petId, name: m.name })),
    };
  }

  // 成员排位：按前端传的 petId 有序数组重排（稳定排序，未提及的成员保持原顺序追加在后）。
  // 排位决定提示词"从左到右依次是…"与参考图数组的对应关系——用户用名字沟通座次，
  // 模型收到的是顺序化的外貌列表（名字依然不进提示词）。
  // ⚠️ 必须在 memberNames/photoUrls 取值之前执行，否则参考图数组还是旧顺序
  if (memberOrder && memberOrder.length > 0) {
    const orderIdx = new Map(memberOrder.map((id) => [id, memberOrder.indexOf(id)]));
    members.sort(
      (a, b) =>
        (orderIdx.get(a.petId) ?? Number.MAX_SAFE_INTEGER) -
        (orderIdx.get(b.petId) ?? Number.MAX_SAFE_INTEGER),
    );
  }

  const memberNames = members.map((m) => m.name);
  const photoUrls = members.map((m) => m.photoUrl).filter(Boolean) as string[];

  // 自定义场景里的宠物名 → 外貌指代转译：用户会自然写「烧鸡戴着生日帽」，
  // 名字进提示词会被画成烧鸡（金科玉律 #1），这里替换为「左起第一只英短猫咪」式指代。
  // ⚠️ 仅替换提示词用的文本；入库 description 仍存用户原文（相册给人看）
  const promptCustomScene = cleanedCustomScene
    ? translatePetNames(cleanedCustomScene, members)
    : undefined;

  // 创建 processing 记录（scene 记录所用场景、description 记录自定义场景描述，相册据此展示）
  const photoId = crypto.randomUUID();
  await pool.query(
    `INSERT INTO family_photos (id, family_id, user_id, style, scene, description, member_count, member_names, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'processing')`,
    [photoId, familyId, userId, style, scene ?? DEFAULT_FAMILY_PHOTO_SCENE, cleanedCustomScene, members.length, memberNames],
  );

  // 构建提示词（⚠️ 必须把 scene/转译后的自定义场景传进去：此前漏传导致场景定义形同虚设，选了也白选）
  const prompt = buildPrompt(members, style, scene, promptCustomScene);

  // 调用 Seedream 多图合成（Seedream 4.0 内置安全过滤）
  const generatedUrl = await callSeedreamMulti(prompt, photoUrls, apiKey);

  if (!generatedUrl) {
    await pool.query(
      `UPDATE family_photos SET status = 'failed', updated_at = now() WHERE id = $1`,
      [photoId],
    );
    return { success: false, message: 'AI 生成失败，请稍后重试' };
  }

  // 转存本站 uploads（Seedream 临时链接过期即失效，必须取回落盘）；
  // hostAiImage 内部失败会降级返回原图 URL，不会阻断主流程
  const finalUrl = await hostAiImage(generatedUrl);

  // 入库
  await pool.query(
    `UPDATE family_photos SET photo_url = $1, status = 'completed', updated_at = now() WHERE id = $2`,
    [finalUrl, photoId],
  );
  return { success: true, photoId, photoUrl: finalUrl };
}

/**
 * 查询家庭全家福照片列表
 */
export async function getFamilyPhotos(
  familyId: string,
  userId: string,
): Promise<Array<{
  id: string;
  photoUrl: string | null;
  photoType: string;
  style: string;
  /** 生成时的场景（livingroom/seaside 等）；上传/手绘照片为 null，前端据此决定是否展示场景标签 */
  scene: string | null;
  /** 自定义场景描述（用户生成时填写的话），前端相册直接展示 */
  description: string | null;
  memberCount: number;
  memberNames: string[];
  status: string;
  createdAt: string;
}>> {
  const result = await pool.query(
    `SELECT
       id, photo_url AS "photoUrl", photo_type AS "photoType",
       style, scene, description,
       member_count AS "memberCount", member_names AS "memberNames",
       status, created_at AS "createdAt"
     FROM family_photos
     WHERE family_id = $1 AND user_id = $2
     ORDER BY created_at DESC`,
    [familyId, userId],
  );
  return result.rows;
}

/**
 * 删除全家福照片
 */
export async function deleteFamilyPhoto(
  photoId: string,
  familyId: string,
  userId: string,
): Promise<boolean> {
  const result = await pool.query(
    `DELETE FROM family_photos WHERE id = $1 AND family_id = $2 AND user_id = $3`,
    [photoId, familyId, userId],
  );
  return (result.rowCount ?? 0) > 0;
}

/**
 * 保存用户上传或 Canvas 降级生成的全家福
 * 与 AI 生成不同，此接口直接入库已完成状态的照片，不触发 Seedream 调用
 */
export async function saveUploadedFamilyPhoto(params: {
  familyId: string;
  userId: string;
  photoUrl: string;
  photoType: 'canvas_fallback' | 'uploaded';
  memberCount: number;
  memberNames: string[];
  description?: string | null;
}): Promise<{ id: string }> {
  const { familyId, userId, photoUrl, photoType, memberCount, memberNames, description } = params;
  const photoId = crypto.randomUUID();

  await pool.query(
    `INSERT INTO family_photos
      (id, family_id, user_id, photo_url, photo_type, style, description, member_count, member_names, status)
     VALUES ($1, $2, $3, $4, $5, 'uploaded', $6, $7, $8, 'completed')`,
    [photoId, familyId, userId, photoUrl, photoType, description ?? null, memberCount, memberNames],
  );

  return { id: photoId };
}