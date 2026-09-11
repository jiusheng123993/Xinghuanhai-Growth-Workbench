/**
 * AI 记忆服务
 *
 * 对接后端 memory-body 记忆引擎的"可编辑记忆"能力：
 *   1. GET /api/memory?petId=xxx  — 查看记忆列表（按宠物过滤，登录态）
 *   2. PUT /api/memory/:id        — 修正记忆内容（登录态 + 归属校验）
 *
 * 设计来源：参考 Pet_agent 的"记忆可编辑/可见"设计，
 * 让用户查看/修正 AI 记住的宠物数据，可纠错、可审计。
 *
 * 安全约束：
 *   - 后端全部接口需登录，从 JWT 提取 userId，不接受前端传 userId
 *   - 修正操作后端做归属校验（记忆必须属于当前用户），防横向越权
 *   - 修正后 source 标记为 manual，防止被后续自动提取覆盖
 */
import { api } from './api';
import { mockApi } from './mock';
import { CONFIG } from '../config';
import type {
  MemoryEntry,
  MemoryListResponse,
  MemoryUpdatePayload,
  MemoryUpdateResult,
  MemoryCategory,
  MemorySource,
  MemoryStatus,
} from '../types/memoryTypes';
import type { FillIconName } from '../components/icons-fill';

/** 是否启用 Mock 模式（原名 useMock，以 "use" 开头会被 react-hooks 规则误判为 Hook，2026-09-11 改名） */
const isMockMode = () => CONFIG.USE_MOCK;

/** 记忆上限（与后端 listUserMemories LIMIT 200 对齐） */
const MAX_MEMORY_CONTENT_LENGTH = 2000;

/**
 * 获取当前用户的记忆列表（可按宠物过滤）
 * @param petId 可选，指定宠物则只返回该宠物的记忆
 */
export async function listMemories(petId?: string): Promise<MemoryEntry[]> {
  if (isMockMode()) {
    return mockApi.listMemories?.(petId) ?? [];
  }
  const params: Record<string, string> = {};
  if (petId) params.petId = petId;
  const data = await api.get<MemoryListResponse>('/api/memory', params);
  return data?.list ?? [];
}

/**
 * 修正记忆内容（用户手动纠错）
 * @param memoryId 记忆 ID
 * @param content 新内容（trim 后 1-2000 字符）
 * @returns 更新成功返回 {id, content}，失败抛错
 */
export async function updateMemory(
  memoryId: number,
  content: string,
): Promise<MemoryUpdateResult> {
  if (!Number.isInteger(memoryId) || memoryId <= 0) {
    throw new Error('记忆ID格式错误');
  }
  const trimmed = content.trim();
  if (!trimmed) {
    throw new Error('记忆内容不能为空');
  }
  if (trimmed.length > MAX_MEMORY_CONTENT_LENGTH) {
    throw new Error(`记忆内容过长（最多 ${MAX_MEMORY_CONTENT_LENGTH} 字）`);
  }

  if (isMockMode()) {
    return mockApi.updateMemory?.(memoryId, trimmed) ?? { id: memoryId, content: trimmed };
  }

  const payload: MemoryUpdatePayload = { content: trimmed };
  return api.put<MemoryUpdateResult>(`/api/memory/${memoryId}`, payload);
}

/** 记忆分类展示信息（icon 存面性图标名，原为 emoji，2026-09-10 统一到图标体系） */
export function getCategoryInfo(category: MemoryCategory): { icon: FillIconName; label: string } {
  switch (category) {
    case 'health':
      return { icon: 'heart', label: '健康' };
    case 'behavior':
      return { icon: 'paw-print', label: '行为' };
    case 'habit':
      return { icon: 'clock', label: '习惯' };
    case 'preference':
      return { icon: 'star', label: '偏好' };
    case 'event':
      return { icon: 'sparkle', label: '事件' };
    case 'feeding':
      return { icon: 'bowl-food', label: '喂养' };
    case 'medical':
      return { icon: 'pill', label: '医疗' };
    case 'contradiction':
      return { icon: 'arrows-clockwise', label: '已修正' };
    case 'general':
    default:
      return { icon: 'note-pencil', label: '其他' };
  }
}

/** 记忆来源展示文案 */
export function getSourceLabel(source: MemorySource): string {
  switch (source) {
    case 'auto':
      return 'AI 自动记录';
    case 'manual':
      return '用户手动修正';
    case 'contradiction_resolved':
      return '矛盾已解决';
    default:
      return '未知';
  }
}

/** 记忆状态展示文案 */
export function getStatusLabel(status: MemoryStatus): string {
  switch (status) {
    case 'active':
      return '生效中';
    case 'dormant':
      return '已休眠';
    case 'expired':
      return '已过期';
    case 'contradicted':
      return '已被替代';
    default:
      return '未知';
  }
}

/** 重要性星级文案（1-10 → 1-5 星） */
export function getImportanceStars(importance: number): string {
  const stars = Math.max(1, Math.min(5, Math.ceil(importance / 2)));
  return '★'.repeat(stars) + '☆'.repeat(5 - stars);
}
