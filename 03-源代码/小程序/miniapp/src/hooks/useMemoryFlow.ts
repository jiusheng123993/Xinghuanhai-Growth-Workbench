/**
 * 回忆录制流程 Hook
 * 管理回忆录制激活状态、照片选择和上传，将用户输入的回忆写入时间线服务
 */
import { useCallback, useState } from 'react'
import Taro from '@tarojs/taro'
import { timelineService } from '../services/timelineService'
import { useAuthStore } from '../stores/authStore'
import { usePetStore } from '../stores/petStore'
import { CONFIG } from '../config'
import { storage } from '../utils/storage'
import { chooseImageWithPrivacy } from '../utils/privacy'
import { detectPetsInText } from '../utils/petMatching'
import { logger } from '../logger'
import type { PetInfo } from '../types/chatTypes'
import type { PetProfile } from '../services/petService'

export interface UseMemoryFlowParams {
  addAiMsg: (content: string, options?: string[]) => void
  addUserMsg: (content: string) => void
  setIsTyping: (typing: boolean) => void
  petInfo: PetInfo
}

const ALLOWED_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp', 'heic']

/**
 * 回忆录制流程 Hook
 *
 * 管理回忆录制激活状态、照片选择和上传，
 * 负责将用户输入的回忆文本和照片写入时间线服务。
 */
export function useMemoryFlow(params: UseMemoryFlowParams) {
  const { addAiMsg, setIsTyping, petInfo } = params
  const [memoryActive, setMemoryActive] = useState(false)
  const [memoryPhoto, setMemoryPhoto] = useState<string | null>(null)
  const [isUploadingPhoto, setIsUploadingPhoto] = useState(false)

  /** 启动回忆录制流程 */
  const startMemoryRecord = useCallback(() => {
    setMemoryActive(true)
    setMemoryPhoto(null)
    addAiMsg('要记录一段回忆吗？太棒了 ✦\n\n你可以：\n1. 点击下方 📷 按钮拍照或上传一张照片\n2. 在输入框写一段话描述这个瞬间\n\n我会帮你整理成回忆卡片～')
  }, [addAiMsg])

  /** 选择照片（拍照或相册） */
  const handleMemoryPhoto = useCallback(async () => {
    try {
      const res = await chooseImageWithPrivacy({
        count: 1,
        sizeType: ['compressed'],
        sourceType: ['album', 'camera'],
      })
      if (!res.tempFilePaths.length) return

      const filePath = res.tempFilePaths[0]
      const ext = filePath.split('.').pop()?.toLowerCase() || ''
      if (!ALLOWED_EXTENSIONS.includes(ext)) {
        Taro.showToast({ title: '请上传 JPG/PNG/WebP 格式图片', icon: 'none' })
        return
      }

      setMemoryPhoto(filePath)
      Taro.showToast({ title: '照片已选择，继续输入文字吧～', icon: 'success', duration: 1500 })
    } catch (err) {
      if ((err as { errMsg?: string }).errMsg?.includes('cancel')) {
        return
      }
      Taro.showToast({ title: '选择照片失败', icon: 'none' })
    }
  }, [])

  /** 清除已选照片 */
  const clearMemoryPhoto = useCallback(() => {
    setMemoryPhoto(null)
  }, [])

  /** 上传照片到服务器 */
  const uploadMemoryPhoto = useCallback(async (): Promise<string | null> => {
    if (!memoryPhoto) return null
    setIsUploadingPhoto(true)
    try {
      const token = storage.getToken()
      const res = await Taro.uploadFile({
        url: `${CONFIG.API_BASE_URL}/api/timeline/photo/upload`,
        filePath: memoryPhoto,
        name: 'photo',
        header: token ? { Authorization: `Bearer ${token}` } : {},
      })
      const data = JSON.parse(res.data) as { success: boolean; data?: { url: string }; url?: string }
      if (data.success) {
        return data.data?.url || data.url || null
      }
      return null
    } catch {
      return null
    } finally {
      setIsUploadingPhoto(false)
    }
  }, [memoryPhoto])

  /** 处理用户输入的回忆文本并保存到时间线 */
  const handleMemoryRecord = useCallback(
    async (text: string) => {
      setMemoryActive(false)
      if (!petInfo.activePet?.id) {
        addAiMsg('请先添加宠物后再记录回忆。')
        return
      }
      setIsTyping(true)
      try {
        // 先上传照片（如果有）
        let photoUrl: string | null = null
        if (memoryPhoto) {
          photoUrl = await uploadMemoryPhoto()
        }

        const userId = useAuthStore.getState().user?.id || ''
        /**
         * 归属宠物：**从正文里认**（2026-09-11 新增）
         *
         * 用户说"记一下烧鸭今天拆家"，过去一律记到 AI 页当前选中的那只名下 —— 说烧鸭记烧鸡，
         * 界面上还看不出来。现在统一走 utils/petMatching：正文提到谁就记给谁（提到多只就都关联），
         * 一只都没提到才回退到当前选中。服务端仍会逐个校验归属，前端只负责猜默认值。
         */
        const allPets = usePetStore.getState().pets
        const candidatePets = allPets.length ? allPets : []
        const detectedIds = detectPetsInText(text, candidatePets, petInfo.activePet.id)
        const targetPets = detectedIds
          .map((id) => candidatePets.find((p) => p.id === id))
          .filter((p): p is PetProfile => !!p)
        // 极端情况（宠物列表为空/被删）：回退到"当前活跃宠物"，行为与改动前一致
        const primaryPetId = targetPets.length ? targetPets[0].id : petInfo.activePet.id
        const primaryPetName = targetPets.length ? targetPets[0].name : petInfo.name
        const primaryPetEmoji = targetPets.length
          ? (targetPets[0].species === 'cat' ? '🐱' : targetPets[0].species === 'dog' ? '🐕' : '🐾')
          : petInfo.emoji

        await timelineService.addMoment({
          userId,
          petId: primaryPetId,
          // 多宠共同回忆：服务端校验归属后用库里的权威名字写入 content.pets
          petIds: targetPets.length ? targetPets.map((p) => p.id) : undefined,
          type: 'memory',
          content: {
            petName: primaryPetName,
            petEmoji: primaryPetEmoji,
            description: text,
          },
          photos: photoUrl ? [photoUrl] : [],
        })
        setMemoryPhoto(null)
        setIsTyping(false)
        // 三种结果分开说，不合并成一句"已记录"（见下方 catch 注释的同类问题）：
        // uploadMemoryPhoto 上传失败时返回 null 而不是抛错，若不加区分，用户会以为照片也存上了
        if (photoUrl) {
          addAiMsg('回忆已记录 ✦\n\n照片和文字都已保存，你可以在「时光」页面查看所有回忆哦～')
        } else if (memoryPhoto) {
          addAiMsg('回忆已记录（仅文字）✦\n\n照片这次没能上传成功，这条回忆先按纯文字存下了，你可以在「时光」页面查看。')
        } else {
          addAiMsg('回忆已记录 ✦\n\n你可以在「时光」页面查看所有回忆哦～')
        }
      } catch (err) {
        setIsTyping(false)
        logger.error('index', 'memory record failed', err)
        // 失败后**保留照片、重新武装录制流程**（2026-09-11 审查 P3）：
        // 原先这里把 memoryPhoto 清空且 memoryActive 已是 false，而文案却让用户"再发一次"——
        // 此时重发会走 Agent（不是回忆录制流程），内容根本不会重新落库，等于给了个走不通的指引。
        // ⚠️ 说清楚保留的是什么（2026-09-11 二轮审查 P2-4）：这里只保留了**照片**；
        //   文字在上游 useChatCore 发消息时就被清空了（setInputValue('')），所以文案不能承诺"原样再发一次"，
        //   必须明确告诉用户"照片还在，文字要再写一遍"。
        setMemoryActive(true)
        // 保存失败必须如实告知（2026-09-11 复盘）：
        // 原实现在任何失败（网络异常 / 401 / 500）下都回"回忆已保存到本地 ✦ 你可以在「时光」页面查看"，
        // 用户以为记下了、去「时光」却找不到——与"AI 说记了其实没记"是同一类信任事故。
        addAiMsg('抱歉，这段回忆没能保存上 ✦\n\n可能是网络不稳或登录已过期。你刚选的照片还留着，请再写一遍这段文字（也可以到「时光」页点「记录」手动补上）。')
      }
    },
    [addAiMsg, memoryPhoto, petInfo.activePet, petInfo.emoji, petInfo.name, setMemoryActive, setIsTyping, uploadMemoryPhoto]
  )

  return {
    memoryActive,
    setMemoryActive,
    memoryPhoto,
    isUploadingPhoto,
    startMemoryRecord,
    handleMemoryPhoto,
    clearMemoryPhoto,
    handleMemoryRecord,
  }
}

export type UseMemoryFlowReturn = ReturnType<typeof useMemoryFlow>