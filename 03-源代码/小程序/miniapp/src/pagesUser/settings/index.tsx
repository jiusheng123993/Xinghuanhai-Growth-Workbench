/**
 * 设置页面（按高保真 v2「屏 09 设置」对齐）
 *
 * 结构（逐块对照 v2 的 10 块，见本批自述的「逐块对照」表）：
 *   ① 分组标题「账号」（同色小圆点 + 标题，v2 的 .sec-head）
 *   ② 账号卡：头像与昵称 / 手机号
 *   ③ 分组标题「偏好」
 *   ④-0 星空主题预览卡（v2 偏好卡上方那张 brandip：图在上、说明条在下）
 *   ④ 偏好卡：主题皮肤（四季胶囊，v2 的 .themerow/.tpill）/ 提醒
 *   ⑤ 分组标题「数据管理」
 *   ⑥ 数据管理卡：健康报告 / 清除缓存 / AI 记忆纠错 / 导出 / 删除云端数据 / 注销账号
 *   ⑦ 分组标题「关于」
 *   ⑧ 关于卡：用户协议 / 隐私政策 / 新手指引 / 意见反馈 / 当前版本
 *   ⑨ ★ 退出登录行（★ = v2 把退出登录放在「关于」同一张卡的末行，本页照做）
 *   ⑩ 注销倒计时提示（v2 没有；只有"已申请注销"的用户看得到，属既有能力，保留）
 *
 * 【v2 有、本页没有的块：现在只剩 1 处】
 *   · v2 底部那行「IA 术语」页脚说明是原型的设计注释（.footmark），不是产品内容，本页不渲染。
 *   · （原先缺的「星空银河 · 深色主题」预览卡，已由舰长在 `data/illustrations.ts` 新开
 *      **固定远程图** key `'brand-starry'` 后于本批补上，见 ④-0 那段注释。）
 *
 * 【本页保留、v2 没有的能力（删掉等于删功能，逐条说明放在哪）】
 *   · 头像/昵称编辑、微信头像昵称跟随 → 账号卡上方「个人资料」卡（顶部常驻）
 *   · 背景自定义 = 主题皮肤行 + 宠物照片壁纸（壁纸入口收进主题皮肤行的面板里，
 *     `BackgroundPicker` 组件仍在但已无页面引用，本页改为直接调 themeStore + chooseImageWithPrivacy）
 *   · 三条通知开关 → 「提醒」行展开的面板（原来是三行常驻）
 *   · 数据导出/清除缓存/AI 记忆纠错/删除云端数据/注销账号 → 「数据管理」卡
 *   · 健康报告 → 「数据管理」卡首行（v2 的偏好卡没有它，但它是本页既有入口）
 */
import { useEffect, useState, useCallback, useMemo } from 'react'
import { View, Text, Switch, Button, Input, Image } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { useAuthStore } from '../../stores/authStore'
import { useSettingsStore, type NotificationSettings } from '../../stores/settingsStore'
import { useThemeStore, getThemeMeta, type ThemeKey } from '../../stores/themeStore'
import { useMembership } from '../../hooks/useMembership'
import { useAnalytics } from '../../hooks/useAnalytics'
import { bindPhone } from '../../services/authService'
import { APP_VERSION } from '../../constants'
import {
  exportAllUserData,
  deleteUserData,
  generateDeletionConfirmCode,
  getDataPrivacyStatus,
  requestAccountDeletion,
  cancelAccountDeletion,
} from '../../services/dataPrivacyService'
import type { AccountDeletionReason, DataPrivacyStatus, AccountDeletionResult } from '../../types/dataPrivacyTypes'
import { AccountDeletionConfirm } from '../../components/AccountDeletionConfirm'
import { useThemeClass, useThemeKey, usePetWallpaper } from '../../hooks/useThemeClass'
// 【2026-09-12 IA 第 2a 批】「个人资料」页并入本页后新增的依赖：
// Icon = 分组图标与非微信端的头像占位图标；api.uploadAvatar = 上传新头像换永久 URL；
// isWeapp = 判定是否走微信原生资料组件；chooseImageWithPrivacy = 相册选图（含隐私授权处理）
// 【2026-09-12 星空预览卡批】Illustration = 品牌插画组件（走 data/illustrations.ts 的唯一 URL 出口，
// 页面自己不拼任何图片地址；本卡用固定远程图 key 'brand-starry'）
import { Icon, Illustration, type FillIconName } from '../../components'
import { api } from '../../services/api'
import { isWeapp } from '../../platform'
import { chooseImageWithPrivacy } from '../../utils/privacy'
// 「新手指引」常驻入口的落点（2026-09-12：新手引导此前只有新用户那一次机会，
// 已看过引导的老用户没有任何回看入口；地址取自 utils/onboardingGate 的唯一真相源）
import { ONBOARDING_URL } from '../../utils/onboardingGate'
import './index.scss'

/** Taro 手机号授权 API 类型扩展（微信 Button open-type=getPhoneNumber 对应运行时能力） */
interface TaroWithPhoneNumber {
  getPhoneNumber: (options: {
    success?: (res: unknown) => void
    fail?: (res: unknown) => void
    complete?: () => void
  }) => void
}

/**
 * 四季主题选项（**与 v2 的 `.tpill` 一一对应**：四个胶囊＝春/夏/秋/冬）
 *
 * 【为什么这里只有四季】v2 的那一排本来就只画了四季胶囊，所以这四枚保持 v2 的
 * `.tpill` 等宽样式；「星空银河 / 奶油格纹」不属于四季，用横向 `ppill` 紧挨着排在同一张卡里
 * （见 EXTRA_THEME_OPTIONS）—— 两者**同属"换背景主题"这一件事**，必须一眼看全，
 * 不再像早先那样收进折叠面板。
 *
 * dot 取各主题的**主色**（来自 themeStore.THEME_LIST 的 primaryColor，单一真相源）；
 * primary 是该主题的深色档（v2 的 --primary-deep），用于选中态的边框与文字。
 */
const SEASON_OPTIONS: { key: ThemeKey; label: string; dot: string; primary: string }[] = [
  { key: 'spring', label: '春', dot: getThemeMeta('spring').primaryColor, primary: '#3A9A4E' },
  { key: 'summer', label: '夏', dot: getThemeMeta('summer').primaryColor, primary: '#177FC4' },
  { key: 'autumn', label: '秋', dot: getThemeMeta('autumn').primaryColor, primary: '#F04E1D' },
  { key: 'winter', label: '冬', dot: getThemeMeta('winter').primaryColor, primary: '#4557D8' },
]

/**
 * 非四季的两套背景（深色 / 质感）—— 与四季同属主题，紧接着四季胶囊排一行
 * label 用主题全名（横向胶囊空间够，不学四季那样缩成一个字）
 */
const EXTRA_THEME_OPTIONS: { key: ThemeKey; label: string; dot: string; primary: string }[] = [
  { key: 'starry', label: '星空银河', dot: getThemeMeta('starry').primaryColor, primary: '#5A6BE8' },
  { key: 'grid', label: '奶油格纹', dot: getThemeMeta('grid').primaryColor, primary: '#F04E1D' },
]

/**
 * 「当前主题预览」用哪张插画
 *
 * · 四季四套 → `page-home`：今天页那张品牌图，`Illustration` 内部会按**当前主题**解析成对应
 *   季节的版本（四张都在服务器上）。
 * · 星空银河 → `brand-starry`：**固定 key**。starry 不在四季里，套季节函数会拼出
 *   `today-brand-autumn.jpg` 这种"看着像对、其实是另一张画"的路径（见 data/illustrations.ts 顶部坑记）。
 * · 奶油格纹 → **null**：它没有专属品牌图，而"按季节回退"会拿秋季风景图去配"奶油底色 · 细格纹"
 *   的说明 —— 图文对不上比没有图更糟。所以这一套不插图，由预览区改画**它自己的格纹底**
 *   （见 index.scss 的 `--grid` 修饰类），文案仍读它自己的 desc。
 *
 * @param theme 当前主题 key
 * @returns 该主题预览要用的插画 key；奶油格纹返回 null（改用 CSS 画的格纹底）
 */
function previewIllustration(theme: ThemeKey): 'page-home' | 'brand-starry' | null {
  if (theme === 'starry') return 'brand-starry'
  if (theme === 'grid') return null
  return 'page-home'
}

/** 三条通知开关的配置：key 对应 settingsStore 的 NotificationSettings 字段 */
const NOTIFY_ITEMS: { key: keyof NotificationSettings; label: string }[] = [
  { key: 'checkinReminder', label: '打卡提醒' },
  { key: 'vaccineReminder', label: '疫苗驱虫提醒' },
  { key: 'healthAlert', label: '健康异常提醒' },
]

/**
 * 菜单行（一个图标圆角块 + 主文案 + 可选副文案 + 可选右侧值 + 箭头）
 * @property tone 图标色系：底色 tint 与图标同源（底变色不变会违和，见 Icon.tsx 顶部配色约定）
 */
interface MenuRow {
  /** 面性图标名（必须是 components/icons-fill.ts 里存在的 key，否则 Icon 渲染会落空） */
  icon: FillIconName
  label: string
  /** 副文案（如「3 步了解星河宠记」） */
  desc?: string
  /** 右侧值文案（如手机号尾号、版本号）；与 desc 不同，它是右对齐的"当前值" */
  value?: string
  tone: 'primary' | 'gold' | 'teal' | 'danger'
  /** 危险操作（删除/注销）：右侧值或标签用警示色 */
  danger?: boolean
  onClick?: () => void
}

/**
 * 渲染一个菜单行。
 *
 * 【为什么行必须有 onClick 才可点】本批没有"假按钮"这一说：无 onClick 的行
 * 一律不挂点击事件（不显示按压反馈），例如「当前版本」那行本来就只是展示。
 */
function renderMenuRow(row: MenuRow) {
  return (
    <View
      key={row.label}
      className='settings-page__row'
      onClick={row.onClick}
    >
      <View className={`settings-page__row-icon settings-page__row-icon--${row.tone}`}>
        <Icon name={row.icon} size={16} tone={row.tone} />
      </View>
      <View className='settings-page__row-main'>
        <Text className={`settings-page__row-label${row.danger ? ' settings-page__row-label--danger' : ''}`}>
          {row.label}
        </Text>
        {row.desc && <Text className='settings-page__row-sub'>{row.desc}</Text>}
      </View>
      {row.value && (
        <Text className={`settings-page__row-value${row.danger ? ' settings-page__row-value--danger' : ''}`}>
          {row.value}
        </Text>
      )}
      {row.onClick && <Text className='settings-page__row-arrow'>›</Text>}
    </View>
  )
}

export default function SettingsPage() {
  const user = useAuthStore(s => s.user)
  const logout = useAuthStore(s => s.logout)
  // 资料编辑所需：登录态门槛 + 保存资料的动作（原 profile 页同款取用方式）
  const isAuthenticated = useAuthStore(s => s.isAuthenticated)
  const updateProfile = useAuthStore(s => s.updateProfile)
  const isMember = useMembership().isMember
  const notification = useSettingsStore(s => s.notification)
  const loadSettings = useSettingsStore(s => s.loadSettings)
  const updateNotification = useSettingsStore(s => s.updateNotification)
  const clearCache = useSettingsStore(s => s.clearCache)
  const exportData = useSettingsStore(s => s.exportData)
  const { trackPageView, trackEvent } = useAnalytics()
  const themeClass = useThemeClass()
  // 当前主题 key：四季胶囊的选中态、主题皮肤行的「现在是哪套」都要它。
  // 用 useThemeKey 而不是 useThemeStore(s=>...) —— Taro3 + zustand v3 下 selector 订阅不可靠
  // （切主题后本页不会重渲染，胶囊的选中态会停在旧值）。
  const themeKey = useThemeKey()
  // 当前宠物照片壁纸（本地路径或 https 地址）；null = 没设壁纸
  const petWallpaper = usePetWallpaper()

  const [privacyStatus, setPrivacyStatus] = useState<DataPrivacyStatus | null>(null)
  const [showDeletionModal, setShowDeletionModal] = useState(false)
  const [deletionConfirmCode, setDeletionConfirmCode] = useState('')
  const [deletionLoading, setDeletionLoading] = useState(false)
  const [exportingData, setExportingData] = useState(false)
  const [phoneBound, setPhoneBound] = useState<string | null>(null)
  const [bindingPhone, setBindingPhone] = useState(false)

  // ===== 主题皮肤面板 / 提醒面板的展开状态 =====
  // 为什么要折叠：v2 的「偏好」卡只有 3 行（主题皮肤 / 提醒 / 隐私），
  // 而本页原来把三条通知开关平铺成三行、把背景选择铺成一整块 —— 那正是与 v2 版式差得最远的地方。
  // 折叠后功能一个不少（点开就是原来那些开关），首屏长度也对上了 v2。
  const [themePanelOpen, setThemePanelOpen] = useState(false)
  const [notifyPanelOpen, setNotifyPanelOpen] = useState(false)
  // 壁纸操作防连点（选图/落盘/清除都是异步的，连点会重复触发）
  const [wallpaperBusy, setWallpaperBusy] = useState(false)
  // 「头像与昵称」行被点后的高亮标记：滚回顶部时给资料卡一圈脉冲描边，
  // 让用户看清"要改的东西在哪"（否则滚上去只是一个普通卡片，不知道为什么要滚）
  const [profileHighlight, setProfileHighlight] = useState(false)

  // ===== 个人资料编辑草稿（2026-09-12 IA 第 2a 批：原 pagesUser 分包的 profile 页并入本页）=====
  // 昵称草稿：初始跟随现有资料；微信端可在原生输入框里直接填微信昵称
  const [nicknameDraft, setNicknameDraft] = useState('')
  // 本次刚选的头像临时文件路径（保存时上传换永久 URL）；null = 未选新头像，保存时沿用原头像
  const [avatarDraft, setAvatarDraft] = useState<string | null>(null)
  // 是否正在保存（防连点重复提交）
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    loadSettings()
    setPrivacyStatus(getDataPrivacyStatus())
  }, [loadSettings])

  // 用户资料变化时同步昵称草稿（原 profile 页同款逻辑）：换账号或后台回填资料后，
  // 输入框不能还留着上一个账号/上一次的旧昵称
  useEffect(() => {
    setNicknameDraft(user?.nickname || '')
  }, [user?.nickname])

  useEffect(() => {
    trackPageView('settings')
  }, [trackPageView])

  const deletionCountdown = useMemo(() => {
    if (!privacyStatus?.accountDeletionRequested || !privacyStatus.accountDeletionScheduledAt) {
      return null
    }
    const scheduled = new Date(privacyStatus.accountDeletionScheduledAt)
    const now = new Date()
    const diffMs = scheduled.getTime() - now.getTime()
    if (diffMs <= 0) return '即将执行'
    const days = Math.ceil(diffMs / (1000 * 60 * 60 * 24))
    return `${days}天后`
  }, [privacyStatus?.accountDeletionRequested, privacyStatus?.accountDeletionScheduledAt])

  const handleToggleNotification = useCallback((key: keyof NotificationSettings, value: boolean) => {
    trackEvent('toggle_notification', { key, value })
    updateNotification(key, value)
  }, [updateNotification, trackEvent])

  const handleClearCache = useCallback(() => {
    Taro.showModal({
      title: '清除缓存',
      content: '确认清除所有本地缓存数据？',
      success: (res) => {
        if (res.confirm) {
          trackEvent('clear_cache')
          clearCache()
          Taro.showToast({ title: '缓存已清除', icon: 'success' })
        }
      },
    })
  }, [clearCache, trackEvent])

  const handleExportData = useCallback(async () => {
    if (!isMember) {
      Taro.showToast({ title: '会员专属功能', icon: 'none' })
      return
    }
    try {
      const data = exportData()
      await Taro.setClipboardData({ data })
      trackEvent('export_data')
      Taro.showToast({ title: '数据已复制到剪贴板', icon: 'success' })
    } catch {
      Taro.showToast({ title: '导出失败', icon: 'none' })
    }
  }, [isMember, exportData, trackEvent])

  const handleExportAllData = useCallback(async () => {
    if (!user?.id) return
    if (exportingData) return

    Taro.showModal({
      title: '导出全部数据',
      content: '将导出您在星河宠记的所有个人数据（云端+本地），生成JSON文件。是否继续？',
      success: async (res) => {
        if (!res.confirm) return
        setExportingData(true)
        try {
          const result = await exportAllUserData(user.id)
          if (result.success && result.data) {
            await Taro.setClipboardData({ data: result.data })
            trackEvent('export_all_data')
            Taro.showToast({ title: `已导出${result.totalRecords}条记录`, icon: 'success' })
            setPrivacyStatus(getDataPrivacyStatus())
          } else {
            Taro.showToast({ title: result.error || '导出失败', icon: 'none' })
          }
        } catch {
          Taro.showToast({ title: '导出失败', icon: 'none' })
        } finally {
          setExportingData(false)
        }
      },
    })
  }, [user?.id, exportingData, trackEvent])

  const handleDeleteCloudData = useCallback(() => {
    if (!user?.id) return

    Taro.showModal({
      title: '删除云端数据',
      content: '此操作将永久删除您在云端的全部数据，且无法恢复！本地数据不受影响。确定要继续吗？',
      confirmColor: '#FF4D4F',
      success: async (res) => {
        if (!res.confirm) return
        try {
          const result = await deleteUserData(user.id)
          if (result.success) {
            trackEvent('delete_cloud_data')
            Taro.showToast({ title: `已删除${result.deletedTables.length}类数据`, icon: 'success' })
            setPrivacyStatus(getDataPrivacyStatus())
          } else {
            Taro.showToast({ title: result.error || '删除失败', icon: 'none' })
          }
        } catch {
          Taro.showToast({ title: '删除失败', icon: 'none' })
        }
      },
    })
  }, [user?.id, trackEvent])

  const handleRequestDeletion = useCallback(() => {
    trackEvent('request_account_deletion')
    const code = generateDeletionConfirmCode()
    setDeletionConfirmCode(code)
    setShowDeletionModal(true)
  }, [trackEvent])

  const handleDeletionConfirm = useCallback(async (reason: AccountDeletionReason, customReason: string, code: string) => {
    if (!user?.id) return
    setDeletionLoading(true)
    try {
      const result: AccountDeletionResult = await requestAccountDeletion(user.id, { reason, customReason, confirmCode: code })
      if (result.success) {
        trackEvent('confirm_account_deletion', { reason })
        setShowDeletionModal(false)
        Taro.showToast({
          title: `注销申请已提交，${result.gracePeriodDays}天冷静期`,
          icon: 'none',
          duration: 3000,
        })
        setPrivacyStatus(getDataPrivacyStatus())
      } else {
        Taro.showToast({ title: result.error || '注销失败', icon: 'none' })
      }
    } catch {
      Taro.showToast({ title: '注销请求失败', icon: 'none' })
    } finally {
      setDeletionLoading(false)
    }
  }, [user?.id, trackEvent])

  const handleDeletionCancel = useCallback(() => {
    setShowDeletionModal(false)
  }, [])

  const handleCancelDeletion = useCallback(async () => {
    if (!user?.id) return
    Taro.showModal({
      title: '取消注销',
      content: '确认取消账号注销申请？取消后您的账号将恢复正常使用。',
      success: async (res) => {
        if (!res.confirm) return
        const success = await cancelAccountDeletion(user.id)
        if (success) {
          Taro.showToast({ title: '已取消注销', icon: 'success' })
          setPrivacyStatus(getDataPrivacyStatus())
        } else {
          Taro.showToast({ title: '取消失败，请稍后重试', icon: 'none' })
        }
      },
    })
  }, [user?.id])

  const handleAgreement = useCallback((type: 'user' | 'privacy') => {
    Taro.navigateTo({ url: `/pagesUser/agreement/index?type=${type}` })
  }, [])

  const handleMemoryCorrection = useCallback(() => {
    trackEvent('open_memory_correction')
    Taro.navigateTo({ url: '/pagesUser/memory/index' })
  }, [trackEvent])

  /**
   * 新手指引：跳转到新手引导页（三屏：品牌 → 三件事 → 添加宠物）
   *
   * 【为什么要在设置里放这条常驻入口】引导页原先只由「登录后第一次」触发，
   * 已看过引导的老用户想再看一眼没有任何入口（引导页也不在 tabBar 上）。
   * 用 navigateTo 而不是 redirectTo：这里是**用户主动回看**，
   * 本页留在栈里才符合预期（看完能按返回键退回设置，redirectTo 会把设置页销毁）；
   * 该地址与本页同属 pagesUser 分包，且被 routeGuard 覆盖，无懒加载竞态。
   *
   * 【2026-09-12 v2 对齐批】行的位置从「关于」组首行保持不动（v2 的第三张卡里也有它），
   * 只把整组换成了 v2 的卡片语言，行为与埋点一字未改。
   */
  const handleOnboardingGuide = useCallback(() => {
    trackEvent('open_onboarding_guide')
    Taro.navigateTo({ url: ONBOARDING_URL })
  }, [trackEvent])

  /**
   * 切换主题皮肤（四季胶囊 / 面板里的全部背景共用）
   *
   * 【为什么不再由 BackgroundPicker 内部完成】v2 把主题皮肤做成了设置页自己的一行，
   * 本页改为直接调 themeStore（与「我的」页的主题面板同一套写法），
   * 埋点与轻提示留在页面层，切主题这件事就只有一个调用点、不会两处各切一次。
   * 重复点当前主题直接返回：省一次无意义的重渲染与提示。
   */
  const handleSelectTheme = useCallback((next: ThemeKey) => {
    if (next === themeKey) return
    useThemeStore.getState().setTheme(next)
    trackEvent('change_theme', { theme: next })
    Taro.showToast({ title: '背景已切换', icon: 'success', duration: 1000 })
  }, [themeKey, trackEvent])

  /**
   * 选一张照片当页面背景（宠物照片壁纸）
   *
   * 逻辑与 components/BackgroundPicker 内的实现一致（压缩后落盘，避开 10MB 本地文件配额；
   * 落盘失败降级用临时路径并如实告知），本页内联的原因见文件头注释：
   * v2 的主题皮肤行是页面自己的一行，不再挂载整个 BackgroundPicker（它自带"预设背景"一屏，
   * 与新的四季胶囊重复）。
   */
  const handlePickWallpaper = useCallback(async () => {
    if (wallpaperBusy) return
    setWallpaperBusy(true)
    try {
      const res = await chooseImageWithPrivacy({ count: 1 })
      const temp = res.tempFilePaths?.[0]
      if (!temp) return
      try {
        const compressed = await Taro.compressImage({ src: temp, quality: 70 })
        const saved = await Taro.saveFile({ tempFilePath: compressed.tempFilePath })
        // saveFile 的返回类型是「成功 | 失败」联合，需显式收窄后才能取路径
        if (!('savedFilePath' in saved)) throw new Error('saveFile 未返回文件路径')
        useThemeStore.getState().setPetWallpaper(saved.savedFilePath)
      } catch {
        // 落盘失败（配额满/平台不支持）：先用临时路径，至少本次可见，并如实告知用户
        useThemeStore.getState().setPetWallpaper(temp)
        Taro.showToast({ title: '背景已应用（重启后可能失效）', icon: 'none', duration: 2200 })
        return
      }
      Taro.showToast({ title: '已设为背景', icon: 'success' })
    } catch {
      // 用户取消选图属正常操作，静默处理（与 profile 页一致，不弹错误提示）
    } finally {
      setWallpaperBusy(false)
    }
  }, [wallpaperBusy])

  /** 清除宠物照片壁纸，回到纯色/主题背景 */
  const handleClearWallpaper = useCallback(() => {
    useThemeStore.getState().setPetWallpaper(null)
    Taro.showToast({ title: '已恢复纯色背景', icon: 'none' })
  }, [])

  /**
   * 「头像与昵称」行：滚回页面顶部的「个人资料」卡并高亮一下
   *
   * 【为什么不是弹窗编辑】头像昵称必须用微信原生组件（chooseAvatar + nickname，
   * Taro 3.6 编译层不支持这两个属性），原生组件不能塞进弹层里可靠渲染；
   * 而该编辑区本来就在本页顶部常驻。所以这一行的行为是"把你送上去"，
   * 并用一圈脉冲描边指明"就是这张卡" —— 不是假按钮。
   * scrollTop 传 0 而不是查元素位置：设置页顶部就是资料卡，不需要选择器查询（少一次异步）。
   */
  const handleEditProfile = useCallback(() => {
    trackEvent('edit_profile_from_account_row')
    Taro.pageScrollTo({ scrollTop: 0, duration: 240 })
    setProfileHighlight(true)
  }, [trackEvent])

  // 高亮只留 1.6s：足够用户看清，又不会一直闪；重复点会重置计时
  useEffect(() => {
    if (!profileHighlight) return
    const timer = setTimeout(() => setProfileHighlight(false), 1600)
    return () => clearTimeout(timer)
  }, [profileHighlight])

  /** 微信手机号绑定 */
  const handleBindPhone = useCallback(() => {
    if (bindingPhone) return
    setBindingPhone(true)
    ;(Taro as unknown as TaroWithPhoneNumber).getPhoneNumber({
      success: async (res) => {
        const { code } = res as { code: string; errMsg: string }
        if (!code) {
          Taro.showToast({ title: '未获取到授权码', icon: 'none' })
          return
        }
        try {
          const result = await bindPhone(code)
          if (result.success && result.phone) {
            setPhoneBound(result.phone)
            trackEvent('bind_phone_success')
            Taro.showToast({ title: '绑定成功', icon: 'success' })
          } else {
            Taro.showToast({ title: '绑定失败，请重试', icon: 'none' })
          }
        } catch {
          Taro.showToast({ title: '绑定失败，请重试', icon: 'none' })
        }
      },
      fail: (err) => {
        if ((err as { errMsg?: string }).errMsg?.includes('cancel')) {
          // 用户取消，静默处理
        } else {
          Taro.showToast({ title: '获取手机号失败', icon: 'none' })
        }
      },
      complete: () => {
        setBindingPhone(false)
      },
    })
  }, [bindingPhone, trackEvent])

  // ===== 个人资料编辑（头像 + 昵称）=====
  // 为什么原样搬 profile 页的实现：微信已禁止静默获取昵称/头像，唯一官方路径是原生组件
  // （button open-type=chooseAvatar + input type=nickname）；逻辑里有"临时路径必须先上传换
  // 永久 URL""未选新头像不重复上传"等细节，重写容易漏，故保持与 profile 页一致。
  /**
   * 选择头像：微信端走原生 chooseAvatar（e.detail.avatarUrl 是临时文件路径）；
   * avatarUrl 为空串（用户点了"从相册选自定义图"）或非微信端时，回退到相册选图
   * @param e 原生组件 chooseavatar 事件，detail = { avatarUrl }
   */
  const handleChooseAvatar = (e?: any) => {
    const temp = e?.detail?.avatarUrl
    if (temp) {
      setAvatarDraft(temp)
      return
    }
    chooseImageWithPrivacy({ count: 1, sizeType: ['compressed'] })
      .then((res) => {
        if (res.tempFilePaths.length) setAvatarDraft(res.tempFilePaths[0])
      })
      // 用户取消选图属正常操作，静默处理（与 profile 页一致，不弹错误提示）
      .catch(() => {})
  }

  /**
   * 原生组件昵称变更回调（wechat-profile 组件 triggerEvent 传回）
   * @param e { detail: { value: string } }；非字符串（异常事件）直接忽略，避免写入脏草稿
   */
  const handleNicknameChange = (e?: any) => {
    const value = e?.detail?.value
    if (typeof value === 'string') setNicknameDraft(value)
  }

  /**
   * 保存资料：先把新头像上传换永久 URL（如有），再一次性更新昵称与头像
   * 无返回值；未登录或正在保存时直接返回（幂等保护），失败只 toast 不抛错
   */
  const handleSaveProfile = async () => {
    if (saving || !isAuthenticated) return
    setSaving(true)
    try {
      // 未选新头像就沿用旧头像：避免每次保存都把同一张图重复上传一遍
      let avatarUrl = user?.avatar || ''
      if (avatarDraft && avatarDraft !== user?.avatar) {
        const uploaded = await api.uploadAvatar(avatarDraft)
        avatarUrl = uploaded.url
      }
      // 昵称为空时兜底用原昵称，避免把用户名字清成空串
      await updateProfile(nicknameDraft.trim() || user?.nickname || '', avatarUrl)
      setAvatarDraft(null)
      Taro.showToast({ title: '已保存', icon: 'success' })
    } catch (err) {
      Taro.showToast({
        title: err instanceof Error ? err.message : '保存失败，请重试',
        icon: 'none',
      })
    } finally {
      setSaving(false)
    }
  }

  /**
   * 健康报告：跳转到正式的健康报告入口（趋势页，与「我的」页「健康报告」同一条路由）
   *
   * 【为什么这么改】原 profile 页的「健康报告」是在本地生成文本后用 Taro.showModal 弹
   * 一段"截断到 500 字 + 完整报告请查看控制台"的字符串，属全站第三套报告实现，用户读不到完整内容。
   * IA 第 2a 批合并时清掉该实现，改为跳转既有正式入口；埋点事件名保持不变以延续历史口径。
   */
  const handleHealthReport = useCallback(() => {
    trackEvent('click_health_report')
    Taro.navigateTo({ url: '/pagesPet/trends/index' })
  }, [trackEvent])

  const handleLogout = useCallback(() => {
    Taro.showModal({
      title: '退出登录',
      content: '确认退出当前账号？',
      confirmColor: '#FF6B35',
      success: async (res) => {
        if (res.confirm) {
          trackEvent('logout')
          await logout()
          Taro.reLaunch({ url: '/pagesUser/login/index' })
        }
      },
    })
  }, [logout, trackEvent])

  /** 当前主题的元信息（分区标题小圆点、主题皮肤行的「现在是哪套」、开关色都用它） */
  const themeMeta = getThemeMeta(themeKey)
  /** 通知开关的轨道色：走主题色板（原来是写死的 #4A90D9，与四季主题脱节） */
  const notifyColors: Record<keyof NotificationSettings, string> = {
    checkinReminder: themeMeta.palette.goldDeep,
    vaccineReminder: themeMeta.palette.teal,
    healthAlert: themeMeta.palette.success,
  }

  return (
    <View className={'settings-page ' + themeClass}>
      <View className='settings-page__inner'>
        {/* ===== ① 分组标题「账号」（v2 的 .sec-head：同色小圆点 + 标题） ===== */}
        <View className='settings-page__sec-head'>
          <View className='settings-page__sec-dot' />
          <Text className='settings-page__sec-title'>账号</Text>
        </View>

        {/* ===== ② 账号卡 =====
            合并说明（v2 卡下那行 IA 注释是设计说明，本页改成真实提示）：
            「微信绑定」原来是与「手机号绑定」并列的一行，但它**没有任何动作**（只是展示"已绑定"
            四个字），微信登录本就是本小程序的唯一登录方式 —— 按"不做假按钮"删掉该行，
            绑定状态并入手机号那行的右侧值。 */}
        {isAuthenticated && (
          <View className='settings-page__card'>
            {/* 头像与昵称：右侧显示真实昵称（没填过昵称时显示"未设置"），点它滚回顶部资料卡 */}
            <View className='settings-page__row' onClick={handleEditProfile}>
              {/* 头像走真实资料：有头像用头像（方形圆角，与资料卡同一套语言），没有就退回图标占位 */}
              {user?.avatar ? (
                <Image className='settings-page__avatar' src={user.avatar} mode='aspectFill' />
              ) : (
                <View className='settings-page__avatar settings-page__avatar--placeholder'>
                  <Icon name='user' size={18} tone='primary' />
                </View>
              )}
              <View className='settings-page__row-main'>
                <Text className='settings-page__row-label'>头像与昵称</Text>
              </View>
              <Text className='settings-page__row-value'>{user?.nickname || '未设置'}</Text>
              <Text className='settings-page__row-arrow'>›</Text>
            </View>

            {/* 手机号：整行可点＝走微信手机号授权（原有能力，未变）
                【图标为什么是 keyboard】v2 这里是个 📱 emoji，而本仓 icons-fill 里
                **没有** device-mobile / phone 这个 key（70 个 key 里没电话类图标，
                见 components/icons-fill.ts）。按"不新增图标资源"的约束，
                取语义最近的既有图标 keyboard（录入联系方式＝填表单），并在自述里如实记这条降级。 */}
            <View className='settings-page__row' onClick={handleBindPhone}>
              <View className='settings-page__row-icon settings-page__row-icon--teal'>
                <Icon name='keyboard' size={16} tone='teal' />
              </View>
              <View className='settings-page__row-main'>
                <Text className='settings-page__row-label'>手机号</Text>
              </View>
              <Text className='settings-page__row-value'>
                {bindingPhone ? '绑定中...' : phoneBound ? `已绑定 · 尾号${phoneBound}` : '未绑定'}
              </Text>
              <Text className='settings-page__row-arrow'>›</Text>
            </View>

            <Text className='settings-page__hint'>头像与昵称可跟随微信，也可自定义，改完点上方「保存」</Text>
          </View>
        )}

        {/* ===== ③ 分组标题「偏好」 ===== */}
        <View className='settings-page__sec-head'>
          <View className='settings-page__sec-dot' />
          <Text className='settings-page__sec-title'>偏好</Text>
        </View>

        {/* ===== ④ 偏好卡：主题皮肤 / 提醒 两行 =====
            【为什么没有 v2 的第三行「隐私」】原型里那行连 data-go 都没有（点不动），
            而隐私相关的真实动作本页有四处（用户协议/隐私政策页、AI 记忆纠错、
            删除云端数据、注销账号），做一行假的「隐私」等于造假按钮；
            它们现在的落点是：「关于」卡两行 + 「数据管理」卡三行。 */}
        {/* ===== ④ 主题皮肤卡：**6 套主题全在这一张卡里**（2026-09-12 合并重构）=====
            【改了什么】原先「星空银河」按 v2 原型被做成了本卡**上方一张独立的大预览卡**
            （v2 原文：`whero('today-brand-starry.jpg','星空银河 · 深色主题','毛孩子回到天上当星星')`），
            而四季胶囊在下面这张卡的「主题皮肤」行里 → **同一个能力（换背景主题）在同一屏出现
            两个并列入口**，用户看不出"到底在哪儿换主题"，也没必要让其中一套主题看起来特殊。
            【现在】6 套主题（春/夏/秋/冬 + 星空银河 + 奶油格纹）**全部**落在「主题皮肤」这一张卡内：
            · 四季仍走 v2 的 `.tpill` 等宽胶囊排；
            · 星空银河 / 奶油格纹不再藏在「更多背景与壁纸」面板里，紧挨着排一行 `ppill`；
            · 原独立预览卡降级成卡内的**当前主题预览**（切谁显示谁），"看得见效果"的价值保留；
            · 折叠面板里只剩「宠物照片壁纸」（那是另一种背景来源，不属于主题）。
            【文案】预览副标题改读 `themeStore` 里该主题注册的 `desc`（单一真相源）；
            原先硬写的那句「毛孩子回到天上当星星」是主题注释里的情感注记，全 App 只在这一处露出，
            放在"偏好"里会被读成"我的宠物要死了"，故不再作为主题说明。 */}
        <View className='settings-page__card'>
          {/* —— 主题皮肤：v2 的四季胶囊（真实可点，点了整站换色）—— */}
          <View className='settings-page__row settings-page__row--top'>
            <View className='settings-page__row-icon settings-page__row-icon--gold'>
              <Icon name='palette' size={16} tone='gold' />
            </View>
            <View className='settings-page__row-main'>
              <View className='settings-page__theme-head'>
                <Text className='settings-page__row-label'>主题皮肤</Text>
                {/* v2 的 .now：右上角写明当前是哪一套配色（含非四季的星空/格纹） */}
                <Text className='settings-page__theme-now'>{themeMeta.name}</Text>
              </View>
              {/* 四季胶囊：选中态＝该类兜底色 + 主题色描边 + 色点外圈三重标记（v2 的 .tpill.on） */}
              <View className='settings-page__theme-picker'>
                {SEASON_OPTIONS.map(opt => {
                  const active = themeKey === opt.key
                  return (
                    <View
                      key={opt.key}
                      className={`settings-page__tpill${active ? ' settings-page__tpill--on' : ''}`}
                      // 选中态底色＝该季节主色的 14% 透明档（8 位 hex 的末两位就是 alpha）。
                      // 首版用的是 14（≈8%），在奶油底上几乎看不出"选中"，截图复核后加深到 24（≈14%）。
                      style={active ? { borderColor: opt.primary, color: opt.primary, background: `${opt.primary}24` } : undefined}
                      onClick={() => handleSelectTheme(opt.key)}
                    >
                      <View
                        className='settings-page__tpill-dot'
                        style={{
                          background: opt.dot,
                          boxShadow: active
                            ? `inset 0 0 0 2rpx #FFFFFF, 0 0 0 2.5rpx ${opt.dot}`
                            : 'inset 0 0 0 2rpx rgba(255, 255, 255, 0.85)',
                        }}
                      />
                      <Text className='settings-page__tpill-label'>{opt.label}</Text>
                    </View>
                  )
                })}
              </View>

              {/* 非四季的两套：与四季同属"换背景主题"，所以并排放在同一张卡里，
                  不再藏进折叠面板（藏起来就等于让用户以为主题只有四季） */}
              <View className='settings-page__theme-extra'>
                {EXTRA_THEME_OPTIONS.map(opt => {
                  const active = themeKey === opt.key
                  return (
                    <View
                      key={opt.key}
                      className={`settings-page__ppill${active ? ' settings-page__ppill--on' : ''}`}
                      style={active ? { borderColor: opt.primary, color: opt.primary, background: `${opt.primary}24` } : undefined}
                      onClick={() => handleSelectTheme(opt.key)}
                    >
                      <View className='settings-page__ppill-dot' style={{ background: opt.dot }} />
                      <Text className='settings-page__ppill-label'>{opt.label}</Text>
                    </View>
                  )
                })}
              </View>

              {/* 当前主题预览：图 + 名称 + 该主题自己的 desc。
                  换主题时整块跟着变（Illustration 内部读当前主题解析季节图，
                  页面本身用 useThemeKey 订阅，所以切完立刻换图，不会残留上一套）。
                  插画加载失败时 Illustration 整块不渲染 —— 外层给了固定高度 + 兜底色，
                  弱网下是"一块暖色占位"而不是塌陷。 */}
              <View className='settings-page__theme-preview'>
                <View
                  className={`settings-page__theme-preview-art${previewIllustration(themeKey) ? '' : ' settings-page__theme-preview-art--grid'}`}
                >
                  {previewIllustration(themeKey) && (
                    <Illustration
                      name={previewIllustration(themeKey) as 'page-home' | 'brand-starry'}
                      fill
                      mode='aspectFill'
                      className='settings-page__theme-preview-img'
                    />
                  )}
                </View>
                <View className='settings-page__theme-preview-body'>
                  <Text className='settings-page__theme-preview-title'>{themeMeta.name}</Text>
                  <Text className='settings-page__theme-preview-desc'>{themeMeta.desc}</Text>
                </View>
              </View>

              {/* 展开：宠物照片壁纸（主题之外的另一种背景来源，收在折叠里） */}
              <View
                className='settings-page__expand'
                onClick={() => setThemePanelOpen(!themePanelOpen)}
              >
                <Text className='settings-page__expand-text'>
                  {themePanelOpen ? '收起宠物照片壁纸' : '宠物照片壁纸'}
                </Text>
                <Text className={`settings-page__expand-caret${themePanelOpen ? ' settings-page__expand-caret--open' : ''}`}>›</Text>
              </View>

              {themePanelOpen && (
                <View className='settings-page__panel'>
                  {/* 宠物照片壁纸：原有能力（选一张毛孩子的照片当背景，可随时清除） */}
                  <View className='settings-page__panel-pills'>
                    <View
                      className={`settings-page__ppill${petWallpaper ? ' settings-page__ppill--on' : ''}`}
                      onClick={handlePickWallpaper}
                    >
                      <Icon name='image' size={14} tone='primary' />
                      <Text className='settings-page__ppill-label'>
                        {wallpaperBusy ? '处理中...' : petWallpaper ? '换一张' : '选择照片'}
                      </Text>
                    </View>
                    {petWallpaper && (
                      <View className='settings-page__ppill settings-page__ppill--danger' onClick={handleClearWallpaper}>
                        <Icon name='x' size={14} tone='danger' />
                        <Text className='settings-page__ppill-label'>清除壁纸</Text>
                      </View>
                    )}
                  </View>
                  <Text className='settings-page__panel-hint'>
                    {petWallpaper
                      ? '照片会做轻度虚化并加一层遮罩，保证页面文字看得清。'
                      : '选一张毛孩子的照片当背景吧，只有你自己能看到。'}
                  </Text>
                </View>
              )}
            </View>
          </View>

          {/* —— 提醒：v2 是一行入口，点开展开三条真实开关 —— */}
          <View className='settings-page__row settings-page__row--top'>
            <View className='settings-page__row-icon settings-page__row-icon--gold'>
              <Icon name='bell' size={16} tone='gold' />
            </View>
            <View className='settings-page__row-main'>
              <View
                className='settings-page__theme-head'
                onClick={() => setNotifyPanelOpen(!notifyPanelOpen)}
              >
                <Text className='settings-page__row-label'>提醒</Text>
                {/* 右侧摘要：一眼看出开了几条（进面板前不用点开也能知道状态） */}
                <Text className='settings-page__theme-now'>
                  {NOTIFY_ITEMS.filter(i => notification[i.key]).length > 0
                    ? `已开 ${NOTIFY_ITEMS.filter(i => notification[i.key]).length} 项`
                    : '全部关闭'}
                </Text>
                <Text className={`settings-page__expand-caret${notifyPanelOpen ? ' settings-page__expand-caret--open' : ''}`}>›</Text>
              </View>

              {notifyPanelOpen && (
                <View className='settings-page__panel'>
                  {NOTIFY_ITEMS.map(item => (
                    <View key={item.key} className='settings-page__notify-row'>
                      <Text className='settings-page__notify-label'>{item.label}</Text>
                      <Switch
                        checked={notification[item.key]}
                        color={notifyColors[item.key]}
                        onChange={(e) => handleToggleNotification(item.key, e.detail.value)}
                      />
                    </View>
                  ))}
                  <Text className='settings-page__panel-hint'>提醒通过微信服务通知下发，需在小程序内授权接收。</Text>
                </View>
              )}
            </View>
          </View>
        </View>

        {/* ===== ⑤ 分组标题「数据管理」 ===== */}
        <View className='settings-page__sec-head'>
          <View className='settings-page__sec-dot' />
          <Text className='settings-page__sec-title'>数据管理</Text>
        </View>

        {/* ===== ⑥ 数据管理卡 =====
            v2 里没有这一组（原型只画了三张卡），但这里的每一条都是本页既有能力，
            删掉等于删功能，故整组保留并按 v2 的卡片语言重排。 */}
        <View className='settings-page__card'>
          {renderMenuRow({
            icon: 'stethoscope',
            label: '健康报告',
            desc: '查看毛孩子的健康趋势与报告',
            tone: 'primary',
            onClick: handleHealthReport,
          })}
          {renderMenuRow({
            icon: 'arrows-clockwise',
            label: '清除缓存',
            desc: '清掉本地缓存的图片与数据',
            tone: 'gold',
            onClick: handleClearCache,
          })}
          {renderMenuRow({
            icon: 'brain',
            label: 'AI 记忆纠错',
            desc: '纠正团团记错的事情',
            tone: 'gold',
            onClick: handleMemoryCorrection,
          })}
          {renderMenuRow({
            icon: 'share',
            label: '快速导出',
            desc: '把数据复制到剪贴板',
            tone: 'teal',
            value: isMember ? undefined : '会员',
            onClick: handleExportData,
          })}
          {renderMenuRow({
            icon: 'clipboard-text',
            label: '导出全部数据',
            desc: '云端 + 本地，生成 JSON',
            tone: 'teal',
            value: exportingData ? '导出中...' : undefined,
            onClick: handleExportAllData,
          })}
          {renderMenuRow({
            icon: 'x',
            label: '删除云端数据',
            desc: '永久删除云端数据，本地不受影响',
            tone: 'danger',
            danger: true,
            onClick: handleDeleteCloudData,
          })}
          {renderMenuRow({
            // 图标用 prohibit（禁止符 / 圆环加斜杠），不是 x：
            // 同组的「删除云端数据」已经用了 x（方块叉），两行挨着放会出现两个几乎一样的红叉，
            // 扫一眼分不出谁是谁（最终真机图复核时发现的）；prohibit 是圆形禁止符，
            // 与方块叉形状差异明显，也更贴"注销（终止这个账号）"的语义。
            icon: 'prohibit',
            label: '注销账号',
            desc: '提交后有 7 天冷静期，期间可取消',
            tone: 'danger',
            danger: true,
            onClick: handleRequestDeletion,
          })}
        </View>

        {/* ===== ⑦ 分组标题「关于」 ===== */}
        <View className='settings-page__sec-head'>
          <View className='settings-page__sec-dot' />
          <Text className='settings-page__sec-title'>关于</Text>
        </View>

        {/* ===== ⑧ 关于卡（v2 第三张卡：用户协议 / 隐私政策 / 新手指引 / 关于 / 退出登录） =====
            v2 把「用户协议 / 隐私政策」合成一行，本页**拆成两行**：
            两个页面的 type 参数不同（?type=user / ?type=privacy），合一行无法同时表达两个落点。 */}
        <View className='settings-page__card'>
          {renderMenuRow({
            icon: 'clipboard-text',
            label: '用户协议',
            tone: 'primary',
            onClick: () => handleAgreement('user'),
          })}
          {renderMenuRow({
            icon: 'book-open',
            label: '隐私政策',
            // 图标与「用户协议」刻意错开（协议用 clipboard-text、政策用 book-open）：
            // icons-fill 里没有 lock / shield 这类"隐私"图标，若两行都用 clipboard-text
            // 会出现两个长得一模一样的红方块，扫一眼分不出谁是谁（首版截图里就是这样）
            tone: 'teal',
            onClick: () => handleAgreement('privacy'),
          })}
          {/* 新手指引：常驻回看入口，2026-09-12 新增，**本批必须保留**（见 handleOnboardingGuide 注释） */}
          {renderMenuRow({
            icon: 'lightbulb',
            label: '新手指引',
            desc: '3 步了解星河宠记',
            tone: 'gold',
            onClick: handleOnboardingGuide,
          })}
          {renderMenuRow({
            icon: 'chat-circle',
            label: '意见反馈',
            tone: 'gold',
            onClick: () => Taro.navigateTo({ url: '/pagesUser/feedback/index' }),
          })}
          {/* 当前版本：只展示、不可点，故不传 onClick（renderMenuRow 里没有 onClick 就不挂箭头与点击） */}
          <View className='settings-page__row'>
            <View className='settings-page__row-icon settings-page__row-icon--primary'>
              <Icon name='check-circle' size={16} tone='primary' />
            </View>
            <View className='settings-page__row-main'>
              <Text className='settings-page__row-label'>当前版本</Text>
            </View>
            <Text className='settings-page__row-value'>{APP_VERSION}</Text>
          </View>

          {/* ===== ⑨ 退出登录（v2 放在同一张卡的末行，红字 + 红色图标底） ===== */}
          <View className='settings-page__row' onClick={handleLogout}>
            <View className='settings-page__row-icon settings-page__row-icon--danger'>
              <Icon name='sign-out' size={16} tone='danger' />
            </View>
            <View className='settings-page__row-main'>
              <Text className='settings-page__row-label settings-page__row-label--danger'>退出登录</Text>
            </View>
            <Text className='settings-page__row-arrow'>›</Text>
          </View>
        </View>

        {/* ===== ⑩ 注销倒计时提示（v2 没有；只有"已申请注销"的用户看得到）。
            用 `--notice-first` 把它排到「个人资料」卡之后、所有设置项之前：
            它是**全局状态提示**（账号即将被永久删除），埋在页面最底部会让用户错过；
            JSX 里仍留在原位（不与"注销账号"那一行缠在一起），排序交给样式的 order。 ===== */}
        {privacyStatus?.accountDeletionRequested && deletionCountdown && (
          <View className='settings-page__deletion-notice settings-page__deletion-notice--notice-first'>
            <Text className='deletion-notice__title'>账号注销中</Text>
            <Text className='deletion-notice__desc'>
              您的账号将于{deletionCountdown}被永久注销删除。冷静期内可取消。
            </Text>
            <View className='deletion-notice__action' onClick={handleCancelDeletion}>
              <Text className='deletion-notice__cancel'>取消注销</Text>
            </View>
          </View>
        )}

        {/* ===== 个人资料（2026-09-12 IA 第 2a 批：原 pagesUser 分包的 profile 页并入本页）=====
            【为什么它排在最上面】「我的」页点头像、点「编辑」都直接落到本页，用户来这里
            十有八九就是想改资料；而 v2 的「设置」屏没有这张卡（原型不必编辑资料），
            所以它是"v2 没有、但本仓必须有"的常驻区块。
            【为什么 JSX 写在末尾却显示在最上面】视觉顺序由样式里的 `order: -2` 控制
            （见 index.scss 的 .settings-page__profile-card）—— 代码上它仍归"资料"这一块、
            不与「账号」卡的渲染分支缠在一起，改起来只动一处。
            （取 -2 而不是 -1：注销倒计时提示也吃 negative order，错开一档就不靠 DOM 顺序决胜负。）
            未登录时不渲染（与 profile 页一致：没登录谈不上改资料，登录入口在「我的」页）。 */}
        {isAuthenticated && (
          <View className='settings-page__card settings-page__profile-card'>
            <View className='settings-page__sec-head settings-page__sec-head--inset'>
              <View className='settings-page__sec-dot' />
              <Text className='settings-page__sec-title'>个人资料</Text>
            </View>
            <View className={`settings-page__profile${profileHighlight ? ' settings-page__profile--highlight' : ''}`}>
              {/* 微信端用原生组件（chooseAvatar + nickname）：Taro 3.6 编译层不支持这两个属性，
                  必须原生组件才能跟随微信头像/昵称（否则 errno 112 / 属性被模板丢弃） */}
              {isWeapp() ? (
                <wechat-profile
                  nickname={nicknameDraft}
                  avatar={avatarDraft || user?.avatar || ''}
                  onChooseavatar={handleChooseAvatar}
                  onNickchange={handleNicknameChange}
                />
              ) : (
                <View className='settings-page__profile-row'>
                  {/* 非微信端（H5 预览）防御性分支：头像按钮走相册选择 */}
                  <Button className='settings-page__profile-avatar-btn' onClick={handleChooseAvatar}>
                    {avatarDraft ? (
                      <Image className='settings-page__profile-avatar-img' src={avatarDraft} mode='aspectFill' />
                    ) : user?.avatar ? (
                      <Image className='settings-page__profile-avatar-img' src={user.avatar} mode='aspectFill' />
                    ) : (
                      <View className='settings-page__profile-avatar-placeholder'>
                        <Icon name='user' size={28} tone='primary' />
                      </View>
                    )}
                  </Button>
                  <Input
                    className='settings-page__profile-nickname-input'
                    value={nicknameDraft}
                    placeholder='输入昵称'
                    onInput={(e) => setNicknameDraft(e.detail.value)}
                  />
                </View>
              )}
            </View>
            <Text className='settings-page__profile-tip'>头像昵称可跟随微信，也可自定义；保存后全局同步展示</Text>
            <Button
              className='settings-page__save-btn'
              loading={saving}
              disabled={saving}
              onClick={handleSaveProfile}
            >
              保存
            </Button>
          </View>
        )}

        {/* 底部安全区：本页是普通页面（不是 tab 页）→ 不需要给自定义 tabBar 让位，
            但保留安全区内边距，别让最后一张卡贴着屏幕底 */}
        <View className='settings-page__safe-bottom' />
      </View>

      {showDeletionModal && (
        <View className='settings-page__modal'>
          <View className='settings-page__modal-content'>
            <AccountDeletionConfirm
              confirmCode={deletionConfirmCode}
              onConfirm={handleDeletionConfirm}
              onCancel={handleDeletionCancel}
              loading={deletionLoading}
            />
          </View>
        </View>
      )}
    </View>
  )
}
