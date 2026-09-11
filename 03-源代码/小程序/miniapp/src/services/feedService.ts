/**
 * 家庭动态墙服务
 *
 * 对接后端 /api/families/:id/feeds 路由，提供动态列表/发布/编辑/删除/精选功能
 */
import { api } from './api'

/** 动态类型枚举 */
export type FeedType = 'moment' | 'achievement' | 'health_milestone' | 'family_event'

/** 动态基础数据（与后端 FeedRow 对应） */
export interface Feed {
  id: string
  family_id: string
  pet_id: string | null
  user_id: string
  feed_type: FeedType
  content: string
  photos: string[]
  created_at: string
  updated_at: string
}

/** 动态详情（含宠物信息，与后端 FeedWithPetRow 对应） */
export interface FeedWithPet extends Feed {
  pet_name: string | null
  pet_avatar_url: string | null
}

/** 分页响应结构 */
export interface PaginatedFeeds {
  data: FeedWithPet[]
  total: number
  page: number
  page_size: number
}

/** 获取动态列表查询参数 */
export interface GetFeedsParams {
  page?: number
  page_size?: number
  feed_type?: FeedType
  pet_id?: string
}

/** 发布/编辑动态请求体 */
export interface CreateFeedInput {
  pet_id?: string
  feed_type: FeedType
  content: string
  photos?: string[]
}

export interface UpdateFeedInput {
  pet_id?: string
  feed_type?: FeedType
  content?: string
  photos?: string[]
}

/** 统一 API 响应 */
export interface ApiResponse<T> {
  success: boolean
  data: T
}

export const feedService = {
  /** 获取家庭动态列表（分页） */
  async getFeeds(familyId: string, params?: GetFeedsParams): Promise<PaginatedFeeds> {
    const query: Record<string, string> = {}
    if (params?.page !== undefined) query.page = String(params.page)
    if (params?.page_size !== undefined) query.page_size = String(params.page_size)
    if (params?.feed_type) query.feed_type = params.feed_type
    if (params?.pet_id) query.pet_id = params.pet_id

    const data = await api.get<PaginatedFeeds>(`/api/families/${familyId}/feeds`, query)
    return data
  },

  /** 发布新动态 */
  async createFeed(familyId: string, input: CreateFeedInput): Promise<Feed> {
    const body: Record<string, unknown> = {
      feed_type: input.feed_type,
      content: input.content,
    }
    if (input.pet_id) body.pet_id = input.pet_id
    if (input.photos) body.photos = input.photos

    const data = await api.post<Feed>(`/api/families/${familyId}/feeds`, body)
    return data
  },

  /** 编辑动态 */
  async updateFeed(familyId: string, feedId: string, input: UpdateFeedInput): Promise<Feed> {
    const body: Record<string, unknown> = {}
    if (input.feed_type) body.feed_type = input.feed_type
    if (input.content !== undefined) body.content = input.content
    if (input.pet_id !== undefined) body.pet_id = input.pet_id
    if (input.photos) body.photos = input.photos

    const data = await api.put<Feed>(`/api/families/${familyId}/feeds/${feedId}`, body)
    return data
  },

  /** 删除动态 */
  async deleteFeed(familyId: string, feedId: string): Promise<void> {
    await api.delete(`/api/families/${familyId}/feeds/${feedId}`)
  },

  /**
   * 获取精选动态
   *
   * ⚠️【2026-09-11 修复】后端 `routes/feeds.ts` 返回 `{ success: true, data: items }`，
   * api 层已经把 data 解包出来（这里拿到的就是数组）。原来又读一层 `data?.data`
   * → 恒 undefined → `|| []` → **家庭动态的「精选动态」永远是空的**。
   */
  async getHighlightFeeds(familyId: string): Promise<FeedWithPet[]> {
    const rows = await api.get<FeedWithPet[]>(`/api/families/${familyId}/feeds/highlight`)
    return rows || []
  },
}
