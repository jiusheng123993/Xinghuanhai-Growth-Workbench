/**
 * 喂养记录服务
 *
 * 宠物喂养记录（每日饮食记录）的增删改查
 * 数据存储：对接后端 /api/pets/:petId/feeding-records
 */
import { api } from './api'

export interface FeedingRecord {
  id: string
  petId: string
  recordDate: string
  foodType: string
  brand?: string
  amount: number
  unit?: string
  mealTime?: string
  appetite?: 'good' | 'normal' | 'poor'
  stool?: 'normal' | 'loose' | 'hard'
  energy?: 'high' | 'normal' | 'low'
  notes?: string
  createdAt: string
  updatedAt: string
}

/**
 * 后端返回的喂养记录
 *
 * ⚠️【2026-09-11 修复的契约错位】后端 `routes/feedingRecords.ts` 用
 * `toCamelCase` / `toCamelCaseArray` 把数据库行转成 **camelCase** 后返回
 * （petId / recordDate / foodType / createdAt …）。这里原来按 snake_case 解析
 * （`raw.pet_id` / `raw.record_date` / `raw.food_type` / `raw.created_at`），
 * 于是这些字段恒为 undefined —— 喂养记录列表即便拿到数据也是"空记录"。
 * 现按 camelCase 读并保留 snake_case 兜底（与 api.ts 既有约定一致：
 * 服务端统一返回 camelCase、历史兼容 snake_case）。
 */
interface FeedingRecordRaw {
  id: string
  petId?: string
  pet_id?: string
  userId?: string
  user_id?: string
  recordDate?: string
  record_date?: string
  foodType?: string
  food_type?: string
  brand?: string | null
  amount?: string | number
  unit?: string | null
  mealTime?: string | null
  meal_time?: string | null
  appetite?: string | null
  stool?: string | null
  energy?: string | null
  notes?: string | null
  createdAt?: string
  created_at?: string
  updatedAt?: string
  updated_at?: string
}

function toCamelRecord(raw: FeedingRecordRaw): FeedingRecord {
  return {
    id: raw.id,
    petId: raw.petId ?? raw.pet_id ?? '',
    recordDate: raw.recordDate ?? raw.record_date ?? '',
    foodType: raw.foodType ?? raw.food_type ?? '',
    brand: raw.brand || '',
    // 后端 amount 是 numeric，驱动返回字符串，故这里统一走 String() 再解析
    amount: parseFloat(String(raw.amount ?? '')) || 0,
    unit: raw.unit || '',
    mealTime: raw.mealTime ?? raw.meal_time ?? '',
    appetite: (raw.appetite as FeedingRecord['appetite']) || undefined,
    stool: (raw.stool as FeedingRecord['stool']) || undefined,
    energy: (raw.energy as FeedingRecord['energy']) || undefined,
    notes: raw.notes || '',
    createdAt: raw.createdAt ?? raw.created_at ?? '',
    updatedAt: raw.updatedAt ?? raw.updated_at ?? '',
  }
}

/**
 * 前端字段（camelCase）→ 后端请求体字段（snake_case）
 *
 * ⚠️【2026-09-11 修复】日期字段后端要的是 **`date`**，不是 `record_date`：
 *   `server/src/schemas/index.ts` 的 `createFeedingRecordSchema` 定义
 *   `date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/)`（**必填**），
 *   而 `middleware/validate.ts` 会用 zod 解析结果**整体替换 req.body**。
 *   这里原来发的是 `record_date` → zod 判定 `date 不能为空` → 400 →
 *   api 层抛错 → 调用方恒收到 null，用户侧就是"记录失败，请重试"。
 *   （这层错被上一层的"解包错位"掩盖着：解包修好后才暴露出来。
 *     另外 Mock 模式下 request() 对 POST 直接回显入参，本地永远测不出这个 400。）
 */
function toSnakeRecord(data: Partial<FeedingRecord>): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  // 日期：后端字段名是 date
  if (data.recordDate !== undefined) result.date = data.recordDate
  if (data.foodType !== undefined) result.food_type = data.foodType
  if (data.brand !== undefined) result.brand = data.brand
  if (data.amount !== undefined) result.amount = data.amount
  if (data.unit !== undefined) result.unit = data.unit
  if (data.mealTime !== undefined) result.meal_time = data.mealTime
  if (data.appetite !== undefined) result.appetite = data.appetite
  if (data.stool !== undefined) result.stool = data.stool
  if (data.energy !== undefined) result.energy = data.energy
  if (data.notes !== undefined) result.notes = data.notes
  return result
}

export async function getFeedingRecords(petId: string): Promise<FeedingRecord[]> {
  try {
    // api 层已解包 body.data，这里拿到的就是记录数组（原写法又读了一层 res.data → 恒为空）
    const rows = await api.get<FeedingRecordRaw[]>(`/api/pets/${petId}/feeding-records`)
    return (rows || []).map(toCamelRecord)
  } catch {
    return []
  }
}

export async function addFeedingRecord(
  petId: string,
  data: Omit<FeedingRecord, 'id' | 'petId' | 'createdAt' | 'updatedAt'>
): Promise<FeedingRecord | null> {
  try {
    // 同上：api 返回的已是记录本身（原写法 toCamelRecord(res.data) 收到 undefined →
    // 直接抛错被 catch → 新增喂养记录恒返回 null，用户侧就是"保存失败"）
    const row = await api.post<FeedingRecordRaw>(
      `/api/pets/${petId}/feeding-records`,
      toSnakeRecord(data)
    )
    return row ? toCamelRecord(row) : null
  } catch {
    return null
  }
}

export async function updateFeedingRecord(
  petId: string,
  recordId: string,
  updates: Partial<FeedingRecord>
): Promise<FeedingRecord | null> {
  try {
    const row = await api.put<FeedingRecordRaw>(
      `/api/pets/${petId}/feeding-records/${recordId}`,
      toSnakeRecord(updates)
    )
    return row ? toCamelRecord(row) : null
  } catch {
    return null
  }
}

export async function deleteFeedingRecord(petId: string, recordId: string): Promise<boolean> {
  try {
    await api.delete(`/api/pets/${petId}/feeding-records/${recordId}`)
    return true
  } catch {
    return false
  }
}