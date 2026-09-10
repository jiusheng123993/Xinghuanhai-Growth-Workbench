/**
 * 健康打卡服务
 *
 * 宠物健康打卡的查询/创建/统计，含本地缓存与云端同步、风险评估与 AI 反馈
 */
import { api } from './api';
import { getStorage, setStorage } from '../utils/storage';
import { queueSync } from './syncHelper';
import { requirePetOwnership } from '../utils/petOwnership';
import type { PetHealthEntry, HealthRiskLevel, AnomalyItem } from '../memory-body/types/memoryBodyTypes';
import { HealthIndexAdapter } from '../memory-body/adapters/healthIndexAdapter';

export type { PetHealthEntry, HealthRiskLevel } from '../memory-body/types/memoryBodyTypes';

/** 健康打卡统计 */
export interface HealthCheckinStats {
  totalCheckins: number;
  streak: number;
  lastCheckinDate: string | null;
  weeklyCount: number;
  monthlyCount: number;
  consecutiveAnomalyDays: number;
  totalAnomalyDays: number;
  lastAnomalyDate: string | null;
}

function userKey(key: string, userId: string): string {
  return `${key}_${userId}`;
}

function getStorageKey(petId: string, userId: string): string {
  return userKey(`checkins_${petId}`, userId);
}

function generateId(): string {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function getLocalCheckins(petId: string, userId: string): PetHealthEntry[] {
  return getStorage<PetHealthEntry[]>(getStorageKey(petId, userId)) || [];
}

function saveLocalCheckins(petId: string, userId: string, entries: PetHealthEntry[]): void {
  setStorage(getStorageKey(petId, userId), entries);
}

type LegacyRiskLevel = 'normal' | 'caution' | 'warning' | 'emergency';

function mapRiskLevel(legacy: LegacyRiskLevel): HealthRiskLevel {
  switch (legacy) {
    case 'normal': return 'low';
    case 'caution': return 'medium';
    case 'warning': return 'high';
    case 'emergency': return 'emergency';
  }
}

/** 打卡输入参数 */
export interface CheckinInput {
  petId: string;
  userId: string;
  poopLevel: 1 | 2 | 3 | 4 | 5;
  appetiteLevel: 1 | 2 | 3 | 4 | 5 | 6;
  spiritLevel: 1 | 2 | 3 | 4 | 5;
  exerciseLevel: 1 | 2 | 3;
  weight?: number;
  hasAnomaly: boolean;
  anomalyItems: AnomalyItem[];
  note?: string;
}

/** 健康分：存储等级 → 分数（健康分语义 = "正常=最健康=满分"，偏离正常按程度降分） */
const POOP_SCORE: Record<number, number> = { 1: 0, 2: 1, 3: 5, 4: 3, 5: 2 };
const APPETITE_SCORE: Record<number, number> = { 1: 0, 2: 2, 3: 5, 4: 4, 5: 1, 6: 1 };
const SPIRIT_SCORE: Record<number, number> = { 1: 0, 2: 3, 3: 5, 4: 4, 5: 2 };

/**
 * 计算健康分（0-100），供宠物详情页/创作页等统一使用。
 * 满分 15 = 便便成型(5) + 食欲正常(5) + 精神正常(5)——"正常"即最健康状态。
 * "都正常"（成型 + 正常吃完 + 正常活动）= 15 → 100 分。
 * 修复历史 bug（2026-09-10）：此前直接用存储等级（poopLevel 等）算分，把"正常=3"
 * 当中间值 → "都正常"只给 64 分，与"状态满分"文案自相矛盾（用户反馈"都正常怎么才 62 分"）。
 */
export function calcHealthScore(poop: number, appetite: number, spirit: number): number {
  const p = POOP_SCORE[poop] ?? 3;
  const a = APPETITE_SCORE[appetite] ?? 3;
  const s = SPIRIT_SCORE[spirit] ?? 3;
  return Math.round(((p + a + s) / 15) * 100);
}

function calculateRiskLevel(entry: CheckinInput): HealthRiskLevel {
  let legacy: LegacyRiskLevel = 'normal';

  if (entry.poopLevel === 1) legacy = 'emergency';
  else if (entry.appetiteLevel === 6) legacy = 'emergency';
  else if (entry.appetiteLevel === 1 && entry.spiritLevel === 1) legacy = 'emergency';
  else if (entry.poopLevel === 2 && entry.appetiteLevel <= 2 && entry.spiritLevel <= 2) legacy = 'emergency';
  else if (entry.appetiteLevel === 5 && entry.poopLevel <= 2) legacy = 'emergency';
  else if (entry.appetiteLevel <= 2 && entry.spiritLevel <= 2) legacy = 'warning';
  else if (entry.poopLevel === 2) legacy = 'warning';
  else if (entry.appetiteLevel <= 2) legacy = 'warning';
  else if (entry.spiritLevel <= 2) legacy = 'warning';
  else if (entry.appetiteLevel === 5 && entry.spiritLevel <= 2) legacy = 'warning';
  else if (entry.appetiteLevel === 5) legacy = 'caution';
  else if (entry.hasAnomaly) legacy = 'caution';
  // 注意：3 = "正常"档，不能判为 caution（历史语义颠倒曾导致全勾正常也报"轻度异常"，
  // 与报告文案"状态满分"自相矛盾并污染趋势 dominantRiskLevel）——其余情况兜底为 normal

  return mapRiskLevel(legacy);
}

function generateAiFeedback(entry: CheckinInput, riskLevel: HealthRiskLevel): string {
  const symptoms: string[] = [];

  if (entry.appetiteLevel <= 2) symptoms.push('食欲异常');
  if (entry.appetiteLevel === 6) symptoms.push('呕吐');
  if (entry.appetiteLevel === 5) symptoms.push('食欲亢进');
  if (entry.spiritLevel <= 2) symptoms.push('精神状态异常');
  if (entry.poopLevel <= 2) symptoms.push('排便异常');
  if (entry.hasAnomaly) symptoms.push(`异常项：${entry.anomalyItems.join('、')}`);

  const symptomText = symptoms.length > 0 ? `具体症状：${symptoms.join('、')}。` : '';

  switch (riskLevel) {
    case 'emergency':
      return `⚠️ 检测到紧急健康信号！建议立即联系宠物医院。${symptomText}`;
    case 'high':
      return `🔔 您的宠物出现了一些需要关注的症状。建议密切观察，如持续恶化请就医。${symptomText}`;
    case 'medium':
      return `💡 您的宠物有些小异常，建议多观察。${symptomText}`;
    case 'low':
      return '✅ 您的宠物今天状态不错！继续保持良好的照顾习惯。';
  }
}

function entryDateStr(entry: PetHealthEntry): string {
  if (entry.createdAt instanceof Date) {
    return entry.createdAt.toISOString().slice(0, 10);
  }
  return String(entry.createdAt).slice(0, 10);
}

/**
 * 获取打卡记录列表（含本地缓存兜底）
 * @param petId - 宠物 ID
 * @param userId - 用户 ID
 */
export async function getCheckins(petId: string, userId: string): Promise<PetHealthEntry[]> {
  requirePetOwnership(petId, userId);
  try {
    const result = await api.get<PetHealthEntry[]>(`/api/pets/${petId}/checkins`);
    saveLocalCheckins(petId, userId, result);
    return result;
  } catch (error) {
    return getLocalCheckins(petId, userId);
  }
}

/**
 * 按日期范围查询打卡记录
 * @param petId - 宠物 ID
 * @param userId - 用户 ID
 * @param startDate - 开始日期 (YYYY-MM-DD)
 * @param endDate - 结束日期 (YYYY-MM-DD)
 */
export async function getCheckinsByDateRange(
  petId: string,
  userId: string,
  startDate: string,
  endDate: string
): Promise<PetHealthEntry[]> {
  requirePetOwnership(petId, userId);
  try {
    const result = await api.get<PetHealthEntry[]>(
      `/api/pets/${petId}/checkins?startDate=${startDate}&endDate=${endDate}`
    );
    return result;
  } catch (error) {
    const all = getLocalCheckins(petId, userId);
    return all.filter((e) => {
      const dateStr = entryDateStr(e);
      return dateStr >= startDate && dateStr <= endDate;
    });
  }
}

/**
 * 创建打卡记录（先写云端，失败则存本地）
 * @param data - 打卡输入参数
 */
export async function createCheckin(data: CheckinInput): Promise<PetHealthEntry> {
  requirePetOwnership(data.petId, data.userId);
  const riskLevel = calculateRiskLevel(data);
  const aiFeedback = generateAiFeedback(data, riskLevel);
  const now = new Date();

  const newEntry: PetHealthEntry = {
    id: generateId(),
    petId: data.petId,
    userId: data.userId,
    poopLevel: data.poopLevel,
    appetiteLevel: data.appetiteLevel,
    spiritLevel: data.spiritLevel,
    exerciseLevel: data.exerciseLevel,
    weight: data.weight,
    hasAnomaly: data.hasAnomaly,
    anomalyItems: data.anomalyItems,
    aiFeedback,
    riskLevel,
    note: data.note,
    createdAt: now,
  };

  // 同步写入记忆引擎健康存储（memory-body），让 AI 对话/趋势能引用最近的健康数据
  // （PRD 4.3.2：打卡数据写入 memory-body）
  try {
    new HealthIndexAdapter(data.userId).indexHealthEntry(newEntry)
  } catch (error) {
    // 记忆写入失败不影响打卡主流程
    console.warn('[Checkin] 写入记忆引擎失败:', error)
  }

  try {
    // 后端 createCheckinSchema 使用 snake_case（必填：4 个等级 + risk_level）
    const result = await api.post<PetHealthEntry>(`/api/pets/${data.petId}/checkins`, {
      poop_level: data.poopLevel,
      appetite_level: data.appetiteLevel,
      spirit_level: data.spiritLevel,
      exercise_level: data.exerciseLevel,
      weight: data.weight,
      has_anomaly: data.hasAnomaly,
      anomaly_items: data.anomalyItems,
      ai_feedback: aiFeedback,
      risk_level: riskLevel,
      note: data.note,
    });
    const local = getLocalCheckins(data.petId, data.userId);
    const todayStr = entryDateStr(newEntry);
    const existingIndex = local.findIndex((e) => entryDateStr(e) === todayStr);
    if (existingIndex !== -1) {
      local[existingIndex] = result;
    } else {
      local.push(result);
    }
    saveLocalCheckins(data.petId, data.userId, local);
    queueSync('pet_health_entries', newEntry.id, 'insert', newEntry, data.userId);
    return result;
  } catch (error) {
    const local = getLocalCheckins(data.petId, data.userId);
    const todayStr = entryDateStr(newEntry);
    const existingIndex = local.findIndex((e) => entryDateStr(e) === todayStr);
    if (existingIndex !== -1) {
      local[existingIndex] = newEntry;
    } else {
      local.push(newEntry);
    }
    saveLocalCheckins(data.petId, data.userId, local);
    queueSync('pet_health_entries', newEntry.id, 'insert', newEntry, data.userId);
    return newEntry;
  }
}

/**
 * 批量创建打卡记录（多宠快捷打卡）
 *
 * 按顺序逐只调用 createCheckin，单只失败不阻断其他宠物；
 * createCheckin 内部已有“云端失败写本地”兜底，因此这里只需要汇总结果。
 * @param items - 每只宠物的打卡输入
 * @returns 成功创建的打卡记录数组（失败项被跳过）
 */
export async function batchCreateCheckins(items: CheckinInput[]): Promise<PetHealthEntry[]> {
  const results: PetHealthEntry[] = []
  for (const item of items) {
    try {
      results.push(await createCheckin(item))
    } catch (error) {
      // 单只失败时继续后续宠物，保证“一键打卡”不因个别失败而中断
      console.warn(`[Checkin] 批量打卡失败 petId=${item.petId}:`, error)
    }
  }
  return results
}

/**
 * 获取今日打卡记录
 * @param petId - 宠物 ID
 * @param userId - 用户 ID
 */
export async function getTodayCheckin(petId: string, userId: string): Promise<PetHealthEntry | null> {
  if (!petId) {
    console.warn('getTodayCheckin: petId is required');
    return null;
  }
  const today = new Date().toISOString().slice(0, 10);
  try {
    const result = await api.get<PetHealthEntry | null>(
      `/api/pets/${petId}/checkins/today?date=${today}`
    );
    return result;
  } catch (error) {
    const local = getLocalCheckins(petId, userId);
    return local.find((e) => entryDateStr(e) === today) || null;
  }
}

/**
 * 获取打卡统计数据
 * 后端未提供 stats 专用接口，直接基于本地缓存计算（含云端同步回写的数据）
 * @param petId - 宠物 ID
 * @param userId - 用户 ID
 */
export async function getCheckinStats(petId: string, userId: string): Promise<HealthCheckinStats> {
  const local = getLocalCheckins(petId, userId);
  return calculateLocalStats(local);
}

export async function getLatestCheckin(petId: string, userId: string): Promise<PetHealthEntry | null> {
  const local = getLocalCheckins(petId, userId);
  if (local.length === 0) return null;
  return local.reduce((latest, entry) =>
    entryDateStr(entry) > entryDateStr(latest) ? entry : latest
  );
}

export function calculateConsecutiveAnomalyDays(
  entries: PetHealthEntry[],
): number {
  const sorted = [...entries]
    .sort((a, b) => {
      const aStr = entryDateStr(a)
      const bStr = entryDateStr(b)
      return bStr.localeCompare(aStr)
    })
  const seenDates = new Set<string>()
  let count = 0
  for (const entry of sorted) {
    const dateStr = entryDateStr(entry)
    if (seenDates.has(dateStr)) continue
    seenDates.add(dateStr)
    if (entry.hasAnomaly) {
      count++
    } else {
      break
    }
  }
  return count
}

function calculateLocalStats(entries: PetHealthEntry[]): HealthCheckinStats {
  const now = new Date();
  const todayStr = now.toISOString().slice(0, 10);

  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - now.getDay());
  const weekStartStr = weekStart.toISOString().slice(0, 10);

  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthStartStr = monthStart.toISOString().slice(0, 10);

  const sortedDates = entries
    .map((e) => entryDateStr(e))
    .filter((d, i, arr) => arr.indexOf(d) === i)
    .sort()
    .reverse();

  let streak = 0;
  const checkDate = new Date(todayStr);
  for (const dateStr of sortedDates) {
    const expected = checkDate.toISOString().slice(0, 10);
    if (dateStr === expected) {
      streak++;
      checkDate.setDate(checkDate.getDate() - 1);
    } else {
      break;
    }
  }

  const consecutiveAnomalyDays = calculateConsecutiveAnomalyDays(entries);
  const anomalyEntries = entries.filter((e) => e.hasAnomaly);
  const totalAnomalyDays = anomalyEntries.length;
  const lastAnomalyDate = anomalyEntries.length > 0
    ? entryDateStr(anomalyEntries.sort((a, b) => entryDateStr(b).localeCompare(entryDateStr(a)))[0])
    : null;

  return {
    totalCheckins: entries.length,
    streak,
    lastCheckinDate: sortedDates.length > 0 ? sortedDates[0] : null,
    weeklyCount: entries.filter((e) => entryDateStr(e) >= weekStartStr).length,
    monthlyCount: entries.filter((e) => entryDateStr(e) >= monthStartStr).length,
    consecutiveAnomalyDays,
    totalAnomalyDays,
    lastAnomalyDate,
  };
}
