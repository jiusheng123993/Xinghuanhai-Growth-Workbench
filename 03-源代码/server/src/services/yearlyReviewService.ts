/**
 * 年度回忆图集业务服务层 - 编排年度回忆的核心业务逻辑
 * 职责：归属校验、年份唯一性检查、创建草稿、查询详情、列表分页、更新、视频生成
 * 视频生成采用异步队列模式：提交任务后置 generating_video，异步调用视频生成服务，
 * 内容审核通过后置 video_ready 并通过 WebSocket 通知用户，失败自动重试（最多 2 次）
 */
import { YearlyReviewRepository, type YearlyReviewRow } from '../repositories/yearlyReviewRepository.js';
import { PetRepository } from '../repositories/petRepository.js';
import {
  generateMemoirVideo,
  type VideoProductLine,
} from './videoGenerationService.js';
import type { MemoirTier } from '../config.js';
import { moderateVideo } from './videoModerationService.js';
import { sendToUser } from './websocketService.js';
import { sanitizeError } from '../utils/sanitize.js';

/** 创建年度回忆输入 */
export interface CreateYearlyReviewInput {
  year: number;
  auto_select?: boolean;
  custom_photos?: string[];
  title?: string;
}

/** 更新年度回忆输入 */
export interface UpdateYearlyReviewInput {
  title?: string;
  review_data?: { sections?: unknown[] };
  cover_url?: string;
}

/** 年度回忆详情响应 */
export interface YearlyReviewDetailResponse {
  id: string;
  pet_id: string;
  year: number;
  status: string;
  review_data: Record<string, unknown> | null;
  cover_url: string | null;
  video_url: string | null;
  paid: boolean;
  created_at: string;
  updated_at: string;
}

/** 年度回忆列表项响应 */
export interface YearlyReviewListItem {
  id: string;
  year: number;
  status: string;
  cover_url: string | null;
  summary: string;
  photo_count: number;
  paid: boolean;
  created_at: string;
}

/** 业务错误（带状态码，供路由层捕获） */
export class YearlyReviewError extends Error {
  constructor(
    public statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = 'YearlyReviewError';
  }
}

const yearlyReviewRepository = new YearlyReviewRepository();
const petRepository = new PetRepository();

/**
 * 从 review_data 提取摘要（取 summary 字段，无则返回空串）
 */
function extractSummary(reviewData: Record<string, unknown> | null): string {
  if (!reviewData) return '';
  const summary = reviewData.summary;
  return typeof summary === 'string' ? summary : '';
}

/**
 * 从 review_data 统计照片数
 */
function countPhotos(reviewData: Record<string, unknown> | null): number {
  if (!reviewData) return 0;
  const sections = reviewData.sections;
  if (!Array.isArray(sections)) return 0;
  let total = 0;
  for (const section of sections) {
    if (section && typeof section === 'object' && 'photos' in section) {
      const photos = (section as { photos?: unknown }).photos;
      if (Array.isArray(photos)) total += photos.length;
    }
  }
  return total;
}

/**
 * 从 review_data 提取全部照片 URL（sections[].photos 优先，custom_photos 兜底）
 */
function extractPhotos(reviewData: Record<string, unknown> | null): string[] {
  if (!reviewData) return [];
  const photos: string[] = [];

  const sections = reviewData.sections;
  if (Array.isArray(sections)) {
    for (const section of sections) {
      if (section && typeof section === 'object' && 'photos' in section) {
        const sectionPhotos = (section as { photos?: unknown }).photos;
        if (Array.isArray(sectionPhotos)) {
          photos.push(...sectionPhotos.map(String).filter(Boolean));
        }
      }
    }
  }

  if (photos.length === 0) {
    const customPhotos = reviewData.custom_photos;
    if (Array.isArray(customPhotos)) {
      photos.push(...customPhotos.map(String).filter(Boolean));
    }
  }

  return photos;
}

/**
 * 根据照片数量选择视频产品线
 * 8 张及以上走纪念 Vlog（叙事编排，最多 15 张），否则走日常回忆录（最多 3 张）
 */
function selectProductLine(photos: string[]): { productLine: VideoProductLine; sourcePhotos: string[] } {
  if (photos.length >= 8) {
    return { productLine: 'memorial', sourcePhotos: photos.slice(0, 15) };
  }
  return { productLine: 'daily', sourcePhotos: photos.slice(0, 3) };
}

/** 视频生成最大尝试次数（初始 1 次 + 重试 2 次） */
const MAX_VIDEO_ATTEMPTS = 3;

/**
 * 将数据行映射为详情响应
 */
function toDetailResponse(row: YearlyReviewRow): YearlyReviewDetailResponse {
  return {
    id: row.id,
    pet_id: row.pet_id,
    year: row.year,
    status: row.status,
    review_data: row.review_data,
    cover_url: row.cover_url,
    video_url: row.video_url,
    paid: row.paid,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/**
 * 将数据行映射为列表项响应
 */
function toListItem(row: YearlyReviewRow): YearlyReviewListItem {
  return {
    id: row.id,
    year: row.year,
    status: row.status,
    cover_url: row.cover_url,
    summary: extractSummary(row.review_data),
    photo_count: countPhotos(row.review_data),
    paid: row.paid,
    created_at: row.created_at,
  };
}

/**
 * 创建年度回忆（草稿状态）
 * - 归属校验
 * - 同年唯一性检查（UNIQUE(pet_id, year)）
 * - 自动选片或使用自定义照片
 */
export async function createYearlyReview(
  userId: string,
  petId: string,
  data: CreateYearlyReviewInput,
): Promise<YearlyReviewDetailResponse> {
  const owns = await petRepository.canAccess(petId, userId);
  if (!owns) {
    throw new YearlyReviewError(404, '宠物不存在');
  }

  const exists = await yearlyReviewRepository.existsByPetAndYear(petId, data.year);
  if (exists) {
    throw new YearlyReviewError(409, `${data.year} 年度回忆已存在`);
  }

  const autoSelect = data.auto_select !== false;
  const reviewData: Record<string, unknown> = {
    title: data.title ?? `${data.year} 年度回忆`,
    summary: '',
    auto_select: autoSelect,
    custom_photos: data.custom_photos ?? [],
    stats: {
      total_photos: 0,
      total_checkins: 0,
      total_milestones: 0,
      health_avg_score: 0,
      best_month: '',
      vet_visits: 0,
    },
    monthly_highlights: [],
    milestones: [],
    growth_timeline: [],
  };

  const record = await yearlyReviewRepository.insert({
    user_id: userId,
    pet_id: petId,
    year: data.year,
    status: 'draft',
    review_data: JSON.stringify(reviewData),
    paid: false,
  });

  return toDetailResponse(record);
}

/**
 * 获取年度回忆详情（按年份）
 */
export async function getYearlyReviewByYear(
  userId: string,
  petId: string,
  year: number,
): Promise<YearlyReviewDetailResponse> {
  const owns = await petRepository.canAccess(petId, userId);
  if (!owns) {
    throw new YearlyReviewError(404, '宠物不存在');
  }

  const record = await yearlyReviewRepository.findByPetAndYear(petId, year);
  if (!record) {
    throw new YearlyReviewError(404, `${year} 年度回忆不存在`);
  }

  return toDetailResponse(record);
}

/**
 * 分页查询年度回忆列表
 */
export async function listYearlyReviews(
  userId: string,
  petId: string,
  page: number,
  pageSize: number,
): Promise<{ items: YearlyReviewListItem[]; total: number; page: number; page_size: number }> {
  const owns = await petRepository.canAccess(petId, userId);
  if (!owns) {
    throw new YearlyReviewError(404, '宠物不存在');
  }

  const offset = (page - 1) * pageSize;
  const [rows, total] = await Promise.all([
    yearlyReviewRepository.findByPetId(petId, userId, pageSize, offset),
    yearlyReviewRepository.countByPetId(petId, userId),
  ]);

  return {
    items: rows.map(toListItem),
    total,
    page,
    page_size: pageSize,
  };
}

/**
 * 更新年度回忆（标题、内容板块、封面）
 */
export async function updateYearlyReview(
  userId: string,
  petId: string,
  reviewId: string,
  data: UpdateYearlyReviewInput,
): Promise<YearlyReviewDetailResponse> {
  const owns = await petRepository.canAccess(petId, userId);
  if (!owns) {
    throw new YearlyReviewError(404, '宠物不存在');
  }

  const record = await yearlyReviewRepository.findByIdPetUser(reviewId, petId, userId);
  if (!record) {
    throw new YearlyReviewError(404, '年度回忆不存在');
  }

  const updateData: Record<string, unknown> = {};
  if (data.title !== undefined) {
    const existing = record.review_data ?? {};
    const newReviewData = {
      ...existing,
      title: data.title,
    };
    updateData.review_data = JSON.stringify(newReviewData);
  }
  if (data.review_data !== undefined) {
    const existing = record.review_data ?? {};
    const newReviewData = {
      ...existing,
      ...data.review_data,
    };
    updateData.review_data = JSON.stringify(newReviewData);
  }
  if (data.cover_url !== undefined) {
    updateData.cover_url = data.cover_url;
  }
  updateData.updated_at = new Date().toISOString();

  const updated = await yearlyReviewRepository.updateById(reviewId, updateData);
  if (!updated) {
    throw new YearlyReviewError(500, '更新失败');
  }

  return toDetailResponse(updated);
}

/**
 * 生成年度视频（异步队列模式）
 * - 归属校验、状态校验
 * - 提取照片素材并校验数量
 * - 置状态为 generating_video（防重复触发）
 * - 异步调用视频生成服务（不阻塞请求），完成后通过 WebSocket 通知
 */
export async function generateYearlyVideo(
  userId: string,
  petId: string,
  reviewId: string,
): Promise<{ id: string; status: string; message: string }> {
  const owns = await petRepository.canAccess(petId, userId);
  if (!owns) {
    throw new YearlyReviewError(404, '宠物不存在');
  }

  const record = await yearlyReviewRepository.findByIdPetUser(reviewId, petId, userId);
  if (!record) {
    throw new YearlyReviewError(404, '年度回忆不存在');
  }

  if (record.status === 'generating_video') {
    throw new YearlyReviewError(409, '视频正在生成中，请勿重复触发');
  }

  if (record.status === 'draft') {
    throw new YearlyReviewError(400, '草稿状态无法生成视频，请先完善内容');
  }

  // 提取照片素材
  const photos = extractPhotos(record.review_data);
  if (photos.length === 0) {
    throw new YearlyReviewError(400, '年度回忆暂无照片，请先补充照片后再生成视频');
  }

  await yearlyReviewRepository.updateById(reviewId, {
    status: 'generating_video',
    updated_at: new Date().toISOString(),
  });

  // 异步处理生成（fire-and-forget，不阻塞请求响应）
  void processYearlyVideoGeneration(record, photos);

  return {
    id: reviewId,
    status: 'generating_video',
    message: '视频生成任务已提交，预计 5-10 分钟后完成',
  };
}

/**
 * 异步处理年度视频生成
 * - 选择产品线并调用视频生成服务
 * - 内容审核（未配置审核 API 时降级通过）
 * - 审核拒绝或生成失败自动重试（最多 2 次）
 * - 最终成功置 video_ready、失败置 failed，均通过 WebSocket 通知用户
 */
async function processYearlyVideoGeneration(
  record: YearlyReviewRow,
  photos: string[],
): Promise<void> {
  const { productLine, sourcePhotos } = selectProductLine(photos);
  // 显式给出档位（2026-09-11 审查 R-2）：年度回顾没有"用户选档"这一概念，产品线由张数决定，
  // 而 selectProductLine 已把张数裁剪到该线的区间内（memorial→8..15、daily→1..3），
  // 与 full(8-15)/light(1-3) 的档位边界完全重合，故这里映射是等价的；
  // 显式传 tier 是为了不再依赖"产品线兜底恰好蒙对"，把隐式不变式变成显式约束。
  const tier: MemoirTier = productLine === 'memorial' ? 'full' : 'light';
  let lastError = '';

  try {
    for (let attempt = 1; attempt <= MAX_VIDEO_ATTEMPTS; attempt++) {
      try {
        const result = await generateMemoirVideo({
          taskId: record.id,
          productLine,
          // 传档位：让照片数/时长校验走档位边界（与产品线兜底等价，见上方注释）
          tier,
          sourcePhotos,
          sourceText: null,
          musicStyle: 'warm',
          duration: null,
          stylePreset: null,
        });

        // 内容审核
        const moderationResult = await moderateVideo(result.videoUrl);
        if (moderationResult === 'block') {
          lastError = '内容审核未通过';
          continue;
        }
        if (moderationResult === 'review') {
          console.warn(`[YearlyReview] Video ${record.id} flagged for manual review`);
        }

        // 审核通过，标记完成
        await yearlyReviewRepository.updateById(record.id, {
          status: 'video_ready',
          video_url: result.videoUrl,
          updated_at: new Date().toISOString(),
        });

        notifyUser(record.user_id, {
          type: 'yearly_video_ready',
          reviewId: record.id,
          videoUrl: result.videoUrl,
        });
        console.log(`[YearlyReview] Video ${record.id}: Completed successfully`);
        return;
      } catch (err) {
        lastError = sanitizeError(err);
        console.warn(`[YearlyReview] Video ${record.id} attempt ${attempt} failed:`, lastError);
      }
    }

    // 重试次数用完，标记失败
    await yearlyReviewRepository.updateById(record.id, {
      status: 'failed',
      updated_at: new Date().toISOString(),
    });
    notifyUser(record.user_id, {
      type: 'yearly_video_failed',
      reviewId: record.id,
      reason: lastError || '视频生成失败',
    });
    console.error(`[YearlyReview] Video ${record.id}: Failed after max attempts`);
  } catch (err) {
    // 兜底：状态更新失败不影响进程，仅记录日志（防止异步 unhandled rejection）
    console.error(`[YearlyReview] Video ${record.id} finalization failed:`, sanitizeError(err));
  }
}

/**
 * 通过 WebSocket 通知用户年度视频生成状态变更
 */
function notifyUser(
  userId: string,
  message: {
    type: 'yearly_video_ready' | 'yearly_video_failed';
    reviewId: string;
    videoUrl?: string;
    reason?: string;
  },
): void {
  try {
    sendToUser(userId, {
      event: 'yearly_review_status',
      data: message,
    });
  } catch (err) {
    // WebSocket 通知失败不影响主流程，仅记录日志
    console.warn(`[YearlyReview] WebSocket notify failed for user ${userId}:`, sanitizeError(err));
  }
}
