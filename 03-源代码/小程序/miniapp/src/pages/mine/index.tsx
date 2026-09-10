/**
 * 我的页面
 * 沉浸式头部（头像 + 昵称 + 会员徽章，融入页面暖色渐变背景，无双色横幅）
 * 数据概览 3 列 + 家庭卡（星澜小筑）+ 分组菜单（数据服务/管理/设置-主题皮肤）+ 退出登录
 * 保留原有业务逻辑：登录校验、打卡/回忆统计、会员状态、退出登录
 *
 * 【2026-09-11 第二轮：删掉「我的毛孩子」切换器】
 * 用户在真机上反馈该区块与紧跟其后的「星澜小筑」家庭卡**语义与视觉双重打架**：
 * 两块都是"一横排头像/图标 + 一个入口"的卡片，挨在一起抢注意力；
 * 而毛孩子本来就归属家庭（家庭页里宠物就是"成员"），这里再单开一块是重复表达。
 * 因此整块移除（tsx + 样式一并清理，不留死样式）。
 * 影响：本页不再提供"切换当前宠物"。其余页面均有切换入口（打卡/日记/趋势/疫苗/
 * 食物查询/创作页的 PetSwitcher），故不损失能力。
 * 毛孩子的数量信息没有丢：并入家庭卡的信息胶囊（N 只毛孩子）。
 */
import { View, Text, ScrollView, Image } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { useEffect, useState } from 'react'
import { useAuthStore } from '../../stores/authStore'
import { usePetStore } from '../../stores/petStore'
import { useMembershipStore } from '../../stores/membershipStore'
import { useFamilyStore } from '../../stores/familyStore'
import { useThemeStore, type ThemeKey } from '../../stores/themeStore'
import { getCheckinStats } from '../../services/checkinService'
import { redirectToLoginIfNeeded } from '../../utils/authGuard'
import { timelineService } from '../../services/timelineService'
import PageLoading from '../../components/PageLoading'
import { useThemeClass } from '../../hooks/useThemeClass'
import './index.scss'
// 家庭卡（星澜小筑）的头像：品牌静态图（猫狗同框）——家庭数据里没有头像字段，
// 所以用这张统一的品牌形象；与宠物形象同一套画风（3D 黏土）与同一套"方形满幅"语言。
// 128×128 / 256 色压缩版（14KB），放在页面级 assets 里，不占分包、不动共用目录。
import familyAvatar from './assets/family-avatar.png'
import { Icon, Illustration, PageBackground, type FillIconName } from '../../components'

/** 主题配置（对齐原型四季色） */
const THEME_OPTIONS: { key: ThemeKey; label: string; colors: [string, string] }[] = [
  { key: 'spring', label: '春', colors: ['#8AD390', '#54B460'] },
  { key: 'summer', label: '夏', colors: ['#7CC6F0', '#2FA8E8'] },
  { key: 'autumn', label: '秋', colors: ['#FFA082', '#FF6B3D'] },
  { key: 'winter', label: '冬', colors: ['#A5B1F7', '#6C7CF0'] },
]

/** 计算养宠时长（年/月） */
function calcPetDuration(createdAt?: string): string {
  if (!createdAt) return ''
  const start = new Date(createdAt)
  // 用 Number.isNaN 而非全局 isNaN（项目 eslint 禁用全局 isNaN；Number 版本也不会先转数字产生误判）
  if (Number.isNaN(start.getTime())) return ''
  const now = new Date()
  const months = (now.getFullYear() - start.getFullYear()) * 12 + (now.getMonth() - start.getMonth())
  if (months < 1) return '刚刚开始'
  if (months < 12) return `养宠 ${months} 个月`
  return `养宠 ${Math.floor(months / 12)} 年`
}

/**
 * 菜单分组（对齐原型：数据服务 / 管理 / 设置）
 *
 * 2026-09-11：图标由 emoji 改为面性图标。
 * 原来 8 行菜单直接渲染 emoji（📄💉👑🏆📈🎁💬⚙️），与全站图标体系不一致，
 * 且 emoji 在不同机型上字形差异大、颜色无法跟随主题。
 *
 * 2026-09-11（本轮）：再补一层「分组色系」——原来 8 行的图标底**全是同一个淡橙**，
 * 三组之间没有识别度、整块像一张糊住的表。现在每组一个 tone（组内图标与底色同源，
 * 组间不同色），分组标题左侧再点一个同色小圆点，扫一眼就能分清三块。
 */
const MENU_GROUPS: {
  title: string
  /** 分组色系（须是 Icon 支持的 tone；组内图标与底色同源，避免"底变色、图标不变"） */
  tone: 'primary' | 'gold' | 'teal'
  items: { icon: FillIconName; label: string; url: string }[]
}[] = [
  {
    title: '数据服务',
    tone: 'primary',
    items: [
      { icon: 'clipboard-text', label: '健康报告', url: '/pagesPet/trends/index' },
      { icon: 'syringe', label: '疫苗日历', url: '/pagesPet/vaccine/index' },
      { icon: 'crown', label: '会员中心', url: '/pagesUser/member/index' },
      { icon: 'trophy', label: '成就墙', url: '/pagesPet/achievement/index' },
    ],
  },
  {
    title: '管理',
    tone: 'gold',
    items: [
      { icon: 'chart-line', label: '效果追踪', url: '/pagesUser/effect-tracking/index' },
      { icon: 'handshake', label: '邀请好友', url: '/pagesUser/invite/index' },
      { icon: 'chat-circle', label: '意见反馈', url: '/pagesUser/feedback/index' },
    ],
  },
  {
    title: '设置',
    tone: 'teal',
    items: [
      { icon: 'gear', label: '设置', url: '/pagesUser/settings/index' },
    ],
  },
]

export default function Mine() {
  const user = useAuthStore(state => state.user)
  const isAuthenticated = useAuthStore(state => state.isAuthenticated)
  const isInitialized = useAuthStore(state => state.isInitialized)
  const logout = useAuthStore(state => state.logout)
  // 只取列表与拉取方法：本轮删掉宠物切换器后，本页不再需要 currentPet / switchPet
  const { pets, fetchPets } = usePetStore()
  const membership = useMembershipStore(state => state.membership)
  // 多成员共同养宠：当前家庭与家庭成员（人）列表（2026-08-24）
  const currentFamily = useFamilyStore(state => state.currentFamily)
  const familyUsers = useFamilyStore(state => state.users)
  const [pageReady, setPageReady] = useState(false)
  const [totalCheckins, setTotalCheckins] = useState(0)
  const [totalMemories, setTotalMemories] = useState(0)
  const [themePanelOpen, setThemePanelOpen] = useState(false)
  // 头像加载失败标记：Image 触发 onError 时置 true 退回昵称占位，避免显示裂图
  const [avatarLoadFailed, setAvatarLoadFailed] = useState(false)
  const themeClass = useThemeClass()

  // tab 页常驻：每次从其他页切回「我的」时刷新数据
  Taro.useDidShow(() => {
    if (!isAuthenticated || !user) return
    // 拉最新宠物档案：形象定制/编辑页保存后回到 tab 常驻的「我的」页时，
    // 头像等字段必须同步（在线时以服务端为权威纠正 store；离线时本地缓存与 store 同源，无副作用）。
    // fetchPets 内部自带 try/catch（失败只写 error 状态不会 reject），且会保留当前选中宠物。
    void usePetStore.getState().fetchPets(user.id)
    const refreshFamily = async () => {
      try {
        // 先拉家庭列表（内部选中当前家庭），再拉家庭成员（人）列表
        await useFamilyStore.getState().fetchFamilies()
        await useFamilyStore.getState().fetchUsers()
      } catch {
        // 家庭接口失败不阻塞「我的」页展示
      }
    }
    refreshFamily()
  })

  // 头像地址变化时重置加载失败标记：mine 是 tab 页常驻，同一会话内在 profile 换头像或
  // 图片瞬断恢复后，如果不重置会一直卡在昵称占位、Image 也不再重试。
  useEffect(() => {
    setAvatarLoadFailed(false)
  }, [user?.avatar])

  /**
   * 顶部导航栏标题：固定为「{用户昵称}的家庭」—— 跟"人"走，不跟"当前宠物"走。
   *
   * 【为什么钉在这一页】用户真机反馈：最顶上会显示「烧鸡的家庭 / 烧鸭的家庭」，切宠物时还跟着变。
   *   要求改成按用户昵称固定（昵称"不忘" → 「不忘的家庭」）。
   *   「我的」是切宠物之后停留的主页面，标题必须由它自己钉住：否则在
   *   **导航栏全局只有一个**的宿主里（Taro H5 / 安卓壳），会残留上一个页面（创作页按宠物名设过）的标题。
   * 【不动什么】家庭卡里的「星澜小筑」是家庭记录名，用户明确要求保持不变；这里只改顶栏标题。
   * 【回退】昵称尚未加载（首帧/未登录）时用页面配置里的「我的」，不留空白标题。
   */
  useEffect(() => {
    const nickname = user?.nickname?.trim()
    Taro.setNavigationBarTitle({ title: nickname ? `${nickname}的家庭` : '我的' })
  }, [user?.nickname])

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
        // 多成员共同养宠：初始化时加载家庭信息（useDidShow 已负责切回页面时刷新）
        try {
          await useFamilyStore.getState().fetchFamilies()
          await useFamilyStore.getState().fetchUsers()
        } catch {
          // 家庭接口失败不阻塞主流程
        }
        const fetchedPets = usePetStore.getState().pets
        // 统计口径（2026-09-11 审查 P1-3 修复）：这一格标签是「打卡天数」，必须累加
        // 按日期去重后的 `totalDays`。原来累加的是 `totalCheckins`（打卡**条数**）——
        // 3 只宠物各打卡 100 天会显示「300 打卡天数」，多宠场景把错误直接放大。
        let totalC = 0
        if (fetchedPets.length > 0 && user?.id) {
          for (const pet of fetchedPets) {
            try {
              const stats = await getCheckinStats(pet.id, user.id)
              totalC += stats.totalDays
            } catch {
              // 单个宠物统计失败不影响整体
            }
          }
        }
        setTotalCheckins(totalC)
        try {
          const moments = await timelineService.getMoments()
          setTotalMemories(moments.length)
        } catch {
          setTotalMemories(0)
        }
      } catch (err) {
        // 静默处理错误
      }
      setPageReady(true)
    }
    loadData()
  }, [isInitialized, isAuthenticated, user])

  const navigateTo = (url: string) => {
    if (!url) {
      Taro.showToast({ title: '功能开发中', icon: 'none' })
      return
    }
    Taro.navigateTo({ url })
  }

  const handleLogout = () => {
    Taro.showModal({
      title: '退出登录',
      content: '确定要退出登录吗？',
      success: (res) => {
        if (res.confirm) {
          logout()
          Taro.reLaunch({ url: '/pagesUser/login/index' })
        }
      },
    })
  }

  const handleThemeSelect = (theme: ThemeKey) => {
    useThemeStore.getState().setTheme(theme)
  }

  if (!pageReady) {
    return <PageLoading />
  }

  const isVip = membership?.level !== 'free'
  const currentTheme = useThemeStore.getState().current
  const petDuration = calcPetDuration(pets[0]?.createdAt)
  // 我的家庭角色：优先按家庭成员列表匹配，列表为空时按家庭创建者兜底
  const myFamilyRole = familyUsers.find(u => u.userId === user?.id)?.role
    || (currentFamily && currentFamily.userId === user?.id ? 'owner' : null)
  // 家庭成员数：列表为准，未加载时用家庭 memberCount 兜底，再兜底算 1（至少自己）
  const familyMemberCount = familyUsers.length
    || currentFamily?.memberCount
    || 1

  return (
    <ScrollView className={`mine-page ${themeClass}`} scrollY>
      {/* 全屏动态背景光斑层 */}
      <PageBackground />

      {/* ===== 个人名片卡（2026-09-11 重构，第二版：上下分层） =====
          改版前这里是「页头插画条 + 无卡头部」两块：页头插画条在 156rpx 的扁容器里被压得
          看不清，且与下面的头像信息构成**两个页头**；数据概览另占一张白卡，首屏被切得七零八落。
          第一版合并后用了主色实色渐变（primary→primary-dark），用户反馈「颜色我不喜欢，
          看起来很奇怪」—— 整页是奶油米底 + 白卡，顶上一块高饱和橙红属视觉权重过载，
          与页面气质割裂。
          第二版曾把插画当**整卡底图 + 左侧白色渐变遮罩**，结果遮罩把插画左半边的猫整个抹掉了，
          只剩右侧一只狗（见 index.scss 该段注释）。
          本版改为**上下分层**：上半是插画横幅（容器按 16:9 取，与插画同比例 → aspectFill 铺满
          又不裁主体），下半是白底信息区（文字在浅底上，**完全不需要遮罩**）。
          猫狗完整可见、文字可读性最好，也不再依赖遮罩这种"两头不讨好"的手段。 */}
      <View className='mine-card'>
        {/* 卡片上半：品牌插画横幅（page-mine：羊毛毡猫狗，与首页主视觉同一套 IP）。
            容器宽高比照 16:9 取（686rpx 宽 → 386rpx 高），与插画原始比例一致，
            所以 aspectFill 既铺满又**不裁切主体**（前两版把插画当整卡底图，比例差得远，
            结果只露出狗、猫被遮罩抹掉了）。
            ⚠️ 插画走服务器且 Illustration 在 onError 时整块不渲染，
            所以横幅自身必须带浅奶油兜底色 —— 弱网/失败时是"浅奶油纯色横幅"而不是空框。 */}
        <View className='mine-card__banner'>
          <Illustration name='page-mine' fill mode='aspectFill' className='mine-card__art' />
        </View>

        {/* 卡片下半：白色信息区（文字直接在浅底上，可读性最好，不需要任何遮罩） */}
        <View className='mine-card__body'>
          <View className='mine-card__top'>
            <View className='mine-avatar' onClick={() => navigateTo('/pagesUser/profile/index')}>
              {/* 有头像且未加载失败就显示图片；头像为空或加载失败（onError）才退回昵称首字占位 */}
              {user?.avatar && !avatarLoadFailed ? (
                <Image
                  className='mine-avatar-img'
                  src={user.avatar}
                  mode='aspectFill'
                  onError={() => setAvatarLoadFailed(true)}
                />
              ) : (
                <Text className='mine-avatar-text'>
                  {/* Array.from 按 Unicode 码点取首字符，避免 emoji 代理对被 charAt 截成半个乱码 */}
                  {user?.nickname ? Array.from(user.nickname)[0] : '👤'}
                </Text>
              )}
            </View>

            <View className='mine-card__info'>
              <View className='mine-card__name-row'>
                <Text className='mine-card__name'>{user?.nickname || '用户'}</Text>
                {isVip && (
                  <View className='mine-vip-badge'>
                    <Icon name='crown' size={11} tone='gold-deep' />
                    <Text className='mine-vip-badge__text'>星钻会员</Text>
                  </View>
                )}
              </View>
              <Text className='mine-card__desc'>
                {pets.length > 0 ? `铲屎官 · ${petDuration}` : '还没有添加宠物'}
              </Text>
            </View>

            {/* 编辑按钮：白底胶囊 + 铅笔图标（对齐全站"按钮必须带图标"的约定） */}
            <View className='mine-edit-btn' onClick={() => navigateTo('/pagesUser/profile/index')}>
              <Icon name='pencil-simple' size={13} tone='primary' />
              <Text className='mine-edit-btn__text'>编辑</Text>
            </View>
          </View>

          {/* 数据条 */}
          <View className='mine-card__stats'>
            <View className='mine-stat'>
              <Icon name='paw-print' size={17} tone='primary' />
              <Text className='mine-stat__num'>{pets.length}</Text>
              <Text className='mine-stat__label'>宠物</Text>
            </View>
            <View className='mine-stat__divider' />
            <View className='mine-stat'>
              <Icon name='calendar-check' size={17} tone='gold' />
              <Text className='mine-stat__num'>{totalCheckins}</Text>
              <Text className='mine-stat__label'>打卡天数</Text>
            </View>
            <View className='mine-stat__divider' />
            <View className='mine-stat'>
              <Icon name='camera' size={17} tone='teal' />
              <Text className='mine-stat__num'>{totalMemories}</Text>
              <Text className='mine-stat__label'>回忆</Text>
            </View>
          </View>
        </View>
      </View>

      {/* ===== 家庭信息卡（星澜小筑，2026-09-11 第二轮重做） =====
          改版前它是一张与菜单卡同款的白卡：淡金圆底 + 家庭名 + 一行灰字 + 一个 › 箭头。
          夹在「我的毛孩子」切换器与三组白卡菜单之间，整段从上到下全是白底，
          和菜单糊成一片，行动指向也弱（只有一个灰箭头）。
          本版（切换器已删除，它成为名片卡之下的第一个视觉主体）：
            ① 底色「奶油白 + 主色/金色淡 tint」的暖渐变，右上角再叠一层金色柔光 →
               与下方纯白菜单卡拉开层次，一眼能分辨；
            ② 左侧徽章改 house 图标（小筑 = 家）压金→主色渐变圆（88rpx）+ 白描边环 ——
               环用白色而不是金色：卡底本身就是暖金调，金色环会融进底色看不见；
            ③ 家庭名放大加粗，右侧跟一枚角色胶囊（创建者 crown / 成员 user）；
            ④ 信息行改两枚胶囊：N 位成员（users，金 tint）+ N 只毛孩子（paw-print，主色 tint），
               把被删掉的「我的毛孩子」里唯一有用的事实（有几只）保留下来；
            ⑤ 右侧「进入」从裸文字换成主色渐变真按钮（文字 + 图标 + 投影 + 按压回弹），
               对齐全站"按钮五要素"（渐变/投影/胶囊/按压/图标）约定。
          空态（还没建家庭）沿用同一套外壳，只换文案与图标口径。
          配色一律走主题变量或 rgba(var(--x-rgb), α)：四季与星空主题下整体跟随，
          卡片在星空主题里仍是浅底，所以文字色继续由下方 .theme-starry 兜底钉回深色。 */}
      <View className='mine-family-card' onClick={() => Taro.navigateTo({ url: '/pages/family/index' })}>
        {/* 右上角柔光：纯装饰层，不参与交互（pointer-events 由父级点击冒泡统一处理） */}
        <View className='mine-family-card__glow' />

        {/* 家庭头像位：2026-09-11 用户要求「星澜小筑也要放个头像」。
            原来是"圆形渐变徽章 + house 图标"；现改为与宠物头像同一套语言的**方卡**：
            品牌家庭形象（猫狗同框）铺满 + 白环描边（见 scss）。
            mode='aspectFill' 与宠物头像一致：铺满方框、不留白。 */}
        <View className='mine-family-badge'>
          <Image className='mine-family-badge__img' src={familyAvatar} mode='aspectFill' />
        </View>

        <View className='mine-family-info'>
          <View className='mine-family-name-row'>
            <Text className='mine-family-name'>
              {currentFamily ? (currentFamily.name || '我的家庭') : '创建或加入家庭'}
            </Text>
            {currentFamily && myFamilyRole && (
              <View className='mine-family-role'>
                <Icon name={myFamilyRole === 'owner' ? 'crown' : 'user'} size={12} tone='gold-deep' />
                <Text className='mine-family-role__text'>
                  {myFamilyRole === 'owner' ? '创建者' : '成员'}
                </Text>
              </View>
            )}
          </View>

          {currentFamily ? (
            <View className='mine-family-chips'>
              <View className='mine-family-chip mine-family-chip--members'>
                <Icon name='users' size={13} tone='gold-deep' />
                <Text className='mine-family-chip__text'>{familyMemberCount} 位成员</Text>
              </View>
              <View className='mine-family-chip mine-family-chip--pets'>
                <Icon name='paw-print' size={13} tone='primary' />
                <Text className='mine-family-chip__text'>{pets.length} 只毛孩子</Text>
              </View>
            </View>
          ) : (
            <Text className='mine-family-desc'>和家人一起记录毛孩子的每一天</Text>
          )}
        </View>

        <View className='mine-family-enter'>
          <Text className='mine-family-enter__text'>{currentFamily ? '进入' : '去创建'}</Text>
          <Icon name={currentFamily ? 'caret-right' : 'plus'} size={12} tone='white' />
        </View>
      </View>

      {/* ===== 分组菜单（原型对齐：数据服务 / 管理 / 设置） ===== */}
      {MENU_GROUPS.map(group => (
        <View key={group.title} className='mine-menu-group'>
          {/* 组标题：左侧一个同色小圆点，让三组在扫视时能立刻分开 */}
          <View className='mine-menu-group-head'>
            <View className={`mine-menu-group-dot mine-menu-group-dot--${group.tone}`} />
            <Text className='mine-menu-group-title'>{group.title}</Text>
          </View>
          <View className='mine-menu-card'>
            {group.items.map((item, itemIndex) => (
              <View
                key={item.label}
                /* 只有"整张卡的最后一个可见行"才去掉底部分隔线。
                   "设置"组下面还跟着「主题皮肤」行，若它也吃 --last，
                   两行之间会缺一条分隔线（肉眼可见的断口）—— 故排除该组。 */
                className={`mine-menu-item ${itemIndex === group.items.length - 1 && group.title !== '设置' ? 'mine-menu-item--last' : ''}`}
                onClick={() => navigateTo(item.url)}
              >
                <View className={`mine-menu-icon-wrap mine-menu-icon-wrap--${group.tone}`}>
                  <Icon name={item.icon} size={18} tone={group.tone} />
                </View>
                <Text className='mine-menu-label'>{item.label}</Text>
                <Text className='mine-menu-arrow'>›</Text>
              </View>
            ))}
            {/* 设置组内追加主题皮肤入口 */}
            {group.title === '设置' && (
              <>
                <View className='mine-menu-item mine-menu-item--last' onClick={() => setThemePanelOpen(!themePanelOpen)}>
                  <View className='mine-menu-icon-wrap mine-menu-icon-wrap--gradient'>
                    {/* 图标尺寸与同组菜单项一致（此前是 16，比同组的 18 小一圈） */}
                    <Icon name='palette' size={18} tone='white' />
                  </View>
                  <View className='mine-menu-label-wrap'>
                    <Text className='mine-menu-label'>主题皮肤</Text>
                    <Text className='mine-menu-theme-desc'>跟随季节</Text>
                  </View>
                  <View className='mine-menu-theme-dots'>
                    {THEME_OPTIONS.map(opt => (
                      <View
                        key={opt.key}
                        className='mine-theme-dot'
                        style={{ background: `linear-gradient(135deg, ${opt.colors[0]}, ${opt.colors[1]})` }}
                      />
                    ))}
                  </View>
                  <Text className='mine-menu-arrow'>{themePanelOpen ? '˄' : '›'}</Text>
                </View>
                {themePanelOpen && (
                  <View className='mine-theme-panel'>
                    <Text className='mine-theme-panel-hint'>选一套喜欢的季节配色，整站同步生效</Text>
                    <View className='mine-theme-grid'>
                      {THEME_OPTIONS.map(opt => (
                        <View
                          key={opt.key}
                          className={`mine-theme-choice ${currentTheme === opt.key ? 'mine-theme-choice--active' : ''}`}
                          onClick={() => handleThemeSelect(opt.key)}
                        >
                          <View
                            className='mine-theme-choice-dot'
                            style={{ background: `linear-gradient(135deg, ${opt.colors[0]}, ${opt.colors[1]})` }}
                          />
                          <Text className='mine-theme-choice-label'>{opt.label}</Text>
                        </View>
                      ))}
                    </View>
                  </View>
                )}
              </>
            )}
          </View>
        </View>
      ))}

      {/* ===== 退出登录（保持克制：白底描边 + 图标，不与上面的菜单抢注意力） ===== */}
      <View className='mine-section'>
        <View className='mine-logout-btn' onClick={handleLogout}>
          <Icon name='sign-out' size={16} tone='danger' />
          <Text className='mine-logout-btn__text'>退出登录</Text>
        </View>
      </View>

      <View className='mine-bottom-safe' />
    </ScrollView>
  )
}
