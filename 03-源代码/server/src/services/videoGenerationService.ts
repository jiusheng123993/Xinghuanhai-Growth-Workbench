/**
 * 视频生成服务 - 回忆录视频生成的核心引擎
 * 双产品线隔离：
 *   1. 日常回忆录（daily）：静图动效技术，5-30 秒短视频
 *   2. 纪念Vlog（memorial）：多段静图动效合集 + 叙事编排，60-90 秒完整叙事视频
 *
 * 外部 API 集成：
 *   - 日常回忆录：调用火山方舟 Seedance 图生视频 API，单张图片 → 3-8 秒动效片段
 *   - 纪念Vlog：多张图片分别生成动效片段 → ffmpeg 拼接 + 转场 + BGM + 字幕 → 完整视频
 *
 * 安全约束：
 *   - 所有生成的视频必须经过内容审核（由 memoirProcessor 负责）
 *   - 审核失败自动重试（最多 2 次）
 *   - 最终失败需返回错误，调用方负责退款/退额度
 */
import { config, MEMOIR_TIER_CONFIG, MEMOIR_TIER_LABELS, type MemoirTier } from '../config.js';
import { sanitizeError } from '../utils/sanitize.js';
// 宠物档案查询（关键帧需要"四视图设定图 + 品种/物种"，链路里只传了 taskId，故此处按键查一次）
import { pool } from '../db.js';
import {
  createVideoGenerationTask,
  queryVideoTask,
  isSeedanceConfigured,
  type SeedanceTaskStatus,
} from '../adapters/seedanceAdapter.js';
import { delay } from '../utils/delay.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// 回忆录 2.0 模块（M2 提示词组装 / M4 字幕 / M3 旁白）
import { buildFinalSegmentPrompt } from './promptTemplates.js';
import { buildAssContent, type SubtitleItem } from './subtitles.js';
import { synthNarration, type NarrationSegment } from './ttsService.js';
// 模式 C（先专用关键帧再视频）+ 主体外貌指代（petSubjectText：品种兜底，绝不拼宠物名字）
import { generateMemoirKeyframe } from './memoirKeyframeService.js';
import { petSubjectText } from './petPrompt.js';
import type { MemoirScript } from '../schemas/memoirScript.js';

const execFileAsync = promisify(execFile);

/** 视频生成产品线类型 */
export type VideoProductLine = 'daily' | 'memorial';

/** 视频生成请求参数 */
export interface VideoGenerationParams {
  /** 任务 ID（用于日志追踪） */
  taskId: string;
  /** 产品线类型 */
  productLine: VideoProductLine;
  /** 回忆录档位（2026-09-09 三档）：传入后按档位边界校验照片/时长，缺省回退产品线校验（历史调用兼容） */
  tier?: MemoirTier;
  /** 源照片 URL 数组（日常 1-3 张，纪念 8-15 张） */
  sourcePhotos: string[];
  /** 用户提供的文案（可选，用于字幕/叙事） */
  sourceText?: string | null;
  /** 音乐风格 */
  musicStyle?: string | null;
  /** 目标时长（秒），日常 5-30，纪念 60-90 */
  duration?: number | null;
  /** 风格预设 */
  stylePreset?: string | null;
  /** 用户导入的自定义 BGM URL（2026-09-09，合成优先使用；无则用内置 incompetech 曲） */
  customBgmUrl?: string | null;
  /**
   * AI 分镜脚本（回忆录 2.0，M1 生成）
   * 存在时走"分镜驱动"新管线（十段提示词 + 字幕 + 旁白 + xfade）；
   * 不存在时走旧管线（兼容历史任务）
   */
  script?: MemoirScript | null;
}

/** 视频生成结果 */
export interface VideoGenerationResult {
  /** 最终视频 URL */
  videoUrl: string;
  /** 预览视频 URL（较短或低分辨率） */
  previewUrl: string;
  /** 实际视频时长（秒） */
  actualDuration: number;
  /** 生成方式（用于审计） */
  engine: string;
}

/**
 * 产品线配置常量（**历史遗留兜底**，不是档位边界）
 *
 * ⚠️ 边界口径以**档位**为准（`config.ts` 的 `MEMOIR_TIER_CONFIG`）。这里的 memorial=8-15 恰好等于
 * 「完整档」的边界，但产品线与档位是多对一（standard 与 full 共用 memorial 线），
 * 所以**只应在调用方拿不到 tier 的历史路径上作为兜底**，永远不要用它替代档位校验。
 * @deprecated 新代码请用 `validateTierPhotoCount(tier, count)` / `validateTierDuration(tier, duration)`
 */
export const PRODUCT_LINE_CONFIG = {
  daily: {
    minPhotos: 1,
    maxPhotos: 3,
    minDuration: 5,
    maxDuration: 30,
    defaultDuration: 15,
  },
  memorial: {
    minPhotos: 8,
    maxPhotos: 15,
    minDuration: 60,
    maxDuration: 90,
    defaultDuration: 75,
  },
} as const;

/** 回忆录档位类型由 config.ts 提供（单一事实源），本模块提供映射与校验函数 */
export { MEMOIR_TIER_CONFIG as TIER_CONFIG, MEMOIR_TIER_LABELS as TIER_LABELS } from '../config.js';

/**
 * 按档位校验照片数量
 * @returns 错误信息（null 表示通过）
 */
export function validateTierPhotoCount(tier: MemoirTier, count: number): string | null {
  const cfg = MEMOIR_TIER_CONFIG[tier];
  if (count < cfg.minPhotos || count > cfg.maxPhotos) {
    return `${MEMOIR_TIER_LABELS[tier]}照片数量需 ${cfg.minPhotos}-${cfg.maxPhotos} 张，当前 ${count} 张`;
  }
  return null;
}

/**
 * 按档位校验成片时长
 * @returns 错误信息（null 表示通过）
 */
export function validateTierDuration(tier: MemoirTier, duration: number | null): string | null {
  const cfg = MEMOIR_TIER_CONFIG[tier];
  if (duration === null) return null;
  if (duration < cfg.minDuration || duration > cfg.maxDuration) {
    return `${MEMOIR_TIER_LABELS[tier]}时长需 ${cfg.minDuration}-${cfg.maxDuration} 秒，当前 ${duration} 秒`;
  }
  return null;
}

/** Seedance 单段视频最大时长（秒） */
const SEEDANCE_MAX_SEGMENT_DURATION = 8;

/**
 * 回忆录每段视频的画幅（Seedance `ratio`）—— 固定 16:9
 *
 * 为什么固定画幅（不再用 'adaptive'）：
 *   adaptive 表示"跟随首帧图片比例"，而回忆录每镜的首帧来源不同（16:9 关键帧、
 *   竖版手机照、方图、横版老照片），逐镜画幅不一致 → xfade 拼接时要么出现黑边、
 *   要么被迫逐镜裁切，成片观感参差。用户已拍板全片统一 16:9。
 *   关键帧生成侧（memoirKeyframeService）用同一画幅，保证「首帧画幅 = 段画幅」，
 *   不再靠 Seedance 二次裁切去凑；静态照片段（generateStaticSegment）本就按 16:9
 *   缩放加黑边补边，三方一致。
 */
export const MEMOIR_SEGMENT_RATIO = '16:9';

/** 任务轮询间隔（毫秒） */
const POLL_INTERVAL_MS = 10_000;

/** 任务轮询最大次数（约 8 分钟） */
const MAX_POLL_ATTEMPTS = 48;

/** 服务器工作目录（用于拼接临时文件） */
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOAD_DIR = path.resolve(__dirname, '..', config.uploadDir);

/** 情感曲线对应的动效提示词模板（纪念Vlog用） */
const EMOTION_PROMPTS: Record<string, string> = {
  calm: '缓慢稳定的镜头，画面宁静平和，轻微的光影流动',
  memory: '温柔的推拉镜头，仿佛时光倒流，画面带有回忆的柔光',
  pain: '镜头沉重缓慢，光影渐暗，带有怀念的哀伤感',
  relief: '镜头逐渐开阔明亮，画面如释重负，温暖的光线',
  lingering: '长镜头缓缓停留，余韵悠长，画面渐渐淡出',
};

/** 音乐风格 → 提示词描述映射 */
const MUSIC_STYLE_HINTS: Record<string, string> = {
  warm: '温馨治愈',
  nostalgic: '怀旧抒情',
  piano: '轻柔钢琴',
  gentle: '舒缓悠扬',
  bright: '明亮轻快',
};

/**
 * BGM 内置曲库（2026-09-09 BGM 合成接入）：全部 incompetech.com 的 Kevin MacLeod 作品，
 * CC BY 3.0 免费可商用（需署名，页面已常驻署名）。
 * 键 = 前端 BGM key 经 mapBGMKeyToMusicStyle 转的音乐风格枚举；值 = uploads/bgm/ 下音频文件名。
 */
const BGM_FILES: Record<string, string> = {
  peaceful: 'piano-preview.mp3',   // 温柔时光（钢琴曲）→ Bittersweet
  warm: 'guitar-preview.mp3',      // 暖心回忆（轻快）→ Life of Riley
  nostalgic: 'strings-preview.mp3', // 深情告白（弦乐）→ Healing
  cheerful: 'upbeat-preview.mp3',  // 欢快瞬间（轻快节奏）→ Carefree
};

/** 档位 → 生成管线映射：standard 与 full 均走多段合集（memorial 管线），仅 light 走单段静图动效（daily 管线） */
export function mapTierToGenerationLine(tier: MemoirTier): VideoProductLine {
  return tier === 'light' ? 'daily' : 'memorial';
}

/**
 * 解析回忆录档位（兼容历史请求）
 * @param tier 请求显式携带的档位（新契约，可选）
 * @param memoirType 回忆录类型（历史契约）——tier 缺省时按类型回退：memorial→full，其余→light
 * @returns 归一化后的档位
 */
export function resolveMemoirTier(tier: string | undefined | null, memoirType: string): MemoirTier {
  if (tier === 'light' || tier === 'standard' || tier === 'full') return tier;
  return memoirType === 'memorial' ? 'full' : 'light';
}

/**
 * 根据 memoir_type 映射到产品线
 */
export function mapMemoirTypeToProductLine(memoirType: string): VideoProductLine {
  // memorial 类型走纪念 Vlog 产品线
  if (memoirType === 'memorial') {
    return 'memorial';
  }
  // daily/seasonal/milestone/custom 走日常回忆录产品线
  return 'daily';
}

/**
 * 校验源照片数量是否符合产品线要求（**历史遗留兜底**）
 *
 * ⚠️ 不要用于新代码：它按产品线取边界，而 standard 与 full 共用 memorial 线，
 * 拿只服务某一档的边界去校验另一档必然误伤——2026-09-11「标准档付不了款」事故即为该模式所致
 * （当时 `memoirScriptService` 也按产品线校验，标准档 5-7 张被完整档 8-15 门槛拦住）。
 * 新代码一律用 `validateTierPhotoCount(tier, count)`；本函数仅保留给拿不到 tier 的历史调用方。
 * @deprecated 请改用 `validateTierPhotoCount(tier, photoCount)`
 * @returns null 表示通过，否则返回错误消息
 */
export function validatePhotoCount(
  productLine: VideoProductLine,
  photoCount: number,
): string | null {
  const cfg = PRODUCT_LINE_CONFIG[productLine];
  if (photoCount < cfg.minPhotos || photoCount > cfg.maxPhotos) {
    return `${productLine === 'memorial' ? '纪念Vlog' : '日常回忆录'}照片数量需 ${cfg.minPhotos}-${cfg.maxPhotos} 张，当前 ${photoCount} 张`;
  }
  return null;
}

/**
 * 校验目标时长是否符合产品线要求（**历史遗留兜底**）
 * ⚠️ 产品线口径的兜底同上：standard 与 full 共用 memorial 线，拿单档边界校验另一档必然误伤。
 * 新代码请用 `validateTierDuration(tier, duration)`。
 * @deprecated 请改用 `validateTierDuration(tier, duration)`
 * @returns null 表示通过，否则返回错误消息
 */
export function validateDuration(
  productLine: VideoProductLine,
  duration: number | null | undefined,
): string | null {
  if (duration === null || duration === undefined) return null;
  const cfg = PRODUCT_LINE_CONFIG[productLine];
  if (duration < cfg.minDuration || duration > cfg.maxDuration) {
    return `${productLine === 'memorial' ? '纪念Vlog' : '日常回忆录'}时长需 ${cfg.minDuration}-${cfg.maxDuration} 秒，当前 ${duration} 秒`;
  }
  return null;
}

/**
 * 生成回忆录视频
 * 根据产品线调用不同的生成策略：
 *   - daily：单段静图动效
 *   - memorial：多段动效合集 + 叙事编排
 *
 * 外部 API 未配置时回退为 mock 模式（仅用于开发/测试环境）
 */
export async function generateMemoirVideo(
  params: VideoGenerationParams,
): Promise<VideoGenerationResult> {
  const { taskId, productLine, tier, sourcePhotos, sourceText, musicStyle, duration, stylePreset, script, customBgmUrl } = params;

  // 参数校验（2026-09-09 三档：tier 传入时按档位边界校验——standard 5-7 张/40-50 秒等；
  // 缺省（历史调用方/旧路径）维持产品线校验，行为向后兼容）
  const photoError = tier ? validateTierPhotoCount(tier, sourcePhotos.length) : validatePhotoCount(productLine, sourcePhotos.length);
  if (photoError) {
    throw new Error(`[VideoGen] ${photoError}`);
  }

  const durationError = tier ? validateTierDuration(tier, duration ?? null) : validateDuration(productLine, duration);
  if (durationError) {
    throw new Error(`[VideoGen] ${durationError}`);
  }

  const cfg = PRODUCT_LINE_CONFIG[productLine];
  const targetDuration = duration ?? cfg.defaultDuration;

  // 回忆录 2.0：有 AI 分镜脚本 → 分镜驱动新管线
  if (script && Array.isArray(script.segments) && script.segments.length > 0) {
    return generateFromScript(taskId, sourcePhotos, script, musicStyle, customBgmUrl);
  }

  // 旧管线（兼容历史任务：narrative_structure 无 script）
  if (productLine === 'memorial') {
    return generateMemorialVlog(taskId, sourcePhotos, sourceText, musicStyle, targetDuration, stylePreset);
  }
  return generateDailyMemoir(taskId, sourcePhotos, sourceText, musicStyle, targetDuration, stylePreset);
}

/**
 * 分镜时间轴（每镜在成片中的起止时间，秒）
 */
interface ScriptTimeline {
  startSec: number;
  endSec: number;
}

/**
 * 静态照片动效片段（全家福/合影镜头专用）
 * 用 ffmpeg zoompan 对照片做缓慢推近/拉远，不调用 AI 视频生成——
 * 多角色同框合影"不重建角色"，零一致性风险 + 零 AI 成本。
 * @param taskId - 任务 ID
 * @param photoUrl - 照片 URL（下载到本地处理）
 * @param durationSec - 片段时长（秒）
 * @param direction - 运镜方向：in=推近 / out=拉远
 * @returns 可访问的片段 URL（uploads 托管，与 Seedance 片段一致）
 */
async function generateStaticSegment(
  taskId: string,
  photoUrl: string,
  durationSec: number,
  direction: 'in' | 'out' = 'in',
): Promise<string> {
  const workDir = path.join(UPLOAD_DIR, 'memoir', taskId);
  await mkdir(workDir, { recursive: true });
  const photoPath = path.join(workDir, `static_${Date.now()}.jpg`);
  const outPath = path.join(workDir, `static_${Date.now()}.mp4`);
  await downloadFile(photoUrl, photoPath);

  const frames = Math.max(1, Math.round(durationSec * 24)); // 24fps
  const zoomExpr =
    direction === 'in'
      ? `min(1+0.0006*on,1.25)` // 缓慢推近
      : `max(1.25-0.0006*on,1.0)`; // 缓慢拉远

  try {
    await execFileAsync('ffmpeg', [
      '-y',
      '-loop', '1',
      '-i', photoPath,
      '-vf',
      `scale=1920:1080:force_original_aspect_ratio=decrease,` +
        `pad=1920:1080:(ow-iw)/2:(oh-ih)/2,` +
        `zoompan=z='${zoomExpr}':d=${frames}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=1280x720:fps=24`,
      '-t', String(durationSec),
      '-c:v', 'libx264',
      '-pix_fmt', 'yuv420p',
      outPath,
    ], { timeout: 60_000 });
  } finally {
    // 清理照片临时文件（保留生成的 mp4 供拼接）
    await rm(photoPath, { force: true }).catch(() => {});
  }

  // 返回可访问 URL（与 Seedance 片段一致，stitch 统一按 URL 下载）
  const baseUrl = config.publicBaseUrl || '';
  return `${baseUrl}/uploads/memoir/${taskId}/${path.basename(outPath)}`;
}

/** 回忆录关键帧所需的宠物参考档案（只取关键帧真正用到的最小字段集） */
interface MemoirPetProfile {
  /** 宠物名字 —— **仅用于日志**，绝不进任何提示词（名字红线：名字只入库不入 prompt） */
  name: string | null;
  /** 品种（喂 petSubjectText；可为空串，兜底逻辑在 petSubjectText 内） */
  breed: string;
  /** 物种（cat / dog / 其他；petSubjectText 据此决定"猫咪/狗狗"） */
  species: string;
  /** 四视图全身设定图 URL（迁移 030 字段 avatar_multiview_url）；null = 档案里没有 */
  multiviewUrl: string | null;
}

/**
 * 取该回忆录任务对应宠物的参考档案（关键帧用）
 *
 * 为什么在这里查库而不是让调用方传进来：回忆录链路的调用方（memoirProcessor）目前
 * 只传 taskId 与照片，链路里没有宠物档案；而关键帧必需「四视图设定图 + 品种/物种」，
 * 故按 task_id → pet_id → pet_profiles 一次 JOIN 取回，整条任务只调用一次（不在逐镜循环里）。
 * 字段口径对齐 familyPhotoService.collectMemberPhotos。
 *
 * 失败（无记录 / 库异常）一律返回 null，由调用方降级——档案只是"锦上添花"，绝不阻断成片。
 *
 * @param taskId - 回忆录任务 ID（pet_memoir_records.id）
 * @returns 宠物参考档案；查不到或查询异常时 null
 */
async function loadMemoirPetProfile(taskId: string): Promise<MemoirPetProfile | null> {
  try {
    const result = await pool.query(
      `SELECT p.name, p.breed, p.species, p.avatar_multiview_url AS "multiviewUrl"
         FROM pet_memoir_records r
         JOIN pet_profiles p ON p.id = r.pet_id
        WHERE r.id = $1
        LIMIT 1`,
      [taskId],
    );
    const row = result.rows?.[0];
    if (!row) return null;
    const multiviewRaw = typeof row.multiviewUrl === 'string' ? row.multiviewUrl.trim() : '';
    return {
      name: typeof row.name === 'string' ? row.name : null,
      breed: typeof row.breed === 'string' ? row.breed : '',
      species: typeof row.species === 'string' ? row.species : '',
      // 空串/纯空白归一为 null：关键帧侧靠 null 判定"要不要带第二张参考图"
      multiviewUrl: multiviewRaw || null,
    };
  } catch (error) {
    // 只告警不抛出：关键帧拿不到设定图时会退化为"只有真实照片参考"
    console.warn(
      `[VideoGen] Task ${taskId}: 宠物档案查询失败，关键帧将只有真实照片参考: ${sanitizeError(error)}`,
    );
    return null;
  }
}

/**
 * 分镜驱动生成（回忆录 2.0 新管线）
 * 逐镜用分镜脚本的提示词（经 M2 十段组装 + Locks）与时长生成，
 * 拼接阶段做 xfade 转场 + ASS 字幕 + TTS 旁白。
 * @param taskId - 任务 ID
 * @param photos - 源照片 URL 数组
 * @param script - AI 分镜脚本（M1 生成）
 * @param musicStyle - 音乐风格（预留）
 * @returns 视频生成结果
 */
async function generateFromScript(
  taskId: string,
  photos: string[],
  script: MemoirScript,
  musicStyle: string | null | undefined,
  customBgmUrl?: string | null,
): Promise<VideoGenerationResult> {
  if (!isSeedanceConfigured()) {
    console.warn(`[VideoGen] Task ${taskId}: API key not configured, using mock mode (scripted)`);
    return mockGenerationResult(taskId, 'memorial', photos, 60);
  }

  try {
    // 1. 逐镜生成（用分镜的提示词 + 时长）
    const segmentUrls: string[] = [];
    const timeline: ScriptTimeline[] = [];
    let cursor = 0;

    // 1.1 取本任务宠物的参考档案（关键帧用）：整条任务只查一次，避免逐镜重复打库。
    //     取不到时返回 null → 关键帧退化为"只有真实照片参考"，绝不因档案缺失阻断成片。
    const petProfile = await loadMemoirPetProfile(taskId);
    // 主体外貌指代：复用 petSubjectText（品种缺失自动兜底"毛茸茸的"，未知品种标记词走兜底）。
    // ⚠️ 名字红线：只有外貌指代能进提示词，petProfile.name 一律不参与拼接（此处也没用到）。
    const petSubject = petProfile
      ? petSubjectText(petProfile.breed, petProfile.species)
      : '照片中的这只宠物';

    for (let i = 0; i < script.segments.length; i++) {
      const seg = script.segments[i];
      const photoUrl = photos[seg.photo_index] ?? photos[0];
      let url: string | null;

      if (seg.source === 'static_photo') {
        // 全家福/合影镜头：ffmpeg zoompan 静态动效（不重建角色，零 AI 成本、零一致性风险）
        url = await generateStaticSegment(taskId, photoUrl, seg.duration_sec, 'in');
      } else {
        // M2 组装最终提示词：十段补全 + 本镜在场角色锚点（多宠物/多人）+ Locks
        const prompt = buildFinalSegmentPrompt({
          segment: seg,
          anchors: script.anchors ?? [],
          identityAnchor: script.identity_anchor,
          // 保持每张首帧照片的真实朝向，避免统一强制朝右导致图像镜像或姿态跳变。
          screenDirection: undefined,
        });

        // 模式 C 落地：先出该镜专用关键帧（Seedream 图生图，电影质感静帧，16:9），
        // 成功则用它当 Seedance 首帧；失败或为 null 时**回落原照片**，保持既有行为。
        // 关键帧是"尽力项"：generateMemoirKeyframe 内部已吞掉全部异常并返回 null，
        // 因此这里不需要 try/catch，也绝不让关键帧失败升级成整片失败。
        const keyframeUrl = await generateMemoirKeyframe({
          photoUrl,
          multiviewUrl: petProfile?.multiviewUrl ?? null,
          segmentPrompt: prompt,
          petSubject,
          durationSec: seg.duration_sec,
        });
        // 逐镜标注走了哪条路径，线上排查"这一镜为什么看着像原图"时一眼可辨
        if (keyframeUrl) {
          console.log(`[VideoGen] Task ${taskId}: 镜 ${i} 首帧=关键帧（模式 C）`);
        } else {
          console.warn(`[VideoGen] Task ${taskId}: 镜 ${i} 首帧=回落原照片（关键帧不可用）`);
        }

        url = await generateSegmentWithRetry(taskId, keyframeUrl ?? photoUrl, prompt, seg.duration_sec);
      }

      if (!url) {
        throw new Error(`[VideoGen] Scripted segment ${i} generation failed`);
      }
      segmentUrls.push(url);
      timeline.push({ startSec: cursor, endSec: cursor + seg.duration_sec });
      cursor += seg.duration_sec;
    }

    // 2. 拼接：xfade 转场 + 字幕 + 旁白（BGM 优先用用户导入的 customBgmUrl）
    const finalVideo = await stitchWithScript(taskId, segmentUrls, timeline, script, musicStyle, customBgmUrl);

    return {
      videoUrl: finalVideo.videoUrl,
      previewUrl: finalVideo.previewUrl,
      actualDuration: finalVideo.actualDuration,
      engine: 'seedance-scripted-vlog',
    };
  } catch (error) {
    throw new Error(`[VideoGen] Scripted generation failed: ${sanitizeError(error)}`);
  }
}

/**
 * 分镜驱动拼接（回忆录 2.0）
 * 1. 下载片段 → 2. xfade 交叉淡化链 → 3. ASS 字幕烧录 → 4. TTS 旁白混音 → 5. 预览
 * 降级：字幕/旁白不可用时自动跳过（不阻断）
 * @param taskId - 任务 ID
 * @param segmentUrls - 各镜视频 URL（顺序与 script.segments 一致）
 * @param timeline - 各镜时间轴
 * @param script - 分镜脚本（提供字幕/旁白文案）
 * @param musicStyle - 音乐风格（预留）
 * @returns 拼接结果
 */
async function stitchWithScript(
  taskId: string,
  segmentUrls: string[],
  timeline: ScriptTimeline[],
  script: MemoirScript,
  musicStyle: string | null | undefined,
  customBgmUrl?: string | null,
): Promise<StitchResult> {
  if (segmentUrls.length === 0) {
    throw new Error(`[VideoGen] No segments to stitch for task ${taskId}`);
  }

  const workDir = path.join(UPLOAD_DIR, 'memoir', taskId);
  await mkdir(workDir, { recursive: true });

  try {
    // 1. 下载所有片段
    const localPaths: string[] = [];
    for (let i = 0; i < segmentUrls.length; i++) {
      const localPath = path.join(workDir, `segment_${i}.mp4`);
      await downloadFile(segmentUrls[i], localPath);
      localPaths.push(localPath);
    }

    // 2. 生成 ASS 字幕（subtitle + 时间轴）
    const subtitles: SubtitleItem[] = script.segments
      .map((seg, i) => ({
        startSec: timeline[i]?.startSec ?? 0,
        endSec: timeline[i]?.endSec ?? 0,
        text: seg.subtitle,
      }))
      .filter((s) => s.text && s.text.trim().length > 0);
    const assPath = path.join(workDir, 'sub.ass');
    if (subtitles.length > 0) {
      await writeFile(assPath, buildAssContent(subtitles), 'utf8');
    }

    // 3. 合成旁白（TTS；降级时 audioPath 为空 → 无旁白；音色用分镜的 narration_voice）
    const narrationSegs: NarrationSegment[] = script.segments.map((seg, i) => ({
      text: seg.narration,
      startSec: timeline[i]?.startSec ?? 0,
      endSec: timeline[i]?.endSec ?? 0,
    }));
    const tts = await synthNarration(taskId, narrationSegs, script.narration_voice);

    // 4. 组装 ffmpeg 命令：xfade 链 + 字幕 + 音频
    const inputs: string[] = [];
    localPaths.forEach((p) => inputs.push('-i', p));

    // 视频 filter：先统一分辨率/帧率（防异构照片片段导致 xfade 失败），再做交叉淡化链
    const transitionSec = 0.5;
    const filterParts: string[] = [];
    // 每段归一化到 1280x720@24fps（居中裁剪填充，时间戳归零）
    const normLabels: string[] = [];
    for (let i = 0; i < localPaths.length; i++) {
      normLabels.push(`vn${i}`);
      filterParts.push(
        `[${i}:v]scale=1280:720:force_original_aspect_ratio=decrease,` +
          `pad=1280:720:(ow-iw)/2:(oh-ih)/2,fps=24,setpts=PTS-STARTPTS[vn${i}]`,
      );
    }
    let prevLabel = normLabels[0];
    let accumulated = 0;
    for (let i = 1; i < localPaths.length; i++) {
      accumulated += timeline[i - 1]?.endSec - timeline[i - 1]?.startSec || 0;
      // xfade offset = 已累积原始时长 - 已消耗的转场时长
      const offset = Math.max(0, accumulated - i * transitionSec);
      const outLabel = i === localPaths.length - 1 ? 'vxf' : `vx${i}`;
      filterParts.push(
        `[${prevLabel}][${normLabels[i]}]xfade=transition=fade:duration=${transitionSec}:offset=${offset.toFixed(2)}[${outLabel}]`,
      );
      prevLabel = outLabel;
    }
    if (localPaths.length === 1) {
      filterParts.push(`[${normLabels[0]}]null[vxf]`);
    }

    // 字幕烧录（有字幕时）
    if (subtitles.length > 0) {
      filterParts.push(`[vxf]ass=filename=${assPath.replace(/\\/g, '/')}[vout]`);
    } else {
      filterParts.push(`[vxf]null[vout]`);
    }

    // 音频：静音底噪 + 旁白（若有）+ BGM 背景（内置 incompetech 曲，循环低音）
    const totalDuration = accumulated + (timeline[timeline.length - 1]?.endSec - timeline[timeline.length - 1]?.startSec || 0);
    const baseAudioIdx = localPaths.length; // anullsrc 输入下标
    inputs.push('-f', 'lavfi', '-t', String(Math.max(totalDuration, 1)), '-i', 'anullsrc=r=44100:cl=stereo');
    filterParts.push(`[${baseAudioIdx}:a]anull[abase]`);

    if (tts && !tts.degraded && tts.audioPath) {
      const narIdx = baseAudioIdx + 1;
      inputs.push('-i', tts.audioPath);
      // 旁白为整段已对齐时间轴，直接混入
      filterParts.push(`[${narIdx}:a]volume=1.0[anar]`);
      filterParts.push(`[abase][anar]amix=inputs=2:duration=first:normalize=0[aout]`);
    } else {
      filterParts.push(`[abase]anull[aout]`);
    }

    // BGM 背景（2026-09-09 合成接入）：优先用用户导入的 customBgmUrl（下载后循环混音），
    // 否则按音乐风格选内置 incompetech 曲；BGM 文件缺失时静默跳过（不阻断最终成片）
    try {
      let bgmLocalPath: string | null = null;
      if (customBgmUrl) {
        // 下载用户上传的音频到任务目录（复用 downloadFile），用作 BGM
        const extSuffix = (customBgmUrl.split('.').pop() || 'mp3').toLowerCase();
        const safeExt = ['mp3', 'm4a', 'aac', 'wav'].includes(extSuffix) ? extSuffix : 'mp3';
        bgmLocalPath = path.join(workDir, `custom_bgm.${safeExt}`);
        await downloadFile(customBgmUrl, bgmLocalPath);
      } else {
        const bgmFileName = musicStyle ? BGM_FILES[musicStyle] : undefined;
        if (bgmFileName) {
          const p = path.join(UPLOAD_DIR, 'bgm', bgmFileName);
          if (existsSync(p)) {
            bgmLocalPath = p;
          }
        }
      }
      if (bgmLocalPath && existsSync(bgmLocalPath)) {
        const bgmIdx = inputs.length; // 追加一个输入
        inputs.push('-stream_loop', '-1', '-i', bgmLocalPath);
        filterParts.push(`[${bgmIdx}:a]volume=0.22[abgm]`);
        filterParts.push(`[aout][abgm]amix=inputs=2:duration=first:normalize=0[amix]`);
        filterParts.push(`[amix]atrim=0:${Math.max(totalDuration, 1)}[aout]`);
      }
    } catch {
      // BGM 处理失败不阻断合成
    }

    // 执行 ffmpeg
    const finalPath = path.join(workDir, 'final.mp4');
    await execFileAsync('ffmpeg', [
      '-y',
      ...inputs,
      '-filter_complex', filterParts.join(';'),
      '-map', '[vout]',
      '-map', '[aout]',
      '-c:v', 'libx264',
      '-crf', '23',
      '-preset', 'fast',
      '-c:a', 'aac',
      '-shortest',
      finalPath,
    ]);

    // 5. 生成预览（低码率）
    const previewPath = path.join(workDir, 'preview.mp4');
    await execFileAsync('ffmpeg', [
      '-y',
      '-i', finalPath,
      '-vf', 'scale=480:-2',
      '-c:v', 'libx264',
      '-crf', '28',
      '-preset', 'fast',
      '-t', String(Math.min(totalDuration, 30)),
      previewPath,
    ]);

    // 6. 生成可访问 URL
    const baseUrl = config.publicBaseUrl || '';
    const videoUrl = `${baseUrl}/uploads/memoir/${taskId}/final.mp4`;
    const previewUrl = `${baseUrl}/uploads/memoir/${taskId}/preview.mp4`;

    // 7. 清理临时片段（保留 final/preview 与 sub.ass/narration 供审计）
    for (const p of localPaths) {
      await rm(p, { force: true }).catch(() => {});
    }

    return { videoUrl, previewUrl, actualDuration: totalDuration };
  } catch (error) {
    throw new Error(`[VideoGen] Scripted stitch failed: ${sanitizeError(error)}`);
  }
}

/**
 * 日常回忆录生成 - 静图动效技术
 * 将 1-3 张照片分别生成 3-8 秒动效片段，拼接为 5-30 秒短视频
 */
async function generateDailyMemoir(
  taskId: string,
  photos: string[],
  sourceText: string | null | undefined,
  musicStyle: string | null | undefined,
  targetDuration: number,
  stylePreset: string | null | undefined,
): Promise<VideoGenerationResult> {
  // 外部 API 未配置时使用 mock（开发/测试环境）
  if (!isSeedanceConfigured()) {
    console.warn(`[VideoGen] Task ${taskId}: API key not configured, using mock mode (daily)`);
    return mockGenerationResult(taskId, 'daily', photos, targetDuration);
  }

  try {
    // 1. 为每张照片生成动效片段
    const perSegmentDuration = Math.max(
      3,
      Math.min(SEEDANCE_MAX_SEGMENT_DURATION, Math.round(targetDuration / photos.length)),
    );
    const segmentUrls = await Promise.all(
      photos.map((photo, index) =>
        generateSingleAnimationSegment(taskId, photo, index, stylePreset, perSegmentDuration),
      ),
    );

    // 2. 拼接片段 + 添加 BGM + 字幕
    const finalVideo = await stitchSegmentsWithBgm(
      taskId,
      segmentUrls,
      musicStyle ?? 'warm',
      sourceText,
      targetDuration,
    );

    return {
      videoUrl: finalVideo.videoUrl,
      previewUrl: finalVideo.previewUrl,
      actualDuration: finalVideo.actualDuration,
      engine: 'seedance-daily-static-animation',
    };
  } catch (error) {
    throw new Error(`[VideoGen] Daily memoir generation failed: ${sanitizeError(error)}`);
  }
}

/**
 * 纪念Vlog生成 - 多段静图动效合集 + 叙事编排
 * 8-15 张照片分别生成动效 → 拼接 → 转场 → BGM → 字幕 → 60-90 秒完整叙事视频
 * 情感曲线设计：平静 → 回忆 → 痛感 → 释怀 → 余韵
 */
async function generateMemorialVlog(
  taskId: string,
  photos: string[],
  sourceText: string | null | undefined,
  musicStyle: string | null | undefined,
  targetDuration: number,
  stylePreset: string | null | undefined,
): Promise<VideoGenerationResult> {
  // 外部 API 未配置时使用 mock
  if (!isSeedanceConfigured()) {
    console.warn(`[VideoGen] Task ${taskId}: API key not configured, using mock mode (memorial)`);
    return mockGenerationResult(taskId, 'memorial', photos, targetDuration);
  }

  try {
    // 1. 按情感曲线分配照片权重
    const narrativePlan = buildNarrativePlan(photos, targetDuration);

    // 2. 为每张照片生成动效片段（带情感参数）
    const segmentUrls = await Promise.all(
      narrativePlan.segments.map((seg, index) =>
        generateNarrativeAnimationSegment(taskId, seg.photoUrl, seg.emotion, index, stylePreset),
      ),
    );

    // 3. 拼接 + 转场效果 + BGM + 字幕（叙事编排）
    const finalVideo = await stitchNarrativeSegments(
      taskId,
      segmentUrls,
      narrativePlan,
      musicStyle ?? 'nostalgic',
      sourceText,
    );

    return {
      videoUrl: finalVideo.videoUrl,
      previewUrl: finalVideo.previewUrl,
      actualDuration: finalVideo.actualDuration,
      engine: 'seedance-memorial-narrative-vlog',
    };
  } catch (error) {
    throw new Error(`[VideoGen] Memorial Vlog generation failed: ${sanitizeError(error)}`);
  }
}

// ===== 内部辅助类型 =====

interface NarrativeSegment {
  photoUrl: string;
  emotion: 'calm' | 'memory' | 'pain' | 'relief' | 'lingering';
  duration: number;
  transition: 'fade' | 'dissolve' | 'cut';
}

interface NarrativePlan {
  segments: NarrativeSegment[];
  totalDuration: number;
  bgmCues: Array<{ timestamp: number; intensity: 'low' | 'medium' | 'high' }>;
}

interface StitchResult {
  videoUrl: string;
  previewUrl: string;
  actualDuration: number;
}

// ===== 内部实现 =====

/**
 * 构建叙事计划 - 按情感曲线分配照片和时长
 * 平静(20%) → 回忆(30%) → 痛感(15%) → 释怀(20%) → 余韵(15%)
 */
function buildNarrativePlan(photos: string[], targetDuration: number): NarrativePlan {
  const emotions: NarrativeSegment['emotion'][] = [
    'calm', 'calm',
    'memory', 'memory', 'memory',
    'pain',
    'relief', 'relief',
    'lingering',
  ];

  // 分配照片到各情感段
  const segments: NarrativeSegment[] = [];
  const photosPerSegment = Math.ceil(photos.length / emotions.length);

  for (let i = 0; i < photos.length; i++) {
    const emotionIndex = Math.min(Math.floor(i / photosPerSegment), emotions.length - 1);
    const emotion = emotions[emotionIndex];

    // 根据情感分配时长
    const durationMap: Record<NarrativeSegment['emotion'], number> = {
      calm: targetDuration * 0.08,
      memory: targetDuration * 0.10,
      pain: targetDuration * 0.07,
      relief: targetDuration * 0.09,
      lingering: targetDuration * 0.06,
    };

    const transition: NarrativeSegment['transition'] =
      emotion === 'pain' ? 'cut' : emotion === 'calm' ? 'fade' : 'dissolve';

    segments.push({
      photoUrl: photos[i],
      emotion,
      duration: durationMap[emotion],
      transition,
    });
  }

  // BGM 强度提示点
  const bgmCues = [
    { timestamp: 0, intensity: 'low' as const },
    { timestamp: targetDuration * 0.2, intensity: 'medium' as const },
    { timestamp: targetDuration * 0.5, intensity: 'high' as const },
    { timestamp: targetDuration * 0.65, intensity: 'medium' as const },
    { timestamp: targetDuration * 0.85, intensity: 'low' as const },
  ];

  const totalDuration = segments.reduce((sum, s) => sum + s.duration, 0);

  return { segments, totalDuration, bgmCues };
}

/**
 * 调用 Seedance API 为单张照片生成动效片段（日常回忆录用）
 */
async function generateSingleAnimationSegment(
  taskId: string,
  photoUrl: string,
  index: number,
  stylePreset: string | null | undefined,
  segmentDuration: number,
): Promise<string> {
  const styleHint = stylePreset === 'cartoon' ? '动画风格' : '写实风格';
  const prompt = `对这张宠物照片进行缓慢的推拉缩放动效处理，画面自然流畅，${styleHint}，轻微镜头移动，保持主体清晰`;

  const videoUrl = await generateSegmentWithRetry(taskId, photoUrl, prompt, segmentDuration);
  if (!videoUrl) {
    throw new Error(`[VideoGen] Segment ${index} generation failed for task ${taskId}`);
  }
  return videoUrl;
}

/**
 * 调用 Seedance API 为单张照片生成带情感参数的动效片段（纪念Vlog用）
 */
async function generateNarrativeAnimationSegment(
  taskId: string,
  photoUrl: string,
  emotion: NarrativeSegment['emotion'],
  index: number,
  stylePreset: string | null | undefined,
): Promise<string> {
  const emotionHint = EMOTION_PROMPTS[emotion] ?? EMOTION_PROMPTS.calm;
  const prompt = `对这张宠物照片应用以下动效：${emotionHint}。保持照片主体不变，只做镜头运动与光影处理`;

  const videoUrl = await generateSegmentWithRetry(taskId, photoUrl, prompt, SEEDANCE_MAX_SEGMENT_DURATION);
  if (!videoUrl) {
    throw new Error(`[VideoGen] Narrative segment ${index} generation failed for task ${taskId}`);
  }
  return videoUrl;
}

/**
 * 生成单个动效片段，带轮询与重试
 * @returns 视频 URL 或 null
 */
async function generateSegmentWithRetry(
  taskId: string,
  photoUrl: string,
  prompt: string,
  duration: number,
): Promise<string | null> {
  // 首次创建任务
  const created = await createVideoGenerationTask({
    imageUrl: photoUrl,
    prompt,
    duration,
    // 画幅固定 16:9（见 MEMOIR_SEGMENT_RATIO 注释：adaptive 会逐镜跟随首帧比例，拼接观感参差）
    ratio: MEMOIR_SEGMENT_RATIO,
    watermark: false,
    resolution: '720p',
  });

  if (created.error || !created.taskId) {
    console.error(`[VideoGen] Task ${taskId}: create segment failed: ${created.error}`);
    return null;
  }

  // 轮询等待任务完成
  for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
    await delay(POLL_INTERVAL_MS);
    const result = await queryVideoTask(created.taskId);

    if (result.error) {
      console.error(`[VideoGen] Task ${taskId}: query segment failed: ${result.error}`);
      return null;
    }

    if (result.status === 'succeeded' && result.videoUrl) {
      return result.videoUrl;
    }

    if (result.status === 'failed') {
      console.error(`[VideoGen] Task ${taskId}: segment generation failed: ${result.error}`);
      return null;
    }

    // queued/running 继续轮询
  }

  console.error(`[VideoGen] Task ${taskId}: segment generation timed out`);
  return null;
}

/**
 * 拼接片段 + BGM + 字幕（日常回忆录用）
 * 使用 ffmpeg 将多个动效片段拼接为短视频，并叠加背景音乐
 */
async function stitchSegmentsWithBgm(
  taskId: string,
  segmentUrls: string[],
  musicStyle: string,
  sourceText: string | null | undefined,
  targetDuration: number,
): Promise<StitchResult> {
  return stitchVideoSegments(taskId, segmentUrls, musicStyle, sourceText, targetDuration);
}

/**
 * 拼接叙事片段 + 转场 + BGM + 字幕（纪念Vlog用）
 */
async function stitchNarrativeSegments(
  taskId: string,
  segmentUrls: string[],
  _narrativePlan: NarrativePlan,
  musicStyle: string,
  sourceText: string | null | undefined,
): Promise<StitchResult> {
  return stitchVideoSegments(taskId, segmentUrls, musicStyle, sourceText, _narrativePlan.totalDuration);
}

/**
 * 通用视频拼接实现
 * 1. 下载所有片段到临时目录
 * 2. 使用 ffmpeg concat 拼接
 * 3. 生成最终视频与预览视频
 * 4. 保存到 uploads 目录并返回访问 URL
 */
async function stitchVideoSegments(
  taskId: string,
  segmentUrls: string[],
  musicStyle: string,
  sourceText: string | null | undefined,
  targetDuration: number,
): Promise<StitchResult> {
  if (segmentUrls.length === 0) {
    throw new Error(`[VideoGen] No segments to stitch for task ${taskId}`);
  }

  // 如果只有一段且无字幕需求，直接使用该段作为最终视频（仍需下载到本地托管）
  if (segmentUrls.length === 1 && !sourceText) {
    const singleResult = await hostSingleVideo(taskId, segmentUrls[0]);
    return {
      videoUrl: singleResult.videoUrl,
      previewUrl: singleResult.previewUrl,
      actualDuration: targetDuration,
    };
  }

  const workDir = path.join(UPLOAD_DIR, 'memoir', taskId);
  await mkdir(workDir, { recursive: true });

  try {
    // 1. 下载所有片段
    const localPaths: string[] = [];
    for (let i = 0; i < segmentUrls.length; i++) {
      const ext = '.mp4';
      const localPath = path.join(workDir, `segment_${i}${ext}`);
      await downloadFile(segmentUrls[i], localPath);
      localPaths.push(localPath);
    }

    // 2. 生成 concat 清单文件
    const concatListPath = path.join(workDir, 'concat_list.txt');
    const concatContent = localPaths.map((p) => `file '${p.replace(/\\/g, '/')}'`).join('\n');
    await writeFile(concatListPath, concatContent, 'utf8');

    // 3. 拼接视频（无声）
    const joinedPath = path.join(workDir, 'joined.mp4');
    await execFileAsync('ffmpeg', [
      '-y',
      '-f', 'concat',
      '-safe', '0',
      '-i', concatListPath,
      '-c', 'copy',
      joinedPath,
    ]);

    // 4. 叠加 BGM（使用合成音轨，避免依赖外部 BGM 文件）
    const musicHint = MUSIC_STYLE_HINTS[musicStyle] ?? MUSIC_STYLE_HINTS.warm;
    const finalPath = path.join(workDir, 'final.mp4');
    const bgmArgs = [
      '-y',
      '-i', joinedPath,
      '-f', 'lavfi',
      '-t', String(targetDuration),
      '-i', `sine=frequency=440:duration=${targetDuration}`,
      '-filter_complex',
      `[1:a]volume=0.15,afade=t=in:st=0:d=2,afade=t=out:st=${Math.max(targetDuration - 2, 0)}:d=2[bgm];[0:a][bgm]amix=inputs=2:duration=first[aout]`,
      '-map', '0:v',
      '-map', '[aout]',
      '-c:v', 'copy',
      '-c:a', 'aac',
      '-shortest',
      finalPath,
    ];
    await execFileAsync('ffmpeg', bgmArgs).catch(() => {
      // 若片段无声导致音频流缺失，退化为纯视频拼接
      console.warn(`[VideoGen] Task ${taskId}: BGM mixing failed, fallback to video-only`);
      return execFileAsync('ffmpeg', ['-y', '-i', joinedPath, '-c', 'copy', finalPath]);
    });

    // 5. 生成预览（低码率较短版本）
    const previewPath = path.join(workDir, 'preview.mp4');
    await execFileAsync('ffmpeg', [
      '-y',
      '-i', finalPath,
      '-vf', 'scale=480:-2',
      '-c:v', 'libx264',
      '-crf', '28',
      '-preset', 'fast',
      '-t', String(Math.min(targetDuration, 30)),
      previewPath,
    ]);

    // 6. 生成可访问 URL（与项目现有 /uploads 静态托管一致）
    const baseUrl = config.publicBaseUrl || '';
    const videoUrl = `${baseUrl}/uploads/memoir/${taskId}/final.mp4`;
    const previewUrl = `${baseUrl}/uploads/memoir/${taskId}/preview.mp4`;

    // 清理临时片段文件（保留 final 与 preview）
    for (const p of localPaths) {
      await rm(p, { force: true }).catch(() => {});
    }
    await rm(concatListPath, { force: true }).catch(() => {});
    await rm(joinedPath, { force: true }).catch(() => {});

    return {
      videoUrl,
      previewUrl,
      actualDuration: targetDuration,
    };
  } catch (error) {
    throw new Error(`[VideoGen] Stitching failed for task ${taskId}: ${sanitizeError(error)}`);
  }
}

/**
 * 托管单段视频（仅一段且无字幕时）
 * 下载视频到本地 uploads 目录并返回 URL
 */
async function hostSingleVideo(
  taskId: string,
  videoUrl: string,
): Promise<{ videoUrl: string; previewUrl: string }> {
  const workDir = path.join(UPLOAD_DIR, 'memoir', taskId);
  await mkdir(workDir, { recursive: true });

  const localPath = path.join(workDir, 'final.mp4');
  await downloadFile(videoUrl, localPath);

  // 生成预览
  const previewPath = path.join(workDir, 'preview.mp4');
  await execFileAsync('ffmpeg', [
    '-y',
    '-i', localPath,
    '-vf', 'scale=480:-2',
    '-c:v', 'libx264',
    '-crf', '28',
    '-preset', 'fast',
    '-t', '30',
    previewPath,
  ]);

  const baseUrl = config.publicBaseUrl || '';
  return {
    videoUrl: `${baseUrl}/uploads/memoir/${taskId}/final.mp4`,
    previewUrl: `${baseUrl}/uploads/memoir/${taskId}/preview.mp4`,
  };
}

/**
 * 下载远程文件到本地
 * 2026-09 审查 P1 修复：原 fetch 无超时，上游挂起会拖死 processor 轮询；补 60s 上限
 * （视频/照片文件较大，比普通 API 调用放宽）
 */
async function downloadFile(url: string, localPath: string): Promise<void> {
  const response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!response.ok) {
    throw new Error(`Download failed: ${response.status} ${response.statusText}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  await writeFile(localPath, buffer);
}

/**
 * Mock 生成结果（开发/测试环境使用）
 * 当外部 API 未配置时返回模拟 URL，确保流程可验证
 */
function mockGenerationResult(
  taskId: string,
  productLine: VideoProductLine,
  photos: string[],
  targetDuration: number,
): VideoGenerationResult {
  const prefix = productLine === 'memorial' ? 'memorial' : 'daily';
  console.warn(
    `[VideoGen] Task ${taskId}: Mock ${prefix} video generated, photos=${photos.length}, duration=${targetDuration}s`,
  );

  return {
    videoUrl: `https://mock-cdn.example.com/${prefix}/${taskId}/video.mp4`,
    previewUrl: `https://mock-cdn.example.com/${prefix}/${taskId}/preview.mp4`,
    actualDuration: targetDuration,
    engine: `mock-${productLine}`,
  };
}
