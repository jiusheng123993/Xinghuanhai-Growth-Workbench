/**
 * 家庭看板页面
 * 宠物家庭聚合看板、健康总览
 */
import { useEffect, useState, useMemo, useCallback, useRef } from 'react'
import { View, Text, Canvas, Textarea, Image } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { useFamilyStore } from '../../../stores/familyStore'
import { usePetStore } from '../../../stores/petStore'
import { useAuthStore } from '../../../stores/authStore'
import { getCheckinStats , getTodayCheckin } from '../../../services/checkinService'

import { useThemeClass } from '../../../hooks/useThemeClass'
import {
  buildFamilyPhotoData,
  renderFamilyPhoto,
  saveFamilyPhoto,
  shareFamilyPhoto,
  FAMILY_PHOTO_STYLE_LABELS,
  FAMILY_PHOTO_STYLES,
  FAMILY_PHOTO_SCENE_LABELS,
  FAMILY_PHOTO_SCENE_GROUPS,
  DEFAULT_FAMILY_PHOTO_SCENE,
} from '../../../services/familyPhotoService'
import type { FamilyPhotoStyle, FamilyPhotoScene } from '../../../services/familyPhotoService'
import type { PetProfile } from '../../../services/petService'
import type { PetFamilyMember, FamilyPhoto } from '../../../types/familyTypes'
import FamilyPetAvatar from '../../../pages/family/FamilyPetAvatar'
import './index.scss'

const ROLE_ICONS: Record<string, string> = {
  '老大': '👑',
  '团宠': '💖',
  '活力之星': '⚡',
  '守护者': '🛡️',
  '乖宝宝': '🌟',
  '新成员': '🌱',
}

const ROLE_LIST = ['老大', '团宠', '活力之星', '守护者', '新成员', '乖宝宝']

function getTodayStr(): string {
  return new Date().toISOString().slice(0, 10)
}

export default function FamilyDashboard() {
  const { currentFamily, members, photos, photosLoading, fetchFamilies, createFamily, removeMember, updateMemberRole, fetchPhotos, savePhoto, deletePhoto, generateAiPhoto } = useFamilyStore()
  const { pets, fetchPets, switchPet } = usePetStore()
  const user = useAuthStore(s => s.user)
  const [creating, setCreating] = useState(false)
  const [todayStatus, setTodayStatus] = useState<Record<string, { checked: boolean; mood?: string }>>({})
  const [photoUrl, setPhotoUrl] = useState('')
  const [photoGenerating, setPhotoGenerating] = useState(false)
  const [showPhotoPreview, setShowPhotoPreview] = useState(false)
  const [canvasVisible, setCanvasVisible] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [albumHighlight, setAlbumHighlight] = useState(false)
  const [selectedStyle, setSelectedStyle] = useState<FamilyPhotoStyle>('pixar')
  // 场景选择：预设场景 key 或 'custom'（自定义描述）；默认温馨客厅
  const [selectedScene, setSelectedScene] = useState<FamilyPhotoScene | 'custom'>(DEFAULT_FAMILY_PHOTO_SCENE)
  // 当前展开的主题分组（五大主题宫格，避免 22 个场景一屏铺满）
  const [activeSceneGroup, setActiveSceneGroup] = useState(0)
  // 自定义场景描述（仅 selectedScene === 'custom' 时使用）
  const [customSceneText, setCustomSceneText] = useState('')
  const [aiGenerating, setAiGenerating] = useState(false)
  const [aiProgressText, setAiProgressText] = useState('')
  const themeClass = useThemeClass()

  useEffect(() => {
    fetchFamilies()
  }, [])

  useEffect(() => {
    if (currentFamily) {
      fetchPhotos()
    }
  }, [currentFamily])

  useEffect(() => {
    if (user) {
      fetchPets(user.id)
    }
  }, [user])

  useEffect(() => {
    if (currentFamily && members.length > 0 && user) {
      const loadToday = async () => {
        const today = getTodayStr()
        const status: Record<string, { checked: boolean; mood?: string }> = {}
        for (const member of members) {
          if (!member.petId) continue
          try {
            const checkin = await getTodayCheckin(member.petId, user.id)
            status[member.petId] = {
              checked: !!checkin,
              mood: checkin?.spiritLevel ? (checkin.spiritLevel >= 4 ? 'happy' : checkin.spiritLevel >= 2 ? 'normal' : 'sad') : undefined,
            }
          } catch {
            status[member.petId] = { checked: false }
          }
        }
        setTodayStatus(status)
      }
      loadToday()
    }
  }, [currentFamily, members, user])

  const familyPets = useMemo(() => {
    const petMap = new Map(pets.map((p: PetProfile) => [p.id, p]))
    return members
      .map((member: PetFamilyMember) => ({
        member,
        pet: petMap.get(member.petId),
      }))
      .filter((item: { member: PetFamilyMember; pet: PetProfile | undefined }) => item.pet)
  }, [members, pets])

  // ===== 成员排位：用户用名字沟通座次（"烧鸡在左边"），系统翻译成画面从左到右的顺序 =====
  // memberOrder = petId 有序数组，随 familyPets 变化重置为默认顺序；生成时透传后端写"从左到右依次是…"
  const [memberOrder, setMemberOrder] = useState<string[]>([])
  useEffect(() => {
    setMemberOrder(familyPets.map((fp: { member: PetFamilyMember }) => fp.member.petId))
  }, [familyPets])
  /** 排位交换：dir=-1 左移一位 / +1 右移一位（名字只在 UI 显示，不进提示词） */
  const moveMember = useCallback((petId: string, dir: -1 | 1) => {
    setMemberOrder((prev) => {
      const next = [...prev]
      const i = next.indexOf(petId)
      const j = i + dir
      if (i < 0 || j < 0 || j >= next.length) return prev
      ;[next[i], next[j]] = [next[j], next[i]]
      return next
    })
  }, [])

  const unassignedPets = useMemo(() => {
    const assignedIds = new Set(members.map((m: PetFamilyMember) => m.petId))
    return pets.filter((p: PetProfile) => !assignedIds.has(p.id))
  }, [pets, members])

  const photoGroups = useMemo(() => {
    const groups: { label: string; photos: FamilyPhoto[] }[] = []
    const sorted = [...photos].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    for (const photo of sorted) {
      const date = new Date(photo.createdAt)
      const label = `${date.getFullYear()}年${date.getMonth() + 1}月`
      let last = groups[groups.length - 1]
      if (!last || last.label !== label) {
        last = { label, photos: [] }
        groups.push(last)
      }
      last.photos.push(photo)
    }
    return groups
  }, [photos])

  const handleCreateFamily = async () => {
    if (creating) return
    setCreating(true)
    try {
      await createFamily('星澜小筑')
      Taro.showToast({ title: '家庭创建成功', icon: 'success' })
    } catch (err: unknown) {
      const error = err as { message?: string }
      Taro.showToast({ title: error.message || '创建失败', icon: 'none' })
    } finally {
      setCreating(false)
    }
  }

  const handleAddMember = async (pet: PetProfile) => {
    if (!currentFamily) return
    try {
      await useFamilyStore.getState().addMember(pet.id)
      Taro.showToast({ title: `已邀请${pet.name}加入家庭`, icon: 'success' })
    } catch (err: unknown) {
      const error = err as { message?: string }
      Taro.showToast({ title: error.message || '添加失败', icon: 'none' })
      // 409 冲突时刷新成员列表，确保 UI 状态与后端一致
      if (error.message === '该宠物已在家庭中') {
        await fetchFamilies()
      }
    }
  }

  const handleRemoveMember = (memberId: string, petName: string) => {
    if (!currentFamily) return
    Taro.showModal({
      title: '移出家庭',
      content: `确认将${petName}移出家庭吗？宠物数据会被保留。`,
      confirmText: '确认移出',
      confirmColor: '#E0856B',
      cancelText: '取消',
      success: async (res) => {
        if (res.confirm) {
          try {
            await removeMember(memberId)
            Taro.showToast({ title: `${petName}已移出家庭`, icon: 'success' })
          } catch {
            Taro.showToast({ title: '操作失败', icon: 'none' })
          }
        }
      },
    })
  }

  const handleAssignRole = (memberId: string, petName: string) => {
    Taro.showActionSheet({
      itemList: ROLE_LIST,
      success: async (res) => {
        const chosen = ROLE_LIST[res.tapIndex]
        try {
          await updateMemberRole(memberId, chosen)
          Taro.showToast({ title: `${petName}已成为${chosen}`, icon: 'success' })
        } catch {
          Taro.showToast({ title: '设置失败', icon: 'none' })
        }
      },
    })
  }

  /**
   * 带场景参数的生成函数最新引用。
   * 为什么需要它（审查 P1 修复）：handleGeneratePhoto 弹出的 ActionSheet 是异步系统弹窗，
   * 其 success 回调触发时机晚于本次渲染；若直接在 deps 里引 handleGenerateWithStyle 会形成
   * 先声明后引用的 TDZ 问题，而漏加依赖又会让回调捕获旧渲染的 selectedScene/customSceneText——
   * 表现为"用户刚改选了海边日落，首次点击生成却仍用上一次的场景"。用 ref 中转，
   * 每次渲染把最新函数写入 ref，弹窗回调经 ref 调用，永远拿到最新闭包。
   */
  const generateWithStyleRef = useRef<((style: FamilyPhotoStyle) => Promise<void>) | null>(null)

  const handleGeneratePhoto = useCallback(async () => {
    if (photoGenerating || aiGenerating || !currentFamily || familyPets.length === 0) return

    // 步骤1：弹出风格选择器
    Taro.showActionSheet({
      itemList: FAMILY_PHOTO_STYLES.map(s => `${FAMILY_PHOTO_STYLE_LABELS[s].emoji} ${FAMILY_PHOTO_STYLE_LABELS[s].label}`),
      success: (res) => {
        const chosen = FAMILY_PHOTO_STYLES[res.tapIndex]
        setSelectedStyle(chosen)
        // 经 ref 调用最新闭包（见 generateWithStyleRef 注释），确保带上用户刚选的场景
        void generateWithStyleRef.current?.(chosen)
      },
    })
  }, [photoGenerating, aiGenerating, currentFamily, familyPets])

  const handleGenerateWithStyle = useCallback(async (style: FamilyPhotoStyle) => {
    if (!currentFamily) return

    // 自定义场景必须先写描述（空描述会被后端 schema 拒收，提前拦截给明确提示）
    if (selectedScene === 'custom' && !customSceneText.trim()) {
      Taro.showToast({ title: '请先描述你想要的场景', icon: 'none' })
      return
    }

    // 步骤2：尝试 AI 生成（预设场景传 scene key；自定义传描述文本，后端清洗截断后拼进提示词）
    setAiGenerating(true)
    setPhotoGenerating(true)
    setShowPhotoPreview(false)
    setAiProgressText('正在分析家庭成员...')

    const progressTimer = setInterval(() => {
      setAiProgressText((prev) => {
        const texts = [
          '正在分析家庭成员...',
          '正在构建家庭合影...',
          'AI 正在绘制全家福...',
          '正在润色细节...',
          '即将完成...',
        ]
        const idx = texts.indexOf(prev)
        return idx >= 0 && idx < texts.length - 1 ? texts[idx + 1] : texts[0]
      })
    }, 2000)

    try {
      const result = await generateAiPhoto(
        style,
        selectedScene === 'custom' ? undefined : selectedScene,
        selectedScene === 'custom' ? customSceneText.trim() : undefined,
        // 成员排位：按用户排的左右座次生成（后端翻译成"从左到右依次是"的外貌列表）
        memberOrder.length > 1 ? memberOrder : undefined,
      )
      clearInterval(progressTimer)

      if (result.success && result.photoUrl) {
        setPhotoUrl(result.photoUrl)
        setShowPhotoPreview(true)
        setAiGenerating(false)
        setPhotoGenerating(false)
        setCanvasVisible(false)
        return
      }

      // 分级引导：成员只有"默认头像/无真实形象"时，AI 全家福不能按真实样子生成——
      // 引导用户先去上传照片/生成专属形象，不降级 Canvas（手绘占位不是真实全家福）
      // 注：progressTimer 已在 await generateAiPhoto 后统一清理，这里无需重复 clear
      if (result.code === 'MEMBER_NO_REAL_IMAGE') {
        setAiGenerating(false)
        setPhotoGenerating(false)
        setAiProgressText('')
        const names = (result.missingMembers || []).map((m) => m.name).join('、')
        Taro.showModal({
          title: '先为毛孩子生成真实形象',
          content: `「${names}」还没有真实形象。上传照片或生成专属形象后，全家福才能用它的真实样子。现在去生成？`,
          // 坑点：微信 showModal 按钮文案上限 4 字，超长弹窗直接 fail 不渲染（「去生成」原为「去生成形象」5 字）
          confirmText: '去生成',
          cancelText: '稍后再说',
          success: (r) => {
            if (!r.confirm) return
            // 切到第一只缺形象的宠物，形象定制页默认用它（无需用户手动切换）
            // switchPet 是网络调用，失败静默（页面仍可手动切宠物），不让未处理拒绝冒泡
            const firstMissing = result.missingMembers?.[0]
            if (firstMissing) {
              const targetPet = familyPets.find((fp) => fp.member.petId === firstMissing.petId)?.pet
              if (targetPet) {
                void switchPet(targetPet.id).catch(() => {})
              }
            }
            Taro.navigateTo({ url: '/pagesPet/avatar-customize/index' })
          },
        })
        return
      }

      // AI 失败，提示用户并降级到 Canvas
      Taro.showToast({ title: result.message || 'AI 生成失败，切换为手绘风格', icon: 'none', duration: 2000 })
    } catch {
      clearInterval(progressTimer)
      Taro.showToast({ title: 'AI 服务暂不可用，切换为手绘风格', icon: 'none', duration: 2000 })
    }

    // 步骤3：降级到 Canvas 本地绘制
    setAiGenerating(false)
    setCanvasVisible(true)
    setAiProgressText('')

    await new Promise(resolve => setTimeout(resolve, 300))

    try {
      const roleMap: Record<string, string> = {}
      members.forEach((m: PetFamilyMember) => { roleMap[m.petId] = m.role || '' })

      const photoPets = familyPets
        .map((fp: { member: PetFamilyMember; pet: PetProfile | undefined }) => fp.pet)
        .filter((p): p is PetProfile => !!p)

      const photoData = buildFamilyPhotoData(currentFamily.name, photoPets, roleMap)
      const result = await renderFamilyPhoto(photoData, { canvasId: 'family-photo-canvas', pixelRatio: 2 })
      setPhotoUrl(result.tempFilePath)
      setShowPhotoPreview(true)
    } catch (err: unknown) {
      const error = err as { message?: string }
      Taro.showToast({ title: error.message || '生成失败，请重试', icon: 'none' })
    } finally {
      setPhotoGenerating(false)
      setCanvasVisible(false)
    }
  }, [currentFamily, familyPets, members, generateAiPhoto, switchPet, selectedScene, customSceneText, memberOrder])

  // 每次渲染把最新版生成函数写入 ref，供 handleGeneratePhoto 的弹窗回调使用（见上方注释）
  generateWithStyleRef.current = handleGenerateWithStyle

  const handleSavePhoto = useCallback(async () => {
    if (!photoUrl) return
    try {
      await saveFamilyPhoto(photoUrl)
      const memberNames = familyPets
        .map((fp: { member: PetFamilyMember; pet: PetProfile | undefined }) => fp.pet?.name)
        .filter((n): n is string => !!n)
      await savePhoto(photoUrl, familyPets.length, memberNames)
      setAlbumHighlight(true)
      setTimeout(() => setAlbumHighlight(false), 2000)
      Taro.showToast({ title: '已保存到相册', icon: 'success' })
    } catch (err: unknown) {
      const error = err as { message?: string }
      Taro.showToast({ title: error.message || '保存失败', icon: 'none' })
    }
  }, [photoUrl, familyPets, savePhoto])

  const handleSharePhoto = useCallback(async () => {
    if (!photoUrl) return
    await shareFamilyPhoto(photoUrl)
  }, [photoUrl])

  const handleUploadPhoto = useCallback(async () => {
    if (!currentFamily || uploading) return
    setUploading(true)
    try {
      const res = await Taro.chooseMedia({
        count: 1,
        mediaType: ['image'],
        sourceType: ['album', 'camera'],
        sizeType: ['compressed'],
      })
      const tempFilePath = res.tempFiles[0].tempFilePath
      const memberNames = familyPets
        .map((fp: { member: PetFamilyMember; pet: PetProfile | undefined }) => fp.pet?.name)
        .filter((n): n is string => !!n)
      await savePhoto(tempFilePath, memberNames.length, memberNames, 'uploaded')
      Taro.showToast({ title: '已上传到家庭相册', icon: 'success' })
    } catch (err: unknown) {
      const error = err as { message?: string }
      if (error.message && !error.message.includes('cancel')) {
        Taro.showToast({ title: error.message || '上传失败', icon: 'none' })
      }
    } finally {
      setUploading(false)
    }
  }, [currentFamily, uploading, familyPets, savePhoto])

  if (!currentFamily) {
    return (
      <View className={`family-dashboard ${themeClass}`}>
        <View className='fd-empty'>
          <Text className='fd-empty-icon'>🏡</Text>
          <Text className='fd-empty-text'>还没有创建家庭</Text>
          <View
            className='fd-empty-btn'
            style={{ opacity: creating ? 0.6 : 1 }}
            onClick={handleCreateFamily}
          >
            <Text>{creating ? '创建中...' : '创建家庭'}</Text>
          </View>
        </View>
      </View>
    )
  }

  const checkedCount = Object.values(todayStatus).filter(s => s.checked).length
  const totalMembers = members.length

  return (
    <View className={`family-dashboard ${themeClass}`}>
      <View className='fd-section'>
        <Text className='fd-title'>{currentFamily.name}</Text>
        <Text className='fd-subtitle'>{totalMembers}位家人</Text>
      </View>

      <View className='fd-section'>
        <View className='fd-health-board'>
          <View className='fd-health-board-header'>
            <Text className='fd-health-board-icon'>🏥</Text>
            <Text className='fd-health-board-title'>今日健康看板</Text>
            <Text className='fd-health-board-date'>{getTodayStr()}</Text>
          </View>
          <View className='fd-health-summary'>
            <View className='fd-health-stat'>
              <Text className='fd-health-stat-num'>{checkedCount}</Text>
              <Text className='fd-health-stat-label'>已打卡</Text>
            </View>
            <View className='fd-health-divider' />
            <View className='fd-health-stat'>
              <Text className='fd-health-stat-num'>{totalMembers - checkedCount}</Text>
              <Text className='fd-health-stat-label'>未打卡</Text>
            </View>
            <View className='fd-health-divider' />
            <View className='fd-health-stat'>
              <Text className='fd-health-stat-num'>{Math.round((checkedCount / Math.max(totalMembers, 1)) * 100)}%</Text>
              <Text className='fd-health-stat-label'>打卡率</Text>
            </View>
          </View>
          {familyPets.length > 0 && (
            <View className='fd-health-members'>
              {familyPets.map(({ member, pet }: { member: PetFamilyMember; pet: PetProfile | undefined }) => {
                if (!pet) return null
                const status = todayStatus[member.petId]
                const isChecked = status?.checked
                const roleIcon = member.role ? ROLE_ICONS[member.role] || '' : ''
                return (
                  <View key={member.petId} className={`fd-health-member ${isChecked ? 'fd-health-member--checked' : ''}`}>
                    <View className={`fd-health-member-avatar ${isChecked ? 'fd-health-member-avatar--checked' : ''}`}>
                      <FamilyPetAvatar
                        pet={pet}
                        imgClass='fd-health-member-avatar-img'
                        emojiClass='fd-health-member-avatar-emoji'
                      />
                    </View>
                    <Text className='fd-health-member-name'>{pet.name}</Text>
                    {isChecked ? (
                      <View className='fd-health-checked-badge'>
                        <Text className='fd-health-checked-text'>✅ 已打卡</Text>
                      </View>
                    ) : (
                      <View className='fd-health-pending-badge'>
                        <Text className='fd-health-pending-text'>⏳ 待打卡</Text>
                      </View>
                    )}
                    {roleIcon && (
                      <Text className='fd-health-member-role'>{roleIcon} {member.role}</Text>
                    )}
                  </View>
                )
              })}
            </View>
          )}
        </View>
      </View>

      <View className='fd-section'>
        <View className='fd-photo-section'>
          <View className='fd-photo-header'>
            <View className='fd-photo-header-left'>
              <Text className='fd-photo-header-icon'>📸</Text>
              <Text className='fd-photo-header-title'>全家福</Text>
            </View>
          </View>
          {familyPets.length === 0 ? (
            <View className='fd-photo-empty'>
              <Text className='fd-photo-empty-icon'>📷</Text>
              <Text className='fd-photo-empty-text'>邀请毛孩子加入家庭，<br />记录温暖的全家福</Text>
            </View>
          ) : showPhotoPreview && photoUrl ? (
            <View className='fd-photo-preview'>
              <View className='fd-photo-preview-img-wrap' onClick={() => Taro.previewImage({ urls: [photoUrl], current: photoUrl })}>
                <View className='fd-photo-preview-img' style={{ backgroundImage: `url(${photoUrl})` }} />
                <View className='fd-photo-preview-tap'>
                  <Text>点击查看大图</Text>
                </View>
              </View>
              <View className='fd-photo-preview-actions'>
                <View className='fd-photo-btn fd-photo-btn--outline' onClick={handleSavePhoto}>
                  <Text className='fd-photo-btn-text'>💾 保存到相册</Text>
                </View>
                <View className='fd-photo-btn fd-photo-btn--primary' onClick={handleSharePhoto}>
                  <Text className='fd-photo-btn-text'>📤 分享给家人</Text>
                </View>
              </View>
              <View className='fd-photo-regenerate' onClick={handleGeneratePhoto}>
                <Text className='fd-photo-regenerate-text'>🔄 重新生成</Text>
              </View>
            </View>
          ) : aiGenerating ? (
            <View className='fd-photo-generating'>
              <View className='fd-photo-generating-spinner' />
              <Text className='fd-photo-generating-text'>{aiProgressText}</Text>
              <Text className='fd-photo-generating-style'>
                场景：{selectedScene === 'custom'
                  ? `✏️ ${customSceneText.trim().slice(0, 8) || '自定义'}`
                  : `${FAMILY_PHOTO_SCENE_LABELS[selectedScene].emoji} ${FAMILY_PHOTO_SCENE_LABELS[selectedScene].label}`}
                {' · '}风格：{FAMILY_PHOTO_STYLE_LABELS[selectedStyle].emoji} {FAMILY_PHOTO_STYLE_LABELS[selectedStyle].label}
              </Text>
              <Text className='fd-photo-generating-hint'>AI 正在为您生成全家福，请耐心等待...</Text>
            </View>
          ) : (
            <View className='fd-photo-generate'>
              <View className='fd-photo-generate-preview'>
                <View className='fd-photo-generate-frame'>
                  {familyPets.slice(0, 6).map(({ pet }: { member: PetFamilyMember; pet: PetProfile | undefined }, idx: number) => {
                    if (!pet) return null
                    const angle = (idx / Math.min(familyPets.length, 6)) * 360
                    const radius = 60
                    const x = 50 + Math.cos((angle - 90) * Math.PI / 180) * radius
                    const y = 50 + Math.sin((angle - 90) * Math.PI / 180) * radius
                    return (
                      <View
                        key={pet.id}
                        className='fd-photo-generate-avatar'
                        style={{ left: `${x}%`, top: `${y}%` }}
                      >
                        <FamilyPetAvatar
                          pet={pet}
                          imgClass='fd-photo-generate-avatar-img'
                          emojiClass='fd-photo-generate-avatar-emoji'
                        />
                      </View>
                    )
                  })}
                  <View className='fd-photo-generate-center'>
                    <Text>🏡</Text>
                  </View>
                </View>
              </View>
              <View className='fd-photo-generate-info'>
                <Text className='fd-photo-generate-label'>
                  {familyPets.length}位毛孩子
                </Text>
                <Text className='fd-photo-generate-desc'>
                  选好场景和画风，AI 为您合成一张精美的全家福
                </Text>
              </View>
              {/* ===== 成员排位：排在前面的=画面里靠左边（名字只在这里显示，不进 AI 提示词） ===== */}
              {familyPets.length > 1 && (
                <View className='fd-order'>
                  <Text className='fd-order__title'>🪑 排个座次</Text>
                  <Text className='fd-order__hint'>排在前面 = 合影里靠左边；名字不会发给 AI，AI 认毛色</Text>
                  <View className='fd-order__row'>
                    {memberOrder.map((petId, idx) => {
                      const fp = familyPets.find((f: { member: PetFamilyMember }) => f.member.petId === petId)
                      if (!fp?.pet) return null
                      return (
                        <View key={petId} className='fd-order__item'>
                          <Text className='fd-order__pos'>{idx + 1}</Text>
                          <Image className='fd-order__avatar' src={fp.pet.avatarPhotoUrl || fp.pet.avatarCartoonUrl || ''} mode='aspectFill' lazyLoad />
                          <Text className='fd-order__name'>{fp.pet.name}</Text>
                          <View className='fd-order__btns'>
                            <View
                              className={`fd-order__btn ${idx === 0 ? 'fd-order__btn--disabled' : ''}`}
                              onClick={() => moveMember(petId, -1)}
                            >
                              <Text className='fd-order__btn-text'>‹</Text>
                            </View>
                            <View
                              className={`fd-order__btn ${idx === memberOrder.length - 1 ? 'fd-order__btn--disabled' : ''}`}
                              onClick={() => moveMember(petId, 1)}
                            >
                              <Text className='fd-order__btn-text'>›</Text>
                            </View>
                          </View>
                        </View>
                      )
                    })}
                  </View>
                </View>
              )}
              {/* ===== 场景选择：五大主题分组宫格 + 自定义场景输入 ===== */}
              <View className='fd-scene-picker'>
                <View className='fd-scene-tabs'>
                  {FAMILY_PHOTO_SCENE_GROUPS.map((group, idx) => (
                    <View
                      key={group.key}
                      className={`fd-scene-tab ${idx === activeSceneGroup ? 'fd-scene-tab--active' : ''}`}
                      onClick={() => setActiveSceneGroup(idx)}
                    >
                      <Text className='fd-scene-tab-text'>{group.emoji} {group.label}</Text>
                    </View>
                  ))}
                </View>
                <View className='fd-scene-grid'>
                  {FAMILY_PHOTO_SCENE_GROUPS[activeSceneGroup].scenes.map((sceneKey) => {
                    const meta = FAMILY_PHOTO_SCENE_LABELS[sceneKey]
                    return (
                      <View
                        key={sceneKey}
                        className={`fd-scene-chip ${selectedScene === sceneKey ? 'fd-scene-chip--active' : ''}`}
                        onClick={() => setSelectedScene(sceneKey)}
                      >
                        <Text className='fd-scene-chip-emoji'>{meta.emoji}</Text>
                        <Text className='fd-scene-chip-label'>{meta.label}</Text>
                      </View>
                    )
                  })}
                  {/* 自定义场景入口：选中后展开描述输入框 */}
                  <View
                    className={`fd-scene-chip fd-scene-chip--custom ${selectedScene === 'custom' ? 'fd-scene-chip--active' : ''}`}
                    onClick={() => setSelectedScene('custom')}
                  >
                    <Text className='fd-scene-chip-emoji'>✏️</Text>
                    <Text className='fd-scene-chip-label'>自定义</Text>
                  </View>
                </View>
                {selectedScene === 'custom' && (
                  <Textarea
                    className='fd-scene-custom-input'
                    value={customSceneText}
                    maxlength={60}
                    placeholder='用一句话描述你想要的场景，如：在我家的院子里晒太阳'
                    onInput={(e) => setCustomSceneText(e.detail.value)}
                  />
                )}
              </View>
              <View
                className={`fd-photo-generate-btn ${photoGenerating ? 'fd-photo-generate-btn--loading' : ''}`}
                onClick={handleGeneratePhoto}
              >
                <Text className='fd-photo-generate-btn-text'>
                  {photoGenerating ? '⏳ 生成中...' : '✨ 生成全家福'}
                </Text>
              </View>
            </View>
          )}
          <Canvas
            className='fd-photo-canvas'
            canvasId='family-photo-canvas'
            id='family-photo-canvas'
            style={{ display: canvasVisible ? 'block' : 'none', position: 'fixed', left: '-9999px', top: '-9999px', width: '750px', height: '1000px' }}
            type='2d'
          />
        </View>
      </View>

      <View className='fd-section'>
        <View className='fd-section-header'>
          <Text className='fd-section-title'>👥 家庭成员</Text>
          <Text className='fd-section-count'>{totalMembers}位</Text>
        </View>
        <View className='fd-members-grid'>
          {familyPets.map(({ member, pet }: { member: PetFamilyMember; pet: PetProfile | undefined }, idx: number) => {
            if (!pet) return null
            const roleIcon = member.role ? ROLE_ICONS[member.role] || '' : ''
            return (
              <View key={member.petId} className='fd-member-card'>
                <View className='fd-member-top'>
                  <View className='fd-member-avatar-wrap'>
                    <FamilyPetAvatar
                      pet={pet}
                      imgClass='fd-member-avatar-img'
                      emojiClass='fd-member-avatar-emoji'
                    />
                  </View>
                  <View
                    className='fd-member-role-btn'
                    onClick={() => handleAssignRole(member.id, pet.name)}
                  >
                    <Text className='fd-member-role-btn-text'>角色</Text>
                  </View>
                </View>
                <Text className='fd-member-name'>{pet.name}</Text>
                <Text className='fd-member-role'>
                  {roleIcon ? `${roleIcon} ${member.role || '乖宝宝'}` : member.role || '乖宝宝'}
                </Text>
                <Text className='fd-member-breed'>{pet.breed || '未知品种'}</Text>
                <View
                  className='fd-member-remove'
                  onClick={() => handleRemoveMember(member.id, pet.name)}
                >
                  <Text className='fd-member-remove-text'>移出家庭</Text>
                </View>
              </View>
            )
          })}
        </View>
      </View>

      {unassignedPets.length > 0 && (
        <View className='fd-section'>
          <View className='fd-section-header'>
            <Text className='fd-section-title'>📋 可邀请的毛孩子</Text>
            <Text className='fd-section-count'>{unassignedPets.length}位</Text>
          </View>
          <View className='fd-invite-list'>
            {unassignedPets.map(pet => (
              <View key={pet.id} className='fd-invite-item'>
                <View className='fd-invite-avatar'>
                  <FamilyPetAvatar
                    pet={pet}
                    imgClass='fd-invite-avatar-img'
                    emojiClass='fd-invite-avatar-emoji'
                  />
                </View>
                <View className='fd-invite-info'>
                  <Text className='fd-invite-name'>{pet.name}</Text>
                  <Text className='fd-invite-breed'>{pet.breed || '未知品种'}</Text>
                </View>
                <View className='fd-invite-btn' onClick={() => handleAddMember(pet)}>
                  <Text className='fd-invite-btn-text'>+ 邀请</Text>
                </View>
              </View>
            ))}
          </View>
        </View>
      )}

      <View className='fd-section'>
        <View className='fd-actions'>
          <View className='fd-action-card' onClick={() => Taro.navigateTo({ url: '/pagesPet/family/lineage/index' })}>
            <Text className='fd-action-icon'>🧬</Text>
            <Text className='fd-action-label'>家族图谱</Text>
          </View>
          <View className='fd-action-card' onClick={() => Taro.navigateTo({ url: '/pagesPet/family/calendar/index' })}>
            <Text className='fd-action-icon'>📅</Text>
            <Text className='fd-action-label'>家庭日历</Text>
          </View>
        </View>
      </View>

      <View className='fd-section'>
        <View className='fd-section-header'>
          <View className='fd-section-header-left'>
            <Text className='fd-section-title'>📸 全家福相册</Text>
            <Text className='fd-section-count'>{photos.length}张</Text>
            {albumHighlight && <Text className='fd-album-new-dot'>NEW</Text>}
          </View>
          <View className='fd-upload-btn' onClick={handleUploadPhoto}>
            <Text className='fd-upload-btn-text'>{uploading ? '⏳' : '📤'} 上传照片</Text>
          </View>
        </View>
        {photosLoading ? (
          <View className='fd-album-loading'>
            <View className='fd-album-loading-spinner' />
            <Text className='fd-album-loading-text'>加载相册中...</Text>
          </View>
        ) : photos.length === 0 ? (
          <View className='fd-album-empty'>
            <View className='fd-album-empty-illustration'>
              <Text className='fd-album-empty-illustration-icon'>📸</Text>
              <View className='fd-album-empty-illustration-dots'>
                <View className='fd-album-empty-dot' />
                <View className='fd-album-empty-dot' />
                <View className='fd-album-empty-dot' />
              </View>
            </View>
            <Text className='fd-album-empty-title'>珍藏每一刻</Text>
            <Text className='fd-album-empty-text'>生成全家福后点击&quot;保存到相册&quot;<br />或点击上方&quot;上传照片&quot;分享精彩瞬间</Text>
          </View>
        ) : (
          <View className={`fd-album-list ${albumHighlight ? 'fd-album-list--highlight' : ''}`}>
            {photoGroups.map((group) => (
              <View key={group.label} className='fd-album-group'>
                <View className='fd-album-group-header'>
                  <Text className='fd-album-group-label'>{group.label}</Text>
                  <Text className='fd-album-group-count'>{group.photos.length}张</Text>
                </View>
                <View className='fd-album-group-grid'>
                  {group.photos.map((photo: FamilyPhoto) => (
                    <View key={photo.id} className={`fd-album-item ${photo.photoType === 'uploaded' ? 'fd-album-item--uploaded' : ''}`}>
                      <View
                        className='fd-album-item-img'
                        onClick={() => photo.photoUrl ? Taro.previewImage({ urls: [photo.photoUrl], current: photo.photoUrl }) : undefined}
                      >
                        <View className='fd-album-item-placeholder'>
                          <Text className='fd-album-item-emoji'>{photo.photoType === 'uploaded' ? '🖼️' : '🏡'}</Text>
                          {photo.photoType === 'uploaded' && (
                            <View className='fd-album-item-badge'>
                              <Text className='fd-album-item-badge-text'>用户上传</Text>
                            </View>
                          )}
                        </View>
                        <View className='fd-album-item-overlay'>
                          <Text className='fd-album-item-overlay-text'>点击查看</Text>
                        </View>
                      </View>
                      <View className='fd-album-item-body'>
                        <View className='fd-album-item-header'>
                          <Text className='fd-album-item-date'>{photo.createdAt.slice(0, 10)}</Text>
                          <View className='fd-album-item-meta'>
                            {/* AI 生成的照片带场景标签（上传/手绘照片无 scene 字段不显示） */}
                            {(photo.photoType === 'ai_generated' || photo.photoType === 'generated') && photo.scene && FAMILY_PHOTO_SCENE_LABELS[photo.scene as FamilyPhotoScene] && (
                              <Text className='fd-album-item-scene'>
                                {FAMILY_PHOTO_SCENE_LABELS[photo.scene as FamilyPhotoScene].emoji}
                                {FAMILY_PHOTO_SCENE_LABELS[photo.scene as FamilyPhotoScene].label}
                              </Text>
                            )}
                            <Text className='fd-album-item-count'>{photo.memberCount}位成员</Text>
                          </View>
                        </View>
                        {photo.description && (
                          <Text className='fd-album-item-desc'>{photo.description}</Text>
                        )}
                        <View className='fd-album-item-actions'>
                          <View className='fd-album-item-del' onClick={() => {
                            Taro.showModal({
                              title: '删除照片',
                              content: '确认删除这张全家福记录吗？',
                              confirmColor: '#E0856B',
                              success: (res) => { if (res.confirm) deletePhoto(photo.id) },
                            })
                          }}
                          >
                            <Text className='fd-album-item-del-text'>删除</Text>
                          </View>
                        </View>
                      </View>
                    </View>
                  ))}
                </View>
              </View>
            ))}
          </View>
        )}
      </View>

      <View className='fd-bottom-safe' />
    </View>
  )
}
