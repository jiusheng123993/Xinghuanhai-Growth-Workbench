/**
 * 时间线服务
 *
 * 宠物动态时间线的查询/轮询/缓存管理
 * 补充：删除回忆、AI 生成照片描述、AI 润色文案（回忆补记走 happenedAt）
 */
import Taro from '@tarojs/taro'
import { api } from './api'
import { CONFIG } from '../config'
import { storage } from '../utils/storage'
import type { PetMoment, PetMilestone } from '../types/familyTypes'

export const timelineService = {
  /**
   * 拉取回忆列表
   *
   * 【limit 为什么是 100】2026-09-11 时光页改成"所有宠物共用一条时间线"后，这 50 条
   *   不再是一只宠物的量，而是**全部宠物**的总量 —— 多宠家庭很容易攒够 50 条，
   *   于是更早的回忆（往往是某只宠物唯一的早期记录）会被静默截断、在页面上彻底消失。
   *   服务端该接口的上限就是 100（`timelineMomentsQuerySchema`），故这里直接取满。
   * ⚠️ 已知边界：超过 100 条仍会被截断。彻底解决要给后端加分页/游标（`findByUser` 目前
   *   不支持分页），属独立改造，不在本次范围；在此之前 100 是能拿到的最大值。
   *
   * @param petId - 可选：只取某只宠物的回忆（不传＝全部宠物共用一本）
   * @param familyId - 可选：家庭维度的回忆
   */
  async getMoments(petId?: string, familyId?: string): Promise<PetMoment[]> {
    const params: Record<string, string> = { limit: '100' }
    if (petId) params.pet_id = petId
    if (familyId) params.family_id = familyId
    const data = await api.get<PetMoment[]>('/api/timeline/moments', params)
    return data || []
  },

  /**
   * 新增回忆
   *
   * @param moment - 回忆内容；除 PetMoment 字段外可带 `petIds`：
   *   **这条回忆关联的全部宠物**（多宠共同回忆，2026-09-11 新增）。
   *   服务端会逐个校验归属，并用库里的权威名字/物种写入 content.pets；
   *   `petId` 仍是主宠物（= petIds[0]），老读取路径不受影响。
   * @returns 落库后的回忆（含服务端补齐的 content.pets）
   */
  async addMoment(
    moment: Omit<PetMoment, 'id' | 'createdAt'> & { petIds?: string[] },
  ): Promise<PetMoment> {
    const data = await api.post<PetMoment>('/api/timeline/moments', moment)
    return data
  },

  /** 删除回忆（带归属校验，只能删自己的） */
  async deleteMoment(id: string): Promise<void> {
    await api.delete(`/api/timeline/moments/${id}`)
  },

  /**
   * AI 生成照片描述：上传本地照片 → 服务器视觉模型识别 → 返回温暖文案
   * @param filePath - 本地照片临时路径（chooseImage 返回）
   */
  async aiDescribe(filePath: string): Promise<string> {
    const data = await uploadFile('/api/timeline/ai-describe', filePath)
    return (data as { description?: string }).description || ''
  },

  /** AI 润色回忆文案：用户草稿 → 温暖扩写 */
  async aiPolish(text: string): Promise<string> {
    const data = await api.post<{ text: string }>('/api/timeline/ai-polish', { text })
    return data.text || ''
  },

  async getMilestones(petId: string): Promise<PetMilestone[]> {
    const data = await api.get<PetMilestone[]>('/api/timeline/milestones', { pet_id: petId })
    return data || []
  },

  async addMilestone(milestone: Omit<PetMilestone, 'id' | 'createdAt'>): Promise<PetMilestone> {
    const data = await api.post<PetMilestone>('/api/timeline/milestones', milestone)
    return data
  },
}

/**
 * 上传单张照片到指定接口（带鉴权头）
 * 通用小工具：供 AI 描述等需要 multipart 上传的接口复用
 */
async function uploadFile(path: string, filePath: string): Promise<unknown> {
  const token = storage.getToken()
  const res = await Taro.uploadFile({
    url: `${CONFIG.API_BASE_URL}${path}`,
    filePath,
    name: 'photo',
    header: token ? { Authorization: `Bearer ${token}` } : {},
  })
  const body = JSON.parse(res.data) as { success: boolean; data?: unknown; message?: string }
  if (body.success) return body.data
  throw new Error(body.message || '上传失败')
}
