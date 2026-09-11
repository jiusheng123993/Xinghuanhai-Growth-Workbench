/**
 * AI建议记录服务 - 效果追踪模块
 *
 * 对接后端 /api/pets/:petId/suggestions 接口
 * 不再使用本地存储
 */
import { api } from './api'

export interface SuggestionRecord {
  id: string
  petId: string
  userId: string
  type: 'feeding' | 'symptom' | 'trend' | 'chat'
  title: string
  content: string
  priority: 'high' | 'medium' | 'low'
  adopted: boolean
  createdAt: string
  adoptedAt: string | null
  updatedAt: string
}

/**
 * 后端返回的原始字段
 *
 * ⚠️【2026-09-11 修复的契约错位】后端 `/api/pets/:petId/suggestions` 返回的是 **camelCase**：
 *   `server/src/routes/suggestionRecords.ts` 里的 `toCamelCase()` 已经把数据库的 snake_case 行
 *   转成了 camelCase（petId / userId / createdAt …）再返回。而这里原来按 snake_case 解析
 *   （`raw.pet_id` / `raw.user_id` / `raw.created_at`），于是这三个字段恒为 undefined，
 *   页面上的表现就是用户反馈的"数据有问题"：
 *     · 每条建议的宠物恒显示「未知宠物」；
 *     · 日期渲染成 Invalid Date；
 *     · 点「采纳」会拿 undefined 的 petId 去请求 `/api/pets/undefined/suggestions/...`，
 *       必然 404 → 提示"操作失败，请重试"。
 *   现在按 camelCase 读，并保留 snake_case 兜底（与 api.ts 既有约定一致：
 *   服务端统一返回 camelCase，历史兼容 snake_case）。
 */
interface SuggestionRecordRaw {
  id: string
  petId?: string
  pet_id?: string
  userId?: string
  user_id?: string
  type: string
  title: string
  content: string
  priority: string
  adopted: boolean
  createdAt?: string
  created_at?: string
  adoptedAt?: string | null
  adopted_at?: string | null
  updatedAt?: string
  updated_at?: string
}

function toCamel(raw: SuggestionRecordRaw): SuggestionRecord {
  return {
    id: raw.id,
    petId: raw.petId ?? raw.pet_id ?? '',
    userId: raw.userId ?? raw.user_id ?? '',
    type: raw.type as SuggestionRecord['type'],
    title: raw.title,
    content: raw.content,
    priority: raw.priority as SuggestionRecord['priority'],
    adopted: raw.adopted,
    createdAt: raw.createdAt ?? raw.created_at ?? '',
    adoptedAt: raw.adoptedAt ?? raw.adopted_at ?? null,
    updatedAt: raw.updatedAt ?? raw.updated_at ?? '',
  }
}

/**
 * 获取某宠物的所有建议记录
 *
 * @returns 记录数组；**返回 null 表示请求失败**（与"请求成功但没有记录"的 [] 区分开）。
 *   为什么要区分：原来失败也返回 []，页面只能显示"暂无AI建议记录"，
 *   用户看到的是"没数据"而实际是"没请求成功" —— 等于把失败伪装成正常空态。
 */
export async function getSuggestionRecords(petId: string): Promise<SuggestionRecord[] | null> {
  try {
    // ⚠️【2026-09-11 修复的解包层级错位】api.get 内部已经做过 `if (body.success) return body.data`
    // （见 services/api.ts 的 request()），也就是说**它返回的就是 data 本身**。
    // 这里原来又读了一层 `res.data` → 恒为 undefined → `|| []` → 列表永远是空的，
    // 无论后端有多少条建议都显示"暂无AI建议记录"。这才是"数据有问题"最直接的元凶。
    const rows = await api.get<SuggestionRecordRaw[]>(`/api/pets/${petId}/suggestions`)
    return (rows || []).map(toCamel)
  } catch {
    return null
  }
}

/**
 * 创建建议记录
 *
 * 【当前无调用方，属有意保留】原调用方是效果追踪页的「+ 生成建议」按钮，
 * 但那个按钮写入的是硬编码文案（不是 AI 生成）、且只针对 pets[0]，会污染采纳率统计，已移除。
 * 服务端 POST 路由仍在，这里保留完整封装，等建议真的有了生成来源（AI 或健康报告）再接回入口。
 */
export async function createSuggestionRecord(
  petId: string,
  data: { type: string; title: string; content: string; priority?: string }
): Promise<SuggestionRecord | null> {
  try {
    // 同 getSuggestionRecords：api 层已解包 data，这里拿到的就是记录本身
    const row = await api.post<SuggestionRecordRaw>(`/api/pets/${petId}/suggestions`, data)
    return toCamel(row)
  } catch {
    return null
  }
}

/**
 * 更新采纳状态
 *
 * 注意解包层级同 getSuggestionRecords —— 原来读 `res.data` 恒为 undefined，
 * `toCamel(undefined)` 会直接抛错被 catch 掉，用户侧的表现就是**点「采纳」永远提示"操作失败"**。
 */
export async function updateSuggestionAdoption(
  petId: string,
  recordId: string,
  adopted: boolean
): Promise<SuggestionRecord | null> {
  try {
    const row = await api.patch<SuggestionRecordRaw>(
      `/api/pets/${petId}/suggestions/${recordId}/adoption`,
      { adopted }
    )
    return toCamel(row)
  } catch {
    return null
  }
}

/** 删除建议记录 */
export async function deleteSuggestionRecord(
  petId: string,
  recordId: string
): Promise<boolean> {
  try {
    await api.delete(`/api/pets/${petId}/suggestions/${recordId}`)
    return true
  } catch {
    return false
  }
}