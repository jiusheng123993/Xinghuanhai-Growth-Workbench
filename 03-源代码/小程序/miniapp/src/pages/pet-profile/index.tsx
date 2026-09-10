/**
 * 宠物档案页面
 * 对齐高保真原型 pet-profile.html：宠物形象卡 + 健康指标 2x2 + 档案详情 + 品种特征 + 编辑按钮
 * 保留原有业务逻辑：登录校验、多宠物切换、喜好习惯、健康管理入口、标记离世
 */
import { View, Text, ScrollView } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { useEffect, useMemo, useState } from 'react'
import { useAuthStore } from '../../stores/authStore'
import { usePetStore } from '../../stores/petStore'
import { useFamilyStore } from '../../stores/familyStore'
import PageLoading from '../../components/PageLoading'
import PetAvatar from '../../components/PetAvatar'
import { useThemeClass } from '../../hooks/useThemeClass'
import { redirectToLoginIfNeeded } from '../../utils/authGuard'
import { getPetFacts, type PetFact } from '../../services/petService'
import { getCheckinStats, getCheckinsByDateRange, getLatestCheckin, calcHealthScore } from '../../services/checkinService'
import { getVaccineRecords } from '../../services/vaccineService'
// 主包体积优化：pet-profile 是主包 tab 页，只用品种的 3 项特征（遗传病/体重/饮食禁忌），
// 引用精简版 breedsLight（45KB）而非全量 breeds（148KB），避免拖爆主包体积
import { BREED_LIGHT } from '../../data/petKnowledge/breedsLight'
import type { ExpressionContext } from '../../types/avatarTypes'
import './index.scss'

const defaultExpressionContext: ExpressionContext = {
  todayEntry: null,
  hasAnomaly: false,
  anomalyCount: 0,
  riskLevel: null,
  streakDays: 0,
  isBirthday: false,
  isVaccineComplete: false,
  isRecovery: false,
  isDeceased: false,
}

const FACT_ICONS: Record<string, string> = {
  like: '❤️',
  dislike: '💔',
  habit: '🔄',
  personality: '🌟',
  general: '📝',
}

/** 格式化出生日期 → YYYY-MM-DD */
function formatDate(value: string): string {
  if (!value) return '未设置'
  const d = new Date(value)
  // Number.isNaN 替代全局 isNaN（eslint no-restricted-globals 要求，避免隐式类型转换误判）
  if (Number.isNaN(d.getTime())) return value.slice(0, 10)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** 计算年龄（岁/月） */
function calcAge(birthDate: string): string {
  if (!birthDate) return ''
  const birth = new Date(birthDate)
  const now = new Date()
  const months = (now.getFullYear() - birth.getFullYear()) * 12 + (now.getMonth() - birth.getMonth())
  if (months < 12) return `${months}个月`
  return `${Math.floor(months / 12)}岁${months % 12}月`
}

/** 根据最近打卡计算健康评分（0-100）——已收敛到 checkinService.calcHealthScore（正常档高分，历史 64 分 bug 修复） */

export default function PetProfile() {
  const user = useAuthStore(state => state.user)
  const isAuthenticated = useAuthStore(state => state.isAuthenticated)
  const isInitialized = useAuthStore(state => state.isInitialized)
  const { pets, currentPet, fetchPets, switchPet, markPetDeceased } = usePetStore()
  const [pageReady, setPageReady] = useState(false)
  const [facts, setFacts] = useState<PetFact[]>([])
  const themeClass = useThemeClass()

  // 健康指标真实数据
  const [healthScore, setHealthScore] = useState<number | null>(null)
  const [streakDays, setStreakDays] = useState(0)
  const [vaccineCoverage, setVaccineCoverage] = useState<number | null>(null)
  const [weekTrend, setWeekTrend] = useState('暂无')
  // 多成员共同养宠：家庭成员（人）列表（hook 必须在所有 early return 之前调用）
  const familyUsers = useFamilyStore((s) => s.users)
  // 家庭成员多于 1 人时宠物视为"家庭共养"（展示标识）
  const isCoCared = familyUsers.length > 1

  const pet = currentPet || (pets.length > 0 ? pets[0] : undefined)

  useEffect(() => {
    if (!isInitialized) return
    if (!isAuthenticated || !user) {
      // 未登录统一走收口守卫：已是登录页时不再 reLaunch（避免路由竞态报 routeDone not found）
      redirectToLoginIfNeeded()
      return
    }
    const loadData = async () => {
      try {
        await fetchPets(user.id)
        // 多成员共同养宠：若已加入家庭，加载家庭成员（人）列表用于"共同养宠"标识
        if (useFamilyStore.getState().currentFamily) {
          await useFamilyStore.getState().fetchUsers()
        }
      } catch (err) {
        // 静默处理错误，页面有错误状态展示
      }
      setPageReady(true)
    }
    loadData()
  }, [isInitialized, isAuthenticated, user])

  // 当切换宠物时，加载其特征数据
  useEffect(() => {
    if (pet && pageReady) {
      getPetFacts(pet.id).then(setFacts).catch(() => setFacts([]))
    }
  }, [pet?.id, pageReady])

  // 加载健康指标（评分 / 连续打卡 / 疫苗覆盖 / 近7天趋势）
  useEffect(() => {
    if (!pet || !user?.id) return
    let cancelled = false

    const loadMetrics = async () => {
      try {
        const stats = await getCheckinStats(pet.id, user.id)
        if (cancelled) return
        setStreakDays(stats.streak)

        const latest = await getLatestCheckin(pet.id, user.id)
        if (cancelled) return
        if (latest) {
          setHealthScore(calcHealthScore(latest.poopLevel, latest.appetiteLevel, latest.spiritLevel))
        } else {
          setHealthScore(null)
        }

        const today = new Date()
        const weekAgo = new Date(today.getTime() - 6 * 86400000)
        const fmt = (d: Date) => d.toISOString().slice(0, 10)
        const weekEntries = await getCheckinsByDateRange(pet.id, user.id, fmt(weekAgo), fmt(today))
        if (cancelled) return
        if (weekEntries.length >= 5) setWeekTrend('稳定')
        else if (weekEntries.length > 0) setWeekTrend('观察')
        else setWeekTrend('暂无')
      } catch {
        if (cancelled) return
        setHealthScore(null)
        setStreakDays(0)
        setWeekTrend('暂无')
      }
    }

    const loadVaccine = async () => {
      try {
        const records = await getVaccineRecords(pet.id)
        if (cancelled || records.length === 0) {
          if (!cancelled) setVaccineCoverage(null)
          return
        }
        const completed = records.filter(r => r.status === 'completed').length
        if (!cancelled) setVaccineCoverage(Math.round((completed / records.length) * 100))
      } catch {
        if (!cancelled) setVaccineCoverage(null)
      }
    }

    loadMetrics()
    loadVaccine()
    return () => {
      cancelled = true
    }
  }, [pet?.id, user?.id])

  const navigateTo = (url: string) => {
    Taro.navigateTo({ url })
  }

  const handleMarkDeceased = () => {
    if (!pet) return
    Taro.showModal({
      title: '标记宠物离世',
      content: `你正在将「${pet.name}」标记为已离世。\n\n宠物的所有回忆、健康记录、日记和照片将被永久保留在「时光」中，你可以随时回顾与它的点点滴滴。\n\n此操作不可撤销，是否继续？`,
      confirmText: '温柔告别',
      confirmColor: '#6B5B7B',
      cancelText: '取消',
      success: (firstRes) => {
        if (firstRes.confirm) {
          Taro.showModal({
            title: '最后的确认',
            content: `请输入「${pet.name}」以确认标记离世：`,
            editable: true as boolean,
            placeholderText: `输入「${pet.name}」确认`,
            confirmText: '确认标记',
            confirmColor: '#6B5B7B',
            cancelText: '取消',
            success: async (secondRes) => {
              if (secondRes.confirm && (secondRes as unknown as Record<string, unknown>).content === pet.name) {
                try {
                  const today = new Date().toISOString().slice(0, 10)
                  await markPetDeceased(pet.id, today)
                  Taro.showToast({ title: `${pet.name}已安息`, icon: 'none' })
                  if (user) await fetchPets(user.id)
                  setPageReady(true)
                } catch {
                  Taro.showToast({ title: '操作失败，请重试', icon: 'none' })
                }
              } else if (secondRes.confirm) {
                Taro.showToast({ title: '输入不正确，操作已取消', icon: 'none' })
              }
            },
          } as Parameters<typeof Taro.showModal>[0])
        }
      },
    })
  }

  // 根据宠物品种匹配品种特征（遗传病 / 体重范围 / 饮食禁忌）
  const breedInfo = useMemo(() => {
    if (!pet?.breed) return null
    const matched = BREED_LIGHT.find(
      b => b.name === pet.breed || b.aliases.includes(pet.breed) || pet.breed.includes(b.name)
    )
    return matched ?? null
  }, [pet?.breed])

  if (!pageReady) {
    return <PageLoading />
  }

  if (pets.length === 0) {
    return (
      <View className={`profile-page ${themeClass}`}>
        <View className='profile-empty'>
          <View className='profile-empty-icon'>🐾</View>
          <Text className='profile-empty-text'>还没有添加宠物</Text>
          <Text className='profile-empty-hint'>添加你的毛孩子，开始记录健康数据</Text>
          <View className='profile-empty-btn' onClick={() => navigateTo('/pagesPet/add/index')}>
            <Text>添加宠物</Text>
          </View>
        </View>
      </View>
    )
  }

  const activePet = pet!

  return (
    <ScrollView className={`profile-page ${themeClass}`} scrollY>
      {/* 全屏动态背景光斑层 */}
      <View className='xhh-bg-layer'>
        <View className='xhh-blob xhh-blob-a' />
        <View className='xhh-blob xhh-blob-b' />
        <View className='xhh-blob xhh-blob-c' />
        <View className='xhh-blob xhh-blob-d' />
      </View>

      {/* ===================== 宠物形象卡（原型对齐） ===================== */}
      <View className='profile-hero-card'>
        <View className='profile-hero-glow' />
        <View className='profile-hero-avatar'>
          <PetAvatar
            species={activePet.species}
            petName={activePet.name}
            expressionContext={defaultExpressionContext}
            // 传入宠物档案：组件内部自动优先真实照片、其次 AI 卡通形象；都没有时走渐变 emoji 兜底
            pet={activePet}
            size={80}
          />
          {/* 更换头像入口：点击进入形象定制页（上传/拍照、预设、AI 生成三途径） */}
          <View className='profile-hero-avatar-edit' onClick={() => navigateTo('/pagesPet/avatar-customize/index')}>
            <Text className='profile-hero-avatar-edit-text'>📷 换头像</Text>
          </View>
        </View>
        <View className='profile-hero-name-row'>
          <Text className='profile-hero-name'>{activePet.name}</Text>
          {/* 多成员共同养宠：家庭有 2 人以上成员时显示共养标识 */}
          {isCoCared && (
            <View className='profile-co-care-badge'>
              <Text className='profile-co-care-icon'>👥</Text>
              <Text className='profile-co-care-text'>家庭共养</Text>
            </View>
          )}
          {activePet.isDeceased && (
            <View className='profile-deceased-badge'>
              <Text className='profile-deceased-icon'>🕊️</Text>
              <Text className='profile-deceased-text'>已回喵星</Text>
            </View>
          )}
        </View>
        <View className='profile-hero-breed-pill'>{activePet.breed || '未知品种'}</View>
        <View className='profile-hero-meta'>
          <Text className='profile-hero-meta-item'>{activePet.gender === 'male' ? '♂ 公' : activePet.gender === 'female' ? '♀ 母' : '未知'}</Text>
          <View className='profile-hero-meta-divider' />
          <Text className='profile-hero-meta-item'>{activePet.birthDate ? calcAge(activePet.birthDate) : '年龄未知'}</Text>
          <View className='profile-hero-meta-divider' />
          <Text className='profile-hero-meta-item'>{activePet.weight ? `${activePet.weight}kg` : '--kg'}</Text>
          <View className='profile-hero-meta-divider' />
          <Text className='profile-hero-meta-item profile-hero-meta-item--success'>
            <Text className='profile-hero-meta-dot' />
            {activePet.isNeutered ? '已绝育' : '未绝育'}
          </Text>
        </View>
      </View>

      {/* 多宠物切换（保留） */}
      {pets.length > 1 && (
        <View className='profile-pet-switcher'>
          {pets.map(p => (
            <View
              key={p.id}
              className={`profile-pet-tab ${currentPet?.id === p.id ? 'profile-pet-tab-active' : ''}`}
              onClick={() => switchPet(p.id)}
            >
              <Text>{p.species === 'cat' ? '🐱' : '🐶'}</Text>
              <Text>{p.name}</Text>
            </View>
          ))}
        </View>
      )}

      {/* ===================== 健康指标区 2x2（原型对齐） ===================== */}
      <View className='profile-metrics'>
        <View className='profile-metric'>
          <View className='profile-metric-icon profile-metric-icon--coral'>
            <Text>❤️</Text>
          </View>
          <Text className='profile-metric-label'>健康评分</Text>
          <Text className='profile-metric-value'>
            {healthScore !== null ? `${healthScore}` : '--'}<Text className='profile-metric-unit'>分</Text>
          </Text>
        </View>
        <View className='profile-metric'>
          <View className='profile-metric-icon profile-metric-icon--gold'>
            <Text>📅</Text>
          </View>
          <Text className='profile-metric-label'>连续打卡</Text>
          <Text className='profile-metric-value'>
            {streakDays}<Text className='profile-metric-unit'>天</Text>
          </Text>
        </View>
        <View className='profile-metric'>
          <View className='profile-metric-icon profile-metric-icon--success'>
            <Text>💉</Text>
          </View>
          <Text className='profile-metric-label'>疫苗覆盖</Text>
          <Text className='profile-metric-value'>
            {vaccineCoverage !== null ? `${vaccineCoverage}` : '--'}<Text className='profile-metric-unit'>%</Text>
          </Text>
        </View>
        <View className='profile-metric'>
          <View className='profile-metric-icon profile-metric-icon--info'>
            <Text>📈</Text>
          </View>
          <Text className='profile-metric-label'>近7天趋势</Text>
          <Text className='profile-metric-value'>{weekTrend}</Text>
        </View>
      </View>

      {/* ===================== 档案详情卡（原型对齐） ===================== */}
      <View className='profile-detail-card'>
        <View className='profile-section-head'>
          <View className='profile-section-bar' />
          <View className='profile-section-titles'>
            <Text className='profile-section-title'>档案详情</Text>
            <Text className='profile-section-sub'>基础信息与健康备注</Text>
          </View>
        </View>
        <View className='profile-detail-row'>
          <View className='profile-detail-label'>
            <Text className='profile-detail-icon profile-detail-icon--coral'>📅</Text>
            <Text>出生日期</Text>
          </View>
          <Text className='profile-detail-value'>{formatDate(activePet.birthDate)}</Text>
        </View>
        <View className='profile-detail-row'>
          <View className='profile-detail-label'>
            <Text className='profile-detail-icon profile-detail-icon--gold'>🎨</Text>
            <Text>毛色</Text>
          </View>
          <Text className='profile-detail-value'>{activePet.coatColor || '未设置'}</Text>
        </View>
        <View className='profile-detail-row'>
          <View className='profile-detail-label'>
            <Text className='profile-detail-icon profile-detail-icon--coral'>🪪</Text>
            <Text>芯片号</Text>
          </View>
          <Text className='profile-detail-value'>{activePet.microchipId || '无'}</Text>
        </View>
        <View className='profile-detail-row'>
          <View className='profile-detail-label'>
            <Text className='profile-detail-icon profile-detail-icon--warning'>⚠️</Text>
            <Text>过敏史</Text>
          </View>
          <Text className='profile-detail-value'>{activePet.allergies?.length ? activePet.allergies.join('、') : '无'}</Text>
        </View>
        <View className='profile-detail-row'>
          <View className='profile-detail-label'>
            <Text className='profile-detail-icon profile-detail-icon--coral'>💊</Text>
            <Text>当前用药</Text>
          </View>
          <Text className='profile-detail-value'>{activePet.medications?.length ? activePet.medications.join('、') : '无'}</Text>
        </View>
        <View className='profile-detail-row profile-detail-row--last'>
          <View className='profile-detail-label'>
            <Text className='profile-detail-icon profile-detail-icon--success'>➕</Text>
            <Text>慢性病</Text>
          </View>
          <Text className='profile-detail-value'>{activePet.chronicConditions?.length ? activePet.chronicConditions.join('、') : '无'}</Text>
        </View>
      </View>

      {/* ===================== 品种特征卡（原型对齐） ===================== */}
      <View className='profile-detail-card'>
        <View className='profile-section-head'>
          <View className='profile-section-bar' />
          <View className='profile-section-titles'>
            <Text className='profile-section-title'>品种特征</Text>
          </View>
        </View>
        <View className='profile-feature-row'>
          <Text className='profile-feature-icon'>🛡️</Text>
          <View className='profile-feature-info'>
            <Text className='profile-feature-label'>遗传病易感</Text>
            <Text className='profile-feature-value'>{breedInfo?.geneticDiseases?.[0] || activePet.notes || '暂无数据'}</Text>
          </View>
        </View>
        <View className='profile-feature-row'>
          <Text className='profile-feature-icon profile-feature-icon--gold'>⚖️</Text>
          <View className='profile-feature-info'>
            <Text className='profile-feature-label'>体重正常范围</Text>
            <Text className='profile-feature-value'>{breedInfo?.weightRangeStr || '暂无数据'}</Text>
          </View>
        </View>
        <View className='profile-feature-row profile-feature-row--last'>
          <Text className='profile-feature-icon profile-feature-icon--warning'>🍽️</Text>
          <View className='profile-feature-info'>
            <Text className='profile-feature-label'>饮食禁忌</Text>
            <Text className='profile-feature-value'>{breedInfo?.dietRestrictions?.[0] || '暂无数据'}</Text>
          </View>
        </View>
      </View>

      {/* 喜好与习惯（保留） */}
      {facts.length > 0 && (
        <View className='profile-section'>
          <Text className='profile-section-title'>它的喜好与习惯</Text>
          <View className='profile-facts-list'>
            {facts.map((fact) => (
              <View key={fact.id} className={`profile-fact-item profile-fact-item--${fact.category}`}>
                <Text className='profile-fact-icon'>{FACT_ICONS[fact.category] || '📝'}</Text>
                <Text className='profile-fact-text'>{fact.fact}</Text>
              </View>
            ))}
          </View>
        </View>
      )}

      {/* ===================== 编辑档案按钮（原型对齐） ===================== */}
      <View className='profile-edit-btn' onClick={() => navigateTo(`/pagesPet/edit/index?id=${activePet.id}`)}>
        <Text className='profile-edit-btn-text'>✏️ 编辑档案</Text>
      </View>

      {/* 健康管理入口（保留） */}
      <View className='profile-section'>
        <View className='profile-actions'>
          <View className='profile-action-btn' onClick={() => navigateTo('/pagesPet/chronic-tracking/index')}>
            <Text className='profile-action-icon'>🩺</Text>
            <Text className='profile-action-label'>慢性病追踪</Text>
          </View>
          <View className='profile-action-btn' onClick={() => navigateTo('/pagesPet/feeding-advice/index')}>
            <Text className='profile-action-icon'>🍽️</Text>
            <Text className='profile-action-label'>喂养建议</Text>
          </View>
        </View>
      </View>

      <View className='profile-section'>
        <View className='profile-actions'>
          <View className='profile-action-btn' onClick={() => navigateTo('/pagesPet/diary/index')}>
            <Text className='profile-action-icon'>📔</Text>
            <Text className='profile-action-label'>成长日记</Text>
          </View>
          <View className='profile-action-btn' onClick={() => navigateTo('/pagesPet/avatar-customize/index')}>
            <Text className='profile-action-icon'>🎨</Text>
            <Text className='profile-action-label'>形象定制</Text>
          </View>
        </View>
      </View>

      <View className='profile-section'>
        <View className='profile-danger-zone'>
          <Text className='profile-danger-title'>危险操作</Text>
          <View className='profile-danger-btn' onClick={handleMarkDeceased}>
            <Text>标记宠物离世</Text>
          </View>
        </View>
      </View>

      <View className='profile-bottom-safe' />
    </ScrollView>
  )
}
