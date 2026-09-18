/**
 * 回忆录关键帧服务（模式 C 落地：先专用关键帧，再图生视频）
 *
 * 背景与定位（为什么需要这一层）：
 *   回忆录分镜链路在此之前是「用户照片直接当 Seedance 首帧」。用户照片都是生活随拍——
 *   构图随意、光线杂乱、画幅不一，Seedance 只能在此之上"动起来"，成片观感参差。
 *   提示词库 §十九 已记录：**模式 C（先关键帧再视频）文档层早有、代码层从未落地**，
 *   缺的就是"关键帧生成 → 再喂 Seedance"这一层中间产物。
 *   本模块补上这一层：每镜先用 Seedream 图生图生成一张**电影质感的关键帧静帧**，
 *   再由 Seedance 以该关键帧为首帧生成动效片段。
 *
 * 参考图职责（对应提示词库 §4.2「每镜头参考图职责」）：
 *   - 参考图1 = 该镜的真实照片：该镜的**画面依据**（姿态取静、构图取准、场景取真）；
 *   - 参考图2 = 宠物四视图全身设定图（`pet_profiles.avatar_multiview_url`，可空）：
 *     **只用于核对毛色、花纹、体型比例与五官等外貌事实**，
 *     不复制它的背景、构图、动作与分格版式（设定图是四宫格，必须显式禁止出分格）。
 *
 * 依赖复用（不另起一套）：
 *   - 提示词公共约束（身份锁定 / 数量锁定 / 名字红线）复用 `petPrompt.ts`；
 *   - 生成图落盘 + AI 角标复用 `imageBadge.addAiBadge`（与全家福/头像/表情包同一条路径）；
 *   - Seedream 的端点、模型名、超时与 429 重试口径与 `image2DService`、
 *     `familyPhotoService` 保持一致（那两处分别是单图版与未导出的多图版，
 *     本模块需要「多图 + 16:9 尺寸」，故按同一口径本地实现，不动兄弟模块的导出面）。
 *
 * 红线（违反即事故）：
 *   ① 宠物名字绝不进提示词 —— 历史线上事故：猫叫「烧鸡」被画成一只烤鸡。
 *      本模块入参只接受外貌指代（`petSubjectText` 产物），**结构上不接收名字字段**。
 *   ② 关键帧必须是**静帧** —— 提示词显式排除运动模糊/拖影，且不得引入奔跑跳跃
 *      （项目默认「静图安全」基调：不从静态照片凭空生成照片里没有的大动作）。
 *   ③ 失败一律返回 null，绝不抛异常给主链路 —— 关键帧是「尽力项」，
 *      调用方会回落原照片，不能因它拖垮整片生成。
 */
import { config } from '../config.js';
import { sanitizeError } from '../utils/sanitize.js';
import { delay } from '../utils/delay.js';
// 提示词公共约束：身份锁定（以参考图为准）+ 数量锁定（只出现这一只）
import { PET_IDENTITY_KEEP, PET_ONLY_ONE } from './petPrompt.js';
// AI 生图统一落盘 + 品牌角标（失败降级返回原图，见该模块注释）
import { addAiBadge } from './imageBadge.js';

/** Seedream 生图端点（与 image2DService / familyPhotoService 同一地址，换端点须三处同步） */
const SEEDREAM_API = 'https://ark.cn-beijing.volces.com/api/v3/images/generations';

/** Seedream 模型（与 image2DService / familyPhotoService 一致；换模型须三处同步） */
const SEEDREAM_MODEL = 'doubao-seedream-4-0-250828';

/**
 * 关键帧画幅：16:9
 * 与 Seedance 段的 `ratio` 常量（`videoGenerationService.MEMOIR_SEGMENT_RATIO`）成对存在：
 * 关键帧是段视频的首帧，两者画幅不一致会引入黑边或裁切。
 */
export const KEYFRAME_ASPECT_RATIO = '16:9';

/**
 * 关键帧像素尺寸：1920x1080
 * 标准 16:9、207 万像素（落在 Seedream 4.0 可接受的尺寸区间内，高于其最小像素下限）。
 * 尺寸必须与提示词里的画幅声明一致，否则会出现「提示词写 16:9、出图却是 1:1」的错配。
 * ⚠️ 若上游对尺寸取值收紧（返回 4xx），此处会被 catch 成 null → 主链路回落原照片，
 *    表现为"关键帧没生效"而不是整片失败（可在 [MemoirKeyframe] 日志里看到原因）。
 */
const KEYFRAME_SIZE = '1920x1080';

/** Seedream 请求超时（毫秒）：生图较慢，口径与 image2DService 一致 */
const REQUEST_TIMEOUT_MS = 60_000;

/** 429 限流最大重试次数（口径与 image2DService / familyPhotoService 一致） */
const MAX_429_RETRIES = 2;

/** 关键帧提示词的组装入参 */
export interface MemoirKeyframePromptParams {
  /** 该镜已组装好的十段 prompt（M2 `buildFinalSegmentPrompt` 产物），作为画面依据 */
  segmentPrompt: string;
  /** 主体外貌指代（`petSubjectText` 产物，如「一只英短猫咪」）；⚠️ 绝不传宠物名字 */
  petSubject: string;
  /** 是否带第二张参考图（宠物四视图设定图）——决定要不要写"参考图2"的职责说明 */
  hasMultiviewReference: boolean;
  /** 该镜时长（秒）：向模型交代这张首帧将来要撑起多长的镜头 */
  durationSec: number;
}

/**
 * 组装关键帧生成提示词
 *
 * 结构 = 【画面依据（该镜十段 prompt）】+【本图性质：静止关键帧】+【主体与一致性】
 *        +【参考图职责】+【画幅 16:9】+【影像质感】+【排除项】
 *
 * 为什么把十段 prompt 整段塞进来而不是重写一套：
 *   十段已经是 M1 分镜 + M2 补全 + Locks 的产物，包含本镜的景别/场景/光线/角色锚点。
 *   另写一套等于让关键帧和视频"各说各话"，画面必然漂移；这里只补十段没有的两件事——
 *   「这是静帧」「画幅是 16:9」。
 *
 * @param params - 组装入参（见 MemoirKeyframePromptParams）
 * @returns 可直接投喂 Seedream 的完整提示词（纯中文主体 + 约束；不含宠物名字）
 */
export function buildMemoirKeyframePrompt(params: MemoirKeyframePromptParams): string {
  const { segmentPrompt, petSubject, hasMultiviewReference, durationSec } = params;

  // 1) 画面依据：整段复用该镜的十段 prompt（只 trim，不裁剪内容，防止丢段）
  const basis = `【画面依据 · 该镜分镜脚本】\n${(segmentPrompt || '').trim()}`;

  // 2) 本图性质：静帧。既有"忽略运镜"的正向说明，也有逐条排泄的静止边界
  const still = [
    '【本图性质：静止关键帧】',
    `本图是后续一段约 ${durationSec} 秒视频的**首帧定格画面**（单张静帧照片；不是视频、不是多张拼图、不是分镜表、不是四宫格）。`,
    '只取上面分镜脚本里的静态信息——景别、构图、场景、光线、角色与氛围；',
    '忽略其中的镜头运动与时间过程描述（推镜/摇镜/变焦/漂移/跟拍属于拍摄方式，不产生静态画面内容）。',
    '严格的静止边界：画面无运动模糊、无动态拖影、无残影、无速度线、无动作特效；',
    `${petSubject}处于安定静止的姿态（安静坐卧，或原地站定的瞬间），不奔跑、不跳跃、不腾空、不追逐、不扑咬、不翻滚；画面中不存在正在运动的物体。`,
  ].join('\n');

  // 3) 主体与一致性：复用公共约束常量（身份锁定 / 数量锁定），避免与其它生图模块口径漂移
  const subject = [
    '【主体与一致性】',
    `主体：${petSubject}。${PET_ONLY_ONE}。`,
    `${PET_IDENTITY_KEEP}。`,
  ].join('\n');

  // 4) 参考图职责：设定图只锁外貌，不复制版式（否则模型可能照抄四视图的分格）
  const reference = hasMultiviewReference
    ? [
        '【参考图职责】',
        '参考图1（真实照片）：本镜的画面依据——姿态取静、构图取准、场景取真、屏幕朝向照旧，不左右翻转。',
        `参考图2（${petSubject}的多角度角色设定图）：仅用于核对毛色、花纹、体型比例与五官等外貌事实；不要复制它的背景、构图、动作，尤其不要复制它的分格版式——最终只输出单一视角的一张完整画面。`,
      ].join('\n')
    : [
        '【参考图职责】',
        '参考图1（真实照片）：本镜的画面依据——姿态取静、构图取准、场景取真、屏幕朝向照旧，不左右翻转。',
      ].join('\n');

  // 5) 画幅：提示词显式声明 16:9（与 Seedance 段 ratio、以及本模块的 KEYFRAME_SIZE 三方对齐）
  const aspect = [
    `【画幅】横版 ${KEYFRAME_ASPECT_RATIO} 宽银幕比例（画面宽高比严格 ${KEYFRAME_ASPECT_RATIO}）。`,
    '构图按横版安排：主体落在画面中偏左或偏右的黄金分割位置，四周留出自然呼吸空间；',
    '不出现黑边、不留上下或左右的空白条（非信箱框），主体不被裁切。',
  ].join('\n');

  // 6) 影像质感：只强化"静帧 + 电影感"两个维度，画风仍以分镜的 GLOBAL STYLE 为准（不越权改画风）
  const quality = [
    '【影像质感】电影级静帧摄影质感：自然光影层次，主体清晰锐利、毛发与细节可辨，背景浅景深自然虚化，细腻胶片颗粒，色彩统一通透。',
    '画风一律以分镜脚本的 GLOBAL STYLE 为准，本图不额外引入分镜未指定的画风；',
    '不要过度磨皮、不要塑料感、不要平滑涂抹感。',
  ].join('\n');

  // 7) 排除项：文字/水印/版式类禁令（沿用提示词库各模式尾缀的既有禁令口径）
  const negatives = [
    '【排除项】无可读文字、无字幕、无水印、无 logo、无边框、无时间戳、无分格拼图或多视角版式；',
    '不新增分镜脚本里没有的动物、人物、食物与道具。',
  ].join('\n');

  return [basis, still, subject, reference, aspect, quality, negatives].join('\n\n');
}

/** 关键帧生成的入参（契约固定，调用方只传这些） */
export interface MemoirKeyframeParams {
  /** 该镜的真实照片 URL（必给：图生图的主体参考） */
  photoUrl: string;
  /** 宠物四视图全身设定图 URL（可空；有则作为第二张参考图） */
  multiviewUrl?: string | null;
  /** 该镜已组装好的十段 prompt（作为画面依据） */
  segmentPrompt: string;
  /** 主体外貌指代（`petSubjectText` 产物）；⚠️ 绝不传宠物名字 */
  petSubject: string;
  /** 该镜时长（秒，与 Seedance 段一致） */
  durationSec: number;
}

/**
 * 调用 Seedream 生成关键帧图（多图参考版，带 429 重试与超时）
 *
 * 为什么不用 `image2DService.callSeedream`：它只支持单张参考图（`image` 字段），
 * 而本模块需要「真实照片 + 四视图设定图」两张一起传（`images` 数组）。
 * 请求体形状与 `familyPhotoService.callSeedreamMulti` 对齐，只多一个 16:9 尺寸。
 *
 * @param prompt - 组装好的关键帧提示词
 * @param imageUrls - 参考图 URL 数组（1~2 张，顺序即 prompt 里的「参考图1/2」）
 * @param apiKey - Seedream API Key
 * @param retryCount - 当前重试次数（内部递归使用）
 * @returns 生成图 URL（Seedream 的临时 CDN 链接），失败返回 null
 */
async function callSeedreamForKeyframe(
  prompt: string,
  imageUrls: string[],
  apiKey: string,
  retryCount = 0,
): Promise<string | null> {
  const body: Record<string, unknown> = {
    model: SEEDREAM_MODEL,
    prompt,
    size: KEYFRAME_SIZE,
    n: 1,
    // 水印合规 B 方案：去平台水印，显式标识由 addAiBadge 的自有品牌角标承担
    watermark: false,
  };
  // 有参考图才带 images（无参考图时是纯文生图，避免传空数组触发参数校验失败）
  if (imageUrls.length > 0) body.images = imageUrls;

  const response = await fetch(SEEDREAM_API, {
    method: 'POST',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    // 429 限流：线性退避后重试（口径同 image2DService：5s × 第几次）
    if (response.status === 429 && retryCount < MAX_429_RETRIES) {
      await delay(5000 * (retryCount + 1));
      return callSeedreamForKeyframe(prompt, imageUrls, apiKey, retryCount + 1);
    }
    // 只记状态码，不打响应体（可能含上游内部信息）
    console.warn(`[MemoirKeyframe] Seedream 返回非 2xx: ${response.status}`);
    return null;
  }

  const data = (await response.json()) as { data?: Array<{ url?: string }> };
  return data.data?.[0]?.url || null;
}

/**
 * 生成单镜关键帧（模式 C 的第一步）
 *
 * 流程：组装提示词 → Seedream 多图图生图 → `addAiBadge` 落盘本站 uploads 并返回公网 URL。
 * 任何一步失败（无参考图 / 未配置 Key / 上游报错 / 超时 / 抛异常）都返回 null，
 * 由调用方回落原照片——本函数**不会**向上抛异常。
 *
 * @param params - 见 MemoirKeyframeParams（photoUrl / multiviewUrl / segmentPrompt / petSubject / durationSec）
 * @returns 关键帧图 URL（可访问的 http(s) 地址）；失败返回 null
 */
export async function generateMemoirKeyframe(params: MemoirKeyframeParams): Promise<string | null> {
  const { photoUrl, multiviewUrl, segmentPrompt, petSubject, durationSec } = params;

  // 无真实照片 → 图生图无从谈起（宁可回落到调用方自己的兜底逻辑，也不做文生图凭想象造宠物）
  if (!photoUrl || !photoUrl.trim()) return null;

  const apiKey = config.seedream.apiKey;
  if (!apiKey) {
    console.warn('[MemoirKeyframe] 未配置 Seedream Key，跳过关键帧（首帧将回落原照片）');
    return null;
  }

  try {
    // 参考图顺序即 prompt 里的编号：1=真实照片（画面依据）、2=四视图设定图（外貌核对）
    const imageUrls = multiviewUrl && multiviewUrl.trim() ? [photoUrl, multiviewUrl] : [photoUrl];
    const prompt = buildMemoirKeyframePrompt({
      segmentPrompt,
      petSubject,
      hasMultiviewReference: imageUrls.length > 1,
      durationSec,
    });

    const generatedUrl = await callSeedreamForKeyframe(prompt, imageUrls, apiKey);
    if (!generatedUrl) {
      console.warn('[MemoirKeyframe] Seedream 未返回图片，关键帧生成失败（首帧将回落原照片）');
      return null;
    }

    // 落盘本站 uploads（与全家福/头像/表情包同一路径）。
    // ⚠️ 关键帧是**中间产物**（只作视频首帧、不直接给用户看），故传 visible:false **不合成可见角标**：
    //    角标会被 Seedance 动起来（可能扭曲成渲染缺陷），且等于给成片凭空加一个用户可见元素。
    //    隐式合规不受影响：AIGC tEXt 隐式标识照旧写入（见 imageBadge / aigcMetadata）。
    const hostedUrl = await addAiBadge(generatedUrl, { visible: false });
    return hostedUrl || null;
  } catch (error) {
    // 关键帧是尽力项：任何异常都吞掉（脱敏后记日志），交由调用方回落原照片
    console.warn(`[MemoirKeyframe] 关键帧生成异常，回落原照片: ${sanitizeError(error)}`);
    return null;
  }
}
