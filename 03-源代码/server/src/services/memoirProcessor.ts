/**
 * 回忆录任务处理器 - 异步队列消费器
 * 职责：
 *   1. 轮询 pending 状态的回忆录任务
 *   2. 抢占任务（原子更新为 processing，防止并发重复处理）
 *   3. 调用视频生成服务
 *   4. 对生成结果进行内容审核
 *   5. 审核失败自动重试（最多 2 次）
 *   7. 最终成功/失败后通过 WebSocket 通知用户
 *   8. 最终失败自动退款（审查⏳3 退款闭环，方案 A）：付费单条（payment_id 非空）
 *      最终失败时调用 memoirRefundService 原路全额退款，会员任务无支付订单自然跳过
 *
 * 安全约束：
 *   - 单次最多处理 5 个任务（防止阻塞）
 *   - 每个任务最多重试 2 次
 *   - 日志脱敏：不记录照片 URL、用户文案
 */
import { MemoirRepository, type MemoirRecordRow } from '../repositories/memoirRepository.js';
import { PetRepository } from '../repositories/petRepository.js';
import {
  generateMemoirVideo,
  mapTierToGenerationLine,
  resolveMemoirTier,
  type VideoGenerationResult,
} from './videoGenerationService.js';
import { generateMemoirScript, sanitizeMemoirScriptPrompts } from './memoirScriptService.js';
import { analyzeMemoirPhotos } from './memoirPhotoAnalysis.js';
import { buildMemoryContext, getMemoriesByTags, getMomentSummariesByIds, getPetMomentsSummary } from './memoryService.js';
import type { MemoirTier } from '../config.js';
import { checkVideoQuality } from './qualityCheckService.js';
import { cleanupNarration } from './ttsService.js';
import { cleanupDoubaoSpeech } from './doubaoSpeechTts.js';
import type { MemoirScript } from '../schemas/memoirScript.js';
import { moderateVideo } from './videoModerationService.js';
import { sendToUser } from './websocketService.js';
import { stampAigcVideoMetadataOnFile } from './aigcMetadata.js';
import { postMemoirCompletedFeed } from './autoFeedService.js';
import { postMemoirTimelineMoment } from './autoFeedService.js';
import { sanitizeError } from '../utils/sanitize.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config, MEMOIR_TIER_CONFIG } from '../config.js';
import { refundMemoirOrder } from './memoirRefundService.js';

/** 服务器工作目录（上传/生成产物根目录，质检抽帧用） */
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOAD_DIR = path.resolve(__dirname, '..', config.uploadDir);

/** 最大重试次数（审核失败时） */
const MAX_RETRY_COUNT = 2;

/** 单次轮询最多处理的任务数 */
const BATCH_SIZE = 5;

/** 轮询间隔（毫秒） */
const POLL_INTERVAL_MS = 30_000;

const memoirRepository = new MemoirRepository();
const petRepository = new PetRepository();

// [审查⏳4] 重试计数已由内存 Map 改为 pet_memoir_records.retry_count 落库持久化（迁移 033），
// 进程重启不再清零，见 handleRetry

/** 处理器是否正在运行 */
let isRunning = false;

/** 轮询定时器 */
let pollTimer: NodeJS.Timeout | null = null;

/**
 * 启动回忆录任务处理器
 * 定时轮询 pending 任务并处理
 */
export function startMemoirProcessor(): void {
  if (isRunning) {
    console.warn('[MemoirProcessor] Already running, skip start');
    return;
  }
  isRunning = true;
  console.log(`[MemoirProcessor] Started, polling every ${POLL_INTERVAL_MS / 1000}s`);

  // 立即执行一次，然后定时轮询
  pollOnce().catch((err) => {
    console.error('[MemoirProcessor] Initial poll failed:', sanitizeError(err));
  });

  pollTimer = setInterval(() => {
    pollOnce().catch((err) => {
      console.error('[MemoirProcessor] Poll failed:', sanitizeError(err));
    });
  }, POLL_INTERVAL_MS);
}

/**
 * 停止回忆录任务处理器
 */
export function stopMemoirProcessor(): void {
  isRunning = false;
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  console.log('[MemoirProcessor] Stopped');
}

/**
 * 单次轮询处理
 * 查询 pending 任务，逐个抢占并处理
 */
export async function pollOnce(): Promise<{ processed: number; succeeded: number; failed: number }> {
  const pendingTasks = await memoirRepository.findPendingTasks(BATCH_SIZE);

  if (pendingTasks.length === 0) {
    return { processed: 0, succeeded: 0, failed: 0 };
  }

  let succeeded = 0;
  let failed = 0;

  for (const task of pendingTasks) {
    try {
      const success = await processTask(task);
      if (success) {
        succeeded++;
      } else {
        failed++;
      }
    } catch (err) {
      console.error(`[MemoirProcessor] Task ${task.id} unexpected error:`, sanitizeError(err));
      failed++;
    }
  }

  console.log(
    `[MemoirProcessor] Batch done: processed=${pendingTasks.length}, succeeded=${succeeded}, failed=${failed}`,
  );

  return { processed: pendingTasks.length, succeeded, failed };
}

/**
 * 处理单个回忆录任务
 * @returns true 表示成功完成，false 表示失败或重试中
 */
export async function processTask(task: MemoirRecordRow): Promise<boolean> {
  // 1. 原子抢占任务（防止并发重复处理）
  const claimed = await memoirRepository.claimTask(task.id);
  if (!claimed) {
    // 已被其他处理器抢占，跳过
    return false;
  }

  console.log(`[MemoirProcessor] Task ${task.id} claimed, processing...`);

  try {
    // 2. 解析叙事结构
    const narrative = parseNarrativeStructure(task.narrative_structure);

    // 2.5 剧本确认闸门（立项 v0.2 P0-2）：
    // 任务此前没有持久化剧本 → 本次会新生成分镜，生成后暂停等待用户确认，不在本轮烧视频成本；
    // 任务已有剧本（用户确认后重新入队 / 历史失败重试）→ 直接进入视频生成，保持原语义。
    const hasScriptBefore = Boolean(
      narrative.script && typeof narrative.script === 'object',
    );

    // 3. 解析档位并映射生成管线（2026-09-09 三档体系）
    // 档位是单一事实源：light→daily 单段管线，standard/full→memorial 多段管线。
    // 历史任务 narrative_structure 无 tier → resolveMemoirTier 按 memoir_type 回退，行为与旧版一致。
    // ⚠️ 此前这里按 memoir_type 选管线，导致 standard+daily（5 张照片）在执行链被 daily
    //    管线的 1-3 张校验打回 → 用户付费走完确认流程后必然失败退款（审查 P0-1，已修复）。
    const tier = resolveMemoirTier(
      typeof narrative.tier === 'string' ? narrative.tier : undefined,
      task.memoir_type,
    );
    const productLine = mapTierToGenerationLine(tier);

    // 4. 回忆录 2.0：确保分镜脚本存在（无则调用 M1 生成并持久化）
    const script = await ensureMemoirScript(task, narrative, productLine, tier);

    // 4.5 剧本确认闸门：新生成剧本的任务暂停待确认（Seedance 视频成本在确认后才发生）
    if (!hasScriptBefore && script) {
      await memoirRepository.pauseForScriptConfirmation(task.id);
      await notifyUser(task.user_id, {
        type: 'memoir_script_ready',
        taskId: task.id,
      });
      console.log(
        `[MemoirProcessor] Task ${task.id}: 剧本已生成，暂停等待用户确认（立项 P0-2 剧本确认闸门）`,
      );
      return false;
    }

    // 5. 调用视频生成服务（分镜驱动新管线；tier 传入后按档位边界校验照片/时长）
    const result = await generateMemoirVideo({
      taskId: task.id,
      productLine,
      tier,
      sourcePhotos: task.source_photos,
      sourceText: task.source_text,
      musicStyle: typeof narrative.music_style === 'string' ? narrative.music_style : null,
      duration: typeof narrative.duration === 'number' ? narrative.duration : null,
      stylePreset: typeof narrative.style_preset === 'string' ? narrative.style_preset : null,
      customBgmUrl: typeof narrative.custom_bgm_url === 'string' ? narrative.custom_bgm_url : null,
      script,
    });

    // 6. 质量质检（回忆录 2.0 M5：DeepSeek 视觉抽帧评分）
    //    degraded=true（质检不可用）时放行；不合格时整条重试
    const localFinalPath = path.join(UPLOAD_DIR, 'memoir', task.id, 'final.mp4');

    // 立项 v0.2 P0-3：《标识办法》第十条隐式标识——成片 mp4 元数据写入 AIGC udta box
    // （失败仅记日志不阻断，质检与交付不受影响）
    await stampAigcVideoMetadataOnFile(localFinalPath);

    const quality = await checkVideoQuality({
      videoPath: localFinalPath,
      identityAnchor: script?.identity_anchor,
    });
    if (!quality.passed && !quality.degraded) {
      const retried = await handleRetry(task, `质量质检未通过: ${quality.defects.join('；') || '低分'}`);
      if (retried) {
        console.warn(`[MemoirProcessor] Task ${task.id}: Quality check failed, retrying`);
        return false;
      }
      await memoirRepository.markFailed(task.id, '质量质检未通过');
      // 退款闭环（审查⏳3）：付费单条最终失败 → 自动原路全额退款
      await refundMemoirOrder(task, '视频质量未达标，已超过最大重试次数');
      await notifyUser(task.user_id, {
        type: 'memoir_failed',
        taskId: task.id,
        reason: '视频质量未达标',
      });
      console.warn(`[MemoirProcessor] Task ${task.id}: Quality check failed, max retries exceeded`);
      return false;
    }

    // 7. 内容审核
    const moderationResult = await moderateVideo(result.videoUrl);

    if (moderationResult === 'block') {
      // 审核拒绝，尝试重试
      const retried = await handleRetry(task, `内容审核拒绝`);
      if (retried) {
        console.warn(`[MemoirProcessor] Task ${task.id}: Content blocked, retrying`);
        return false;
      }
      // 重试次数用完，标记失败
      await memoirRepository.markFailed(task.id, '内容审核拒绝，已超过最大重试次数');
      // 退款闭环（审查⏳3）：付费单条最终失败 → 自动原路全额退款
      await refundMemoirOrder(task, '内容审核未通过，已超过最大重试次数');
      await notifyUser(task.user_id, {
        type: 'memoir_failed',
        taskId: task.id,
        reason: '内容审核未通过',
      });
      console.warn(`[MemoirProcessor] Task ${task.id}: Content blocked, max retries exceeded`);
      return false;
    }

    if (moderationResult === 'review') {
      // 2026-09 审查 P1 修复（fail-closed）：review 原先仅 console.warn 后照常 markCompleted 并
      // 自动分发（发动态/写时光线），等于"待人工审核"形同虚设。现口径：视频仍完成（用户付费成果
      // 不作废、本人列表可见），但**跳过自动分发**（不发家庭动态、不写时光线），待人工复核后由
      // 运营在管理端手动处理；无人工审核队列前宁可不分发。
      console.warn(`[MemoirProcessor] Task ${task.id}: Content flagged for manual review, completed but NOT distributed`);
      await memoirRepository.markCompleted(task.id, result.videoUrl, result.previewUrl);
      void notifyUser(task.user_id, {
        type: 'memoir_completed',
        taskId: task.id,
        previewUrl: result.previewUrl,
      });
      
      return true;
    }

    // 6. 审核通过，标记完成
    await memoirRepository.markCompleted(task.id, result.videoUrl, result.previewUrl);
    // 回忆录生成完成 → 自动发家庭动态
    void postMemoirCompletedFeed(task.user_id, task.pet_id, task.memoir_type);
    // 回忆录生成完成 → 写入时光线（pet_moments）
    void postMemoirTimelineMoment(task.user_id, task.pet_id, task.memoir_type, result.videoUrl, result.previewUrl);

    // 清理 TTS 临时文件（旁白中间产物，防磁盘泄漏）
    void cleanupTaskTempFiles(task.id);

    // 7. 清理重试计数
    

    // 8. 通知用户
    await notifyUser(task.user_id, {
      type: 'memoir_completed',
      taskId: task.id,
      previewUrl: result.previewUrl,
    });

    console.log(`[MemoirProcessor] Task ${task.id}: Completed successfully`);
    return true;
  } catch (err) {
    const errorMessage = sanitizeError(err);

    // 生成失败，尝试重试
    const retried = await handleRetry(task, errorMessage);
    if (retried) {
      console.warn(`[MemoirProcessor] Task ${task.id}: Generation failed, retrying`);
      return false;
    }

    // 重试次数用完，标记失败
    await memoirRepository.markFailed(task.id, errorMessage);
    // 退款闭环（审查⏳3）：付费单条最终失败 → 自动原路全额退款
    await refundMemoirOrder(task, `视频生成失败: ${errorMessage.slice(0, 60)}`);
    await notifyUser(task.user_id, {
      type: 'memoir_failed',
      taskId: task.id,
      reason: '视频生成失败',
    });
    // 清理 TTS 临时文件
    void cleanupTaskTempFiles(task.id);

    console.error(`[MemoirProcessor] Task ${task.id}: Failed after max retries:`, errorMessage);
    return false;
  }
}

/**
 * 清理任务相关的 TTS 临时文件（旁白中间产物）
 * @param taskId - 任务 ID
 */
function cleanupTaskTempFiles(taskId: string): void {
  void cleanupNarration(taskId).catch(() => {});
  void cleanupDoubaoSpeech(taskId).catch(() => {});
}

/**
 * 确保任务有分镜脚本（回忆录 2.0）
 * 1. narrative_structure.script 已存在 → 直接返回（重试场景复用）
 * 2. 不存在 → 查宠物档案 + 记忆摘要 → 调用 M1 分镜生成 → 持久化到任务
 * 降级：分镜生成失败返回 undefined（走旧管线），不阻断生成
 * @param task - 回忆录任务
 * @param narrative - 解析后的叙事结构（含旧字段 music_style/duration/style_preset）
 * @param productLine - 产品线
 * @returns 分镜脚本（失败/旧任务返回 undefined）
 */
async function ensureMemoirScript(
  task: MemoirRecordRow,
  narrative: Record<string, unknown>,
  productLine: 'daily' | 'memorial',
  tier: MemoirTier,
): Promise<MemoirScript | undefined> {
  const existing = narrative.script;
  // 宠物查询也必须遵循“分镜失败不阻断旧管线”的降级约定，数据库短暂异常时使用无名字兜底档案。
  let pet: Awaited<ReturnType<PetRepository['findByIdAndUser']>> = null;
  try {
    pet = await petRepository.findByIdAndUser(task.pet_id, task.user_id);
  } catch (error) {
    console.warn(`[MemoirProcessor] Task ${task.id}: 宠物档案查询失败，使用安全兜底档案:`, sanitizeError(error));
  }
  const petProfile = pet
    ? {
        name: pet.name,
        species: pet.species,
        breed: pet.breed,
        gender: pet.gender,
        birth_date: pet.birth_date,
        notes: pet.notes,
        is_deceased: pet.is_deceased,
      }
    : { name: '宝贝', species: 'cat', breed: '宠物' };

  // 重试任务复用已持久化脚本，但仍经过当前安全清洗，避免历史脚本中的名字进入生成模型。
  if (existing && typeof existing === 'object') {
    return sanitizeMemoirScriptPrompts(existing as MemoirScript, {
      petProfile,
      photoCount: task.source_photos.length,
      tier,
      productLine,
      // 缺 duration 时按档位默认时长兜底（2026-09-09 三档：standard=45，不再是 memorial 硬编码 75）
      targetDuration: typeof narrative.duration === 'number' ? narrative.duration : MEMOIR_TIER_CONFIG[tier].defaultDuration,
    });
  }

  // 用户确认版提示词优先采用（2026-09-09 人机协同收口）：用户在生成前确认的「最终版提示词」
  // 已留存作证；本任务若与确认档位匹配，直接用它（仍经安全清洗）而非重新生成——
  // 真正兑现「按用户确认过的版本生成」，防止「这不是我确认的那版」的扯皮。
  if (!existing) {
    try {
      // 按 pet_id + 当前档位取确认版（审查 P2-1：同宠多档确认互不遮蔽）
      const confirmation = await memoirRepository.findPromptConfirmation(task.pet_id, tier);
      if (confirmation) {
        const confirmedScript = confirmation.script as MemoirScript;
        if (confirmedScript && Array.isArray(confirmedScript.segments) && confirmedScript.segments.length > 0) {
          const script = sanitizeMemoirScriptPrompts(confirmedScript, {
            petProfile,
            photoCount: task.source_photos.length,
            tier,
            productLine,
            targetDuration: typeof narrative.duration === 'number' ? narrative.duration : MEMOIR_TIER_CONFIG[tier].defaultDuration,
          });
          // 审查 P0-1 关键修复：确认版也须持久化到任务，否则剧本确认闸门放行后
          // narrative.script 仍为空 → 重新入队又走确认版分支 → 再暂停 → 确认-暂停死循环，永远无法出片。
          try {
            await memoirRepository.updateScript(task.id, script as unknown as Record<string, unknown>);
          } catch (err) {
            console.warn(`[MemoirProcessor] Task ${task.id}: 确认版持久化失败（不影响本次生成）:`, sanitizeError(err));
          }
          return script;
        }
      }
    } catch {
      // 确认版读取失败不阻断（降级为重新生成）
      console.warn(`[MemoirProcessor] Task ${task.id}: 读取用户确认版提示词失败，降级重新生成`);
    }
  }

  try {

    // 记忆摘要（F4：按回忆标签筛核心层记忆作素材；失败不影响分镜生成）
    // G2 勾选记忆（2026-09-09）：用户勾选的时光线回忆 ID 优先——勾什么用什么，
    // 勾选模式下不再自动拉取时光线（尊重用户控制权，也避免稀释 token）
    let memorySummary: string | undefined;
    try {
      const selectedMomentIds = Array.isArray(narrative.selected_moment_ids)
        ? (narrative.selected_moment_ids as string[]).filter((id) => typeof id === 'string' && id.length > 0)
        : [];
      if (selectedMomentIds.length > 0) {
        // 用户勾选了回忆 → 按勾选取（归属校验在查询内强制 user_id+pet_id）
        memorySummary = await getMomentSummariesByIds(task.user_id, task.pet_id, selectedMomentIds) || undefined;
      } else {
        const tags = Array.isArray(narrative.tags) ? (narrative.tags as string[]) : undefined;
        if (tags && tags.length > 0) {
          // 用户选了标签 → 按标签取核心层记忆（记忆驱动）
          memorySummary = await getMemoriesByTags({
            userId: task.user_id,
            petId: task.pet_id,
            tags,
            limit: 20,
          });
        } else {
          // 未选标签 → 用完整记忆上下文
          const ctx = await buildMemoryContext(
            task.user_id,
            task.pet_id,
            task.source_text || '为宠物生成回忆录分镜',
          );
          memorySummary = ctx.memories || undefined;
        }
        // 时光线回忆（第二素材源）：把「时光」页的回忆文本并入记忆摘要，二者皆无才判定"无记忆"，
        // 触发分镜提示词的【无记忆约束】（禁止虚构具体事件），兑现"真实回忆优先、无素材才中性生成"的卖点。
        // 勾选模式跳过此处（勾什么用什么，不自动补拉）
        try {
          const momentsSummary = await getPetMomentsSummary(task.user_id, task.pet_id, 15);
          if (momentsSummary) {
            const parts = [memorySummary?.trim(), momentsSummary].filter(Boolean);
            memorySummary = parts.join('\n');
          }
        } catch {
          // 时光线读取失败忽略
        }
      }
    } catch {
      // 记忆摘要失败忽略
    }

    // 分镜模型本身看不到照片，先用视觉服务逐张提取可见事实；单图失败会在服务内保守降级。
    const photoDescriptions = await analyzeMemoirPhotos(task.source_photos);

    const script = await generateMemoirScript({
      petProfile,
      memorySummary,
      photoCount: task.source_photos.length,
      // 传档位：照片数校验按档位而非产品线（standard 与 full 共用 memorial 线，2026-09-11 修复）
      tier,
      productLine,
      targetDuration:
        typeof narrative.duration === 'number'
          ? narrative.duration
          : MEMOIR_TIER_CONFIG[tier].defaultDuration,
      sourceText: task.source_text,
      musicStyle: typeof narrative.music_style === 'string' ? narrative.music_style : null,
      stylePreset: typeof narrative.style_preset === 'string' ? narrative.style_preset : null,
      photoDescriptions,
    });

    // 持久化分镜（失败仅记录，不影响本任务生成）
    try {
      await memoirRepository.updateScript(task.id, script as unknown as Record<string, unknown>);
    } catch (err) {
      console.warn('[MemoirProcessor] 分镜持久化失败（不影响生成）:', sanitizeError(err));
    }
    return script;
  } catch (err) {
    // 分镜生成失败 → 回退旧管线（功能可用，质量降级）
    console.warn('[MemoirProcessor] 分镜生成失败，回退旧管线:', sanitizeError(err));
    return undefined;
  }
}

/**
 * 解析叙事结构 JSONB 字段
 */
function parseNarrativeStructure(
  raw: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  if (!raw || typeof raw !== 'object') {
    return {};
  }
  return raw;
}

/**
 * 处理重试逻辑
 * @returns true 表示已重置为 pending（可重试），false 表示重试次数用完
 */
/**
 * 审核拒绝重试（迁移 033，审查⏳4 持久化版）
 * 计数落库 pet_memoir_records.retry_count（原子 UPDATE ... RETURNING），
 * 进程重启不再清零——同一坏任务全生命周期最多重试 MAX_RETRY_COUNT 次。
 * @param task 任务行（需含 retry_count 当前值）
 * @returns true=已重置入队重试；false=重试次数用完
 */
async function handleRetry(task: MemoirRecordRow, _reason: string): Promise<boolean> {
  const currentCount = task.retry_count ?? 0;
  if (currentCount >= MAX_RETRY_COUNT) {
    return false;
  }
  await memoirRepository.incrementRetryCount(task.id);
  await memoirRepository.resetToPending(task.id);
  return true;
}

/**
 * 通过 WebSocket 通知用户任务状态变更
 */
async function notifyUser(
  userId: string,
  message: {
    type: 'memoir_completed' | 'memoir_failed' | 'memoir_script_ready';
    taskId: string;
    previewUrl?: string;
    reason?: string;
  },
): Promise<void> {
  try {
    sendToUser(userId, {
      event: 'memoir_status',
      data: message,
    });
  } catch (err) {
    // WebSocket 通知失败不影响主流程，仅记录日志
    console.warn(`[MemoirProcessor] WebSocket notify failed for user ${userId}:`, sanitizeError(err));
  }
}

/**
 * 重置处理器状态（用于测试）
 * 注：重试计数已落库（迁移 033），内存态仅剩 isRunning；测试用
 * repository mock 的 clear 语义 + resetProcessorState 复位运行标志
 */
export function resetProcessorState(): void {
  isRunning = false;
}
