/**
 * 我的页面
 * 沉浸式头部（头像 + 昵称 + 会员徽章，融入页面暖色渐变背景，无双色横幅）
 * 结构（按高保真 v2「我的」屏对齐；标 ★ 的两块是**本仓保留、v2 里没有**的）：
 *   ① 名片卡（自有宽幅全家福横幅 + 头像/昵称/编辑）
 *   ② 数据条 statbar（4 项：陪伴天数 / 打卡次数 / 照片回忆 / 毛孩子）
 *   ③ ★ 家庭卡（星澜小筑）—— v2 无此块，是本页既有的家庭入口，保留
 *   ④ 内容分组菜单：我的宠物 / 家人与家庭 / 作品与回忆（v2 顺序）
 *   ⑤ 会员卡 memcard（金色渐变；非会员＝引导态）
 *   ⑥ ★ 工具分组菜单：数据服务 / 管理 / 设置（含主题皮肤）—— v2 无此三组，是既有功能入口，保留
 *   ⑦ 退出登录
 * 保留原有业务逻辑：登录校验、打卡/照片统计、会员状态、退出登录
 *
 * 【2026-09-12 第三轮（本批）：按 v2 补齐独立审查判定「缺」的三块】
 *   真机/审查结论：v2 的「我的」屏 7 块里，本页此前缺 3 块（探针 0 命中）——
 *   `statbar` 四项数据条、`家人与家庭`/`作品与回忆` 两组菜单、金色渐变会员卡。
 *   1. **新增 statbar 四项数据条**（独立白玻璃卡，见 JSX 中 `.mine-statbar` 段注释）。
 *      原先这 4 类统计是挤在名片卡里的一行 3 格（宠物 / 打卡天数 / 回忆）：
 *      既与 v2 版式不符，又会在新增数据条后**同屏重复显示同一批数字**，
 *      故整块并入 statbar（tsx 与样式一并删除，不留死样式）。
 *   2. **新增「我的宠物」「家人与家庭」「作品与回忆」三组菜单**（v2 的 menulist 结构）。
 *      原有「数据服务 / 管理 / 设置」三组**保留**（v2 里没有这三组，但它们是本页既有
 *      功能入口，删掉等于删功能），排在会员卡之后作为"工具型"分组。
 *   3. **新增会员卡 memcard**（v2 的金色渐变卡）。会员态走 `useMembership()`
 *      （原来是直接读 membershipStore，未加载时 `level !== 'free'` 会误判成会员）；
 *      非会员＝引导态。卡片文案不照抄 v2 的"解锁无限回忆录/高清导出"——
 *      那两项权益在会员中心并不存在，按"不得承诺不存在的权益"改为**真实权益清单**。
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
import { useFamilyStore } from '../../stores/familyStore'
import { useThemeStore, type ThemeKey } from '../../stores/themeStore'
// 打卡服务：本批两者都要用 ——
//   getCheckins     = 会**发请求并回写本地缓存**的那个（先拉）
//   getCheckinStats = 只读本地缓存算统计、自己不发请求的那个（后算）
// 【为什么两个必须一起用】只调 getCheckinStats 时，冷启动下本地缓存是空的 → statbar
// 「打卡次数」恒为 0（这就是 2026-09-12 本批修复的缺陷），详见 loadData 里「先拉取再统计」注释。
import { getCheckins, getCheckinStats } from '../../services/checkinService'
import { redirectToLoginIfNeeded } from '../../utils/authGuard'
import { timelineService } from '../../services/timelineService'
import PageLoading from '../../components/PageLoading'
import { useThemeClass } from '../../hooks/useThemeClass'
// 会员体系 Hook（2026-09-12 本批改用）：会员卡的"是不是会员/到期日"都从这里取，
// 它自带 initUser + fetchMembership + fetchOrders 三个副作用，本页不再自己读 store
// —— 直接读 membershipStore 时 `membership` 为 null（还没拉回来）会被算成"非 free 等级"，
// 徽章与会员卡都会误判成会员态。
import { useMembership } from '../../hooks/useMembership'
// 日期口径统一走 utils/date（全站唯一实现）：
//   daysSinceLocalDate —— 陪伴天数（自然日差，跨时区/夏令时安全）
//   formatPetAge      —— 宠物年龄文案（「3岁」这类，全站统一口径）
//   localDateString   —— 会员到期日的本地日历日（不能 slice ISO 串，那取的是 UTC 日）
import { daysSinceLocalDate, formatPetAge, localDateString } from '../../utils/date'
import './index.scss'
// 家庭卡（星澜小筑）的头像：**多猫狗一家人**的品牌家庭形象（1:1 正方形，2026-09-12 由 5 号生成）。
// 【为什么用这张固定的合影、而不是四季图】头像表达的是"谁是一家人"这个**品牌身份**，
// 它不该随季节换 —— 换季换的是页面配色与氛围（见 themeStore），不是"家里成员换了一批"；
// 用户切到冬季看到另一批猫狗，会以为自己的毛孩子被换掉了（用户 2026-09-12 真机明确要求
// "星澜小筑的头像也没有更新，替换成多猫狗场景体现一家人"）。家庭数据里没有头像字段，故统一用这张。
// 与宠物形象同一套画风（3D 黏土）与同一套"方形满幅 + 白环"语言（见 scss 的 .mine-family-badge）。
// 旧图 family-avatar.png 已随本批替换**于 2026-09-12 删除**（全 src 检索确认已无任何引用），
// 主包因此少约 14KB —— 这条已是既成事实，不存在"留给谁去收尾"的遗留动作；
// assets 目录现在只剩两张 jpg：下面这个 family-avatar.jpg 与再往下的 family-hero.jpg。
import familyAvatar from './assets/family-avatar.jpg'
// 名片卡横幅：自有宽幅「多猫狗一家人」全家福（16:9，2026-09-12 由 5 号生成，体积 ≤70KB）。
// 【为什么不再用线上的 Illustration name='page-mine'】线上四季图里 spring/autumn/winter 实测是
// **1254×1254（1:1）**，塞进 686×386rpx（16:9）的横幅 + aspectFill = 居中裁掉约 44% 高度：
// 猫的耳朵与狗的头被切掉、右侧留一大片空绿（用户上一轮已就"图片根本不符合控件大小、
// 硬塞看得很难受"提过两次）。本图与横幅容器同比例 → aspectFill 既铺满又**零裁切**。
// 图放在页面级 assets/ 下（本轮由 5 号落盘），不占分包、不动共用目录。
import familyHero from './assets/family-hero.jpg'
// Illustration 随上面这次替换一并移除（本页再无其它用途），不留死 import
import { Icon, PageBackground, type FillIconName } from '../../components'
// 自定义 tabBar 的选中态广播 hook（本页 = tabBar 第 4 项，路径写错 tsc 直接报错）
import { useTabBarSelected } from '../../constants/tabBar'

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
 * 菜单项：本页一个可点入口。
 *
 * 【图标为什么是面性图标】2026-09-11 起 8 行菜单由 emoji 改为面性图标（原来直接渲染
 * 📄💉👑🏆📈🎁💬⚙️，与全站图标体系不一致，emoji 在不同机型上字形差异大、颜色也不跟主题）。
 *
 * 【分组色系】2026-09-11 补：原来所有行的图标底**全是同一个淡橙**，三组之间没有识别度、
 * 整块像一张糊住的表。现在每组一个 tone（组内图标与底色同源，组间不同色），
 * 分组标题左侧再点一个同色小圆点，扫一眼就能分清各组。
 * 注意：高保真 v2 是**逐行**配色（tone-a/b/c/d 混搭），本页沿用仓库既有的**逐组**配色 ——
 * 独立审查对 v2 那屏的原话是"紫/蓝/绿杂色打破整体色彩统一性"，逐组同色在这一点上更好。
 */
interface MineMenuItem {
  /** 面性图标名（必须是 components/icons-fill.ts 里存在的 key，否则图标不渲染） */
  icon: FillIconName
  /** 主文案（文案以高保真 v2 原型为准，除下面注释说明的例外不改写） */
  label: string
  /** 目标路由：必须是 src/app.config.ts 里**已注册**的页面（本页只做 navigateTo） */
  url: string
  /** 次要说明行（如当前宠物的「名字 · 品种 · 年龄」）；没有就整行不渲染 */
  desc?: string
}

/** 菜单分组：一个标题 + 一张卡 + 组内若干行 */
interface MineMenuGroup {
  title: string
  /** 分组色系（须是 Icon 支持的 tone；组内图标与底色同源，避免"底变色、图标不变"） */
  tone: 'primary' | 'gold' | 'teal'
  items: MineMenuItem[]
  /** 组标题右侧的引导小字（v2 只在「我的宠物」组有「点进档案 ›」） */
  more?: string
}

/**
 * 内容型分组（v2 顺序：我的宠物 → 家人与家庭 → 作品与回忆），排在会员卡**之前**。
 *
 * @param primaryPetDesc 当前宠物的身份文案（`可乐 · 橘猫 · 3岁`）；没有宠物时传空串，
 *   「宠物档案」那一行就只显示标题（不编造宠物信息）
 * @param petCount 宠物数量：用来决定"添加"那行的文案（一只都还没有时说"第二位"是不对的）
 */
function buildContentGroups(primaryPetDesc: string, petCount: number): MineMenuGroup[] {
  return [
    {
      title: '我的宠物',
      tone: 'primary',
      // v2 的「点进档案 ›」是纯展示的引导小字（不是按钮），这里照抄文案
      more: '点进档案 ›',
      items: [
        // 宠物档案（原为「宠物」tab 页）：IA 第 3 批把它退出 tabBar 后，本页此前**没有任何入口**，
        // 用户会找不到自己宠物的档案卡，故必须有一条**无条件常驻**入口。
        // 【2026-09-12 本批为什么从「数据服务」组挪到这里】v2 的「我的宠物」组正是承载
        // 宠物档案的位置（v2 第一行就是"可乐 · 橘猫 · 3 岁"→ petProfile），挪进这一组最贴近原型；
        // 它不再是"数据服务"里的一行，但仍是无条件渲染（没宠物也在），入口不丢。
        // 走下方 navigateTo（= Taro.navigateTo）：它已退出 tabBar，调 switchTab 会**静默失败**。
        // 图标沿用 icons-fill 里语义最贴的 pet 爪印（不新增图标）。
        { icon: 'paw-print', label: '宠物档案', url: '/pages/pet-profile/index', desc: primaryPetDesc },
        {
          icon: 'plus',
          // 文案例外（唯一的）：v2 写死"添加第二位宠物伙伴"，但一只宠物都没有的新用户
          // 看到"第二位"会莫名其妙 —— 按宠物的**真实数量**切换说法，其余情况照抄 v2。
          label: petCount > 0 ? '添加第二位宠物伙伴' : '添加毛孩子',
          url: '/pagesPet/add/index',
        },
      ],
    },
    {
      title: '家人与家庭',
      tone: 'teal',
      items: [
        // 家庭页（星澜小筑，已退出 tabBar 的普通页面）——上方家庭卡点整卡也进这里
        { icon: 'users', label: '家庭', url: '/pages/family/index' },
        // 血缘图谱 = v2 里「家族图谱」两个同名页（family-tree ≡ family/lineage）合并后的唯一入口。
        // 路由用**真实存在**的 pagesPet/family/lineage/index。
        // 2026-09-12 收口：pagesPet/family-tree 已**下线**（与 lineage 导航标题逐字相同的重复页）。
        // 它独有的「家庭成员（人）关系管理」（8 种关系：情侣/父女/母子…，走 familyStore 的
        // fetchRelations / createRelation / removeRelation）已搬进 pages/family/index 的
        // 「共同养宠 → 设置关系」，能力无遗失；lineage 只保留宠物血缘（父母/配偶/兄弟姐妹）。
        { icon: 'dna', label: '血缘图谱', url: '/pagesPet/family/lineage/index' },
        // 邀请家人：路由与「管理」组里那条「邀请好友」**完全相同**（/pagesUser/invite/index）。
        // v2 的归属是「家人与家庭」，故本条从「管理」组迁来并改用 v2 文案，
        // 避免同一路由在同屏出现两条不同叫法的入口（功能一点没少）。
        { icon: 'share', label: '邀请家人', url: '/pagesUser/invite/index' },
      ],
    },
    {
      title: '作品与回忆',
      tone: 'gold',
      items: [
        // 我的回忆录 = 回忆录中心页（pagesMemoir 分包；v2 的 memoir 落点）
        { icon: 'film-strip', label: '我的回忆录', url: '/pagesMemoir/memoir-center/index' },
        // 形象与头像 = 形象定制页（v2 在「宠物档案」二级页里也有同名条目，指向同一页）
        { icon: 'image', label: '形象与头像', url: '/pagesPet/avatar-customize/index' },
        // 团团的记忆 = AI 记忆管理页（v2 的 IA 改名：「AI 记忆纠错 / AI 记忆管理」→ 团团的记忆）
        { icon: 'brain', label: '团团的记忆', url: '/pagesUser/memory/index' },
      ],
    },
  ]
}

/**
 * 工具型分组（本页既有功能入口，v2 里没有这三组）—— 排在会员卡**之后**。
 * 【为什么保留】「数据服务 / 管理 / 设置」里的健康报告、疫苗日历、会员中心、
 * 效果追踪、意见反馈、设置、主题皮肤都是本页**唯一或主要**的入口，按 v2 直接删掉等于删功能；
 * 本批只做"补缺"，不动这些入口的存在性（只把重复的「邀请好友」并进「家人与家庭」）。
 * 【2026-09-12 收口批次】原「数据服务」组里的「成就墙」一条已随
 * `pagesPet/achievement` 整页下线而删除 —— v2 的 IA 口径正是"成就墙降为时光页内的一个展示分区"，
 * 且该页并无不可替代的能力：它没有分享卡/详情（`AchievementShareCard` 用在打卡页与疫苗页），
 * 独有内容只有"生日年龄"（时光页的「{名}的生日」里程碑已带年龄文案）与"累计打卡里程碑"
 * （与时光页成就分区的连续打卡同源，且原页读的是只读本地缓存的 getCheckinStats，口径更弱）。
 */
function buildToolGroups(): MineMenuGroup[] {
  return [
    {
      title: '数据服务',
      tone: 'primary',
      items: [
        { icon: 'clipboard-text', label: '健康报告', url: '/pagesPet/trends/index' },
        { icon: 'syringe', label: '疫苗日历', url: '/pagesPet/vaccine/index' },
        { icon: 'crown', label: '会员中心', url: '/pagesUser/member/index' },
      ],
    },
    {
      title: '管理',
      tone: 'gold',
      items: [
        { icon: 'chart-line', label: '效果追踪', url: '/pagesUser/effect-tracking/index' },
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
}

export default function Mine() {
  const user = useAuthStore(state => state.user)
  const isAuthenticated = useAuthStore(state => state.isAuthenticated)
  const isInitialized = useAuthStore(state => state.isInitialized)
  const logout = useAuthStore(state => state.logout)
  // 宠物列表 + 当前宠物：本轮新增的「宠物档案」行要显示当前宠物的身份
  // （名字 · 品种 · 年龄），所以要订阅 currentPet；仍然不需要 switchPet（本页不切宠物）。
  const { pets, currentPet, fetchPets } = usePetStore()
  // 会员体系：会员徽章与会员卡都走这个 hook（见文件顶部 import 处注释）
  const { isMember, membership: membershipInfo } = useMembership()
  // 多成员共同养宠：当前家庭与家庭成员（人）列表（2026-08-24）
  const currentFamily = useFamilyStore(state => state.currentFamily)
  const familyUsers = useFamilyStore(state => state.users)
  const [pageReady, setPageReady] = useState(false)
  // statbar 第 2 格：打卡**次数**（跨宠物累加，见 loadData 里的口径注释）
  const [checkinCount, setCheckinCount] = useState(0)
  // statbar 第 3 格：照片回忆 = 照片**张数**（跨条目累加，与时光页「记录 N 张照片」同口径）
  const [photoCount, setPhotoCount] = useState(0)
  const [themePanelOpen, setThemePanelOpen] = useState(false)
  // 头像加载失败标记：Image 触发 onError 时置 true 退回昵称占位，避免显示裂图
  const [avatarLoadFailed, setAvatarLoadFailed] = useState(false)
  const themeClass = useThemeClass()

  /**
   * 广播「当前选中的是第 4 个 tab」给自定义 tabBar 组件（我的 = 下标 3）。
   *
   * 【为什么必须由页面主动广播】微信给**每个 tab 页各创建一个**自定义 tabBar 实例
   * （官方文档原话：每个 tab 页下的自定义 tabBar 组件实例是不同的），实例建好后就不随
   * `switchTab` 重新挂载，React 也不会因路由变化自动重渲染它 ——
   * 选中态只能由 tab 页在 `useDidShow` 时推进来，否则「页面切了、底部高亮不动」。
   *
   * 本页下面另有一个自己的 `Taro.useDidShow`（未登录时提前 return 刷数据用），两者独立：
   * 若把广播并进那个回调，未登录/未就绪时就不会广播高亮。故单独占一行、无条件调用。
   */
  useTabBarSelected('/pages/mine/index')

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
    /**
     * 【为什么要有 cancelled 守卫】本批在 effect 里新增了 getCheckins 这串网络 await：
     * 依赖数组里的 `user` 是 authStore 里的对象引用，切账号（退出 → 登录另一账号）会换引用、
     * 本 effect 随之重跑；若上一轮的请求在新一轮开始后才返回，它会把**上一轮账号**的打卡数
     * 写进当前 state（数字串台）。守卫只做一件事：本轮已被新一轮取代 / 页面已卸载时丢弃它的
     * 写入结果，不干扰新一轮（写法与 pages/index/index.tsx:280-283 的 cancelled 同款）。
     */
    let cancelled = false
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
        // 打卡**次数**（statbar 第 2 格「打卡次数」）：跨宠物累加 `totalCheckins`（打卡条数）。
        // 【口径两度变更，别改回去】
        //   · 2026-09-11 审查 P1-3：这一格当时标的是「打卡天数」，却在累加 `totalCheckins`（条数），
        //     3 只宠物各打卡 100 天会显示「300 打卡天数」→ 当时改成了累加 `totalDays`（按日去重）。
        //   · 2026-09-12 本批：v2 数据条的标签是「打卡次数」，所以按**标签**取 `totalCheckins`
        //     （条数）—— 同一个统计对象里两个字段都有，不需要额外请求，也不再"名实不符"。
        // 【2026-09-12 本批修复：必须先拉取、再统计 —— 这一格冷启动恒为 0 的根因】
        //   ① `getCheckinStats` 是**纯本地缓存**实现：services/checkinService.ts:337-340 直接读
        //      getLocalCheckins（同文件 :55-57 → storage 键 `checkins_<petId>_<userId>`）算统计，
        //      它自己**一个请求都不发**。
        //   ② 真正会 GET /api/pets/:petId/checkins 并把结果**回写**这份本地缓存的是
        //      `getCheckins`（同文件 :170-179，其中 :174 就是那次回写）。
        //   ③ 冷启动直接进「我的」页（分享卡片 / 扫码 / 冷启）时缓存还是空的 → 算出来就是 0
        //      （6 号 H5 实测：那一轮 12 条请求里**一条 /checkins 都没有**）。
        //   故这里照首页的既有姿势（pages/index/index.tsx:281，首页为算「体重较上周」调 getCheckins）
        //   **先 await 拉一次**，成功后再统计；顺序反过来（先统计后拉取）= 又退回这个 bug。
        let checkinTotal = 0
        if (fetchedPets.length > 0 && user?.id) {
          for (const pet of fetchedPets) {
            try {
              // 先拉取（它会顺带回写本地缓存），再读缓存算统计
              await getCheckins(pet.id, user.id)
              const stats = await getCheckinStats(pet.id, user.id)
              checkinTotal += stats.totalCheckins
            } catch {
              // 【失败时为什么保持 0，而不是“退回读本地缓存”】
              //   ① 网络失败时 getCheckins 自己会降级返回本地缓存（checkinService.ts:176-178），
              //      所以能抛到这里的基本只有「未登录 / 归属校验没过」—— requirePetOwnership 在
              //      该函数的 try **之外**（:171）；这时缓存里的数要么不属于当前账号、要么不可信，
              //      报出来就是**假装有数**，宁可这一格停在 0 也不骗用户。
              //   ② 逐只隔离：一只失败只少算这一只（宁可少报、绝不假报），不会把整排打成 0；
              //      与上方「家庭接口失败不阻塞主流程」是同一个容错口径。
              //   ③ 兜底值就是 state 初始值 0：statbar 四格必须始终有数字（理由见 companionDays 注释）。
            }
          }
        }
        // 本轮已被新一轮取代 / 页面已卸载：丢掉这轮结果，避免旧账号的数写进新账号的页面
        if (cancelled) return
        setCheckinCount(checkinTotal)
        try {
          // 照片回忆（statbar 第 3 格）= 照片**张数**：把每条回忆的 photos 相加。
          // 原来这里用的是回忆**条数**（moments.length）且标签是「回忆」；
          // v2 的标签是「照片回忆」，与「时光」页速览的「记录 N 张照片」是同一件事，
          // 故改成张数口径（照片在 PetMoment.photos 顶层数组里，与时光页读取方式一致）。
          // getMoments() 不传 petId = 账号下**全部宠物**共用一本（时光页 2026-09-11 定的口径）。
          const moments = await timelineService.getMoments()
          // 拉取期间若已切账号/卸载，同样丢弃结果（防串台）
          if (cancelled) return
          setPhotoCount(
            moments.reduce((sum, moment) => {
              const photos = Array.isArray(moment.photos) ? moment.photos : []
              return sum + photos.length
            }, 0),
          )
        } catch {
          if (!cancelled) setPhotoCount(0)
        }
      } catch (err) {
        // 静默处理错误
      }
      if (!cancelled) setPageReady(true)
    }
    loadData()
    return () => {
      // 卸载 / 依赖变化（切账号）时把本轮标记作废，写入一律丢弃，见 loadData 上方注释
      cancelled = true
    }
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

  const currentTheme = useThemeStore.getState().current
  // 我的家庭角色：优先按家庭成员列表匹配，列表为空时按家庭创建者兜底
  const myFamilyRole = familyUsers.find(u => u.userId === user?.id)?.role
    || (currentFamily && currentFamily.userId === user?.id ? 'owner' : null)
  // 家庭成员数：列表为准，未加载时用家庭 memberCount 兜底，再兜底算 1（至少自己）
  const familyMemberCount = familyUsers.length
    || currentFamily?.memberCount
    || 1

  // 当前宠物（没有 currentPet 时退回列表第一只）：
  // statbar 的「陪伴天数」、下面「宠物档案」行的身份副标题、以及名片卡的「养宠 X」
  // **三处共用这一份定义** —— 同一页只写一次"当前宠物"，避免几处各算各的、日后悄悄漂移。
  const primaryPet = currentPet ?? pets[0] ?? null

  /**
   * 名片卡副标题里的「养宠 X」（渲染成 `铲屎官 · 养宠 3 年`）
   *
   * 【2026-09-12 第 2 批修正：起算宠物从 `pets[0]` 改成 `primaryPet`】
   * 上一版这里是 `calcPetDuration(pets[0]?.createdAt)`，而同一张名片卡上 statbar 的「陪伴天数」
   * 本批已改成"当前宠物"（见下面的 `companionDays`）—— 多宠账号下这两个数就指向**不同的宠物**
   * （`pets[0]` 只是列表第一只，并不保证是最早建档那只）：一张卡上出现两个互相矛盾的"养了多久"，
   * 正是用户 2026-09-12 真机反馈「陪伴天数这个做的也很…」那条要消除的东西。
   * 现在两者**同源**，都以 `primaryPet`（= `currentPet ?? pets[0] ?? null`）起算。
   * ⚠️ 所以「养宠 X」与「陪伴天数」在本页是**绑在一起的口径**：改一处必须同改
   * （含上面 primaryPet 的定义、下面的 companionDays，两者都动到就得三处一起看）。
   *
   * 【空值兜底照 calcPetDuration 原有口径走】没有宠物 / `createdAt` 缺失 / 日期非法 → 返回**空串**
   * （副标题只剩「铲屎官 · 」）。注意这与 `companionDays` 的兜底**不同**（那边兜 0）：
   * 这里允许留空，而 statbar 四格必须始终有数字 —— 这个差异是有意的，理由见 companionDays 的注释。
   * （渲染侧还有 `pets.length > 0` 兜底：一只宠物都没有时整段换成「还没有添加宠物」。）
   */
  const petDuration = calcPetDuration(primaryPet?.createdAt)

  /**
   * 陪伴天数（statbar 第 1 格，v2 文案「陪伴天数」）
   *
   * 【口径：当前宠物建档那天 → 今天】起算点 = `primaryPet`（= `currentPet ?? pets[0] ?? null`；没有宠物 → 0）。
   * ⚠️ 这是**镜像口径**：`pages/index/index.tsx` 首页 hero 的「已陪伴 N 天」取的是
   * `daysSinceLocalDate(activePet.createdAt)`（该文件里 activePet = `pet ?? pets[0] ?? null`，
   * 见 petInfo 派生段）—— 同一只宠物、同一天算出来**数值必然相等**；将来任一处要改，就**两处同改**。
   * 本页此前取的是"账号下最早建档的那只宠物"（`pets.map(p => p.createdAt)` 取最小值），
   * 于是一只老宠物 + 一只新宠物同屏会出现 **46 天（我的页）vs 43 天（首页）** 两个数
   * —— 同一个概念两个数，正是用户 2026-09-12 真机截图提的那条。
   *
   * 【两页唯一的差异：`daysSinceLocalDate` 返回 null 时怎么兜底 —— 这是**有意设计**，不是漏改】
   *   · 首页：建档时间非法 / 缺失 / 在未来 → `daysSinceLocalDate` 返回 null
   *     → 那段「已陪伴 N 天」**整块不渲染**（`pages/index/index.tsx:394-398`：空串在 :396 产出，
   *       再被 :398 的 `filter(Boolean)` 去掉）→ 首页看不到这个数；
   *   · 本页：statbar 四格**必须始终有数字**（缺一格会让整排视觉上塌陷、像坏了），故 null 兜 0，
   *     显示「0 陪伴天数」而不是空白。
   *   一句话：**数值口径一致；差异只有 null 的兜底 —— 首页隐藏该段、本页显示 0，这是有意的。**
   *
   * 日期差仍走 utils/date 的 daysSinceLocalDate（本地日历日、跨时区安全）。
   */
  const companionDays = (() => {
    if (!primaryPet) return 0
    return daysSinceLocalDate(primaryPet.createdAt) ?? 0
  })()

  /**
   * statbar 四项（顺序与文案照抄 v2：陪伴天数 / 打卡次数 / 照片回忆 / 生成的片）
   *
   * 【第 4 格为什么不是 v2 的「生成的片」】v2 第 4 格是"生成片数"，但服务端目前**没有**
   * 可取到的"累计成片数"：只有 `GET /api/pets/:petId/memoir/list`（返回 total，但把
   * pending/processing/failed 都算进去）和 `GET .../memoir/status`（只给**最近一次**任务），
   * 且前端 services/memoirService.ts 里**没有** list 的封装 —— 补封装要改 `services/**`，
   * 超出本批允许改动的文件范围。
   * 所以这一格用**真实且口径准确**的「毛孩子」（账号下宠物数，来自 petStore）：
   * 数字不会骗人，也不会为了对齐文案而拿"最近一次任务"冒充"累计片数"。
   * 【换回 v2 文案的前提】memoirService 补出按状态过滤的成片计数后，把这一格换回「生成的片」。
   */
  const statItems: { value: number; label: string }[] = [
    { value: companionDays, label: '陪伴天数' },
    { value: checkinCount, label: '打卡次数' },
    { value: photoCount, label: '照片回忆' },
    { value: pets.length, label: '毛孩子' },
  ]

  // primaryPet（= 当前宠物）的定义已上移到 companionDays 之前，statbar 与下面这行共用同一个值
  // 身份文案对齐 v2 的「可乐 · 橘猫 · 3岁」：名字 · 品种 · 年龄。
  // 品种为空时退回物种（猫/狗）而不是留一个空圆点；年龄走全站统一口径 formatPetAge，
  // 生日缺失/非法时它返回空串，会被下面的 filter(Boolean) 去掉。
  const primaryPetDesc = primaryPet
    ? [
        primaryPet.name,
        primaryPet.breed || (primaryPet.species === 'cat' ? '猫' : '狗'),
        formatPetAge(primaryPet.birthDate),
      ].filter(Boolean).join(' · ')
    : ''

  // 菜单分组：上半（内容型，会员卡之前）+ 下半（工具型，会员卡之后）
  const contentGroups = buildContentGroups(primaryPetDesc, pets.length)
  const toolGroups = buildToolGroups()

  /**
   * 会员卡文案
   *  · 会员态：写**真实到期日**（走 localDateString 取本地日历日，不 slice ISO 串）
   *  · 非会员/已过期：写引导文案
   * 【为什么不是 v2 的「解锁无限回忆录 · 高清导出 · 完整叙事档」】这三条在会员中心
   * 的权益清单里并不存在（真实权益是：AI 取名 20次/月、回忆录 8折、健康打卡报告无限、
   * 专属客服、全家共享 5 人，见 src/pagesUser/member/index.tsx 的 BENEFITS）。
   * 硬约束"不得承诺不存在的权益"优先于"文案照抄原型"，故这里写真实权益。
   */
  // 到期日：hook 把后端的 endDate 映射成 expiresAt；取本地日历日（见上方 import 处注释）
  const memberExpiry = localDateString(membershipInfo?.expiresAt)
  const memberDesc = isMember
    ? (memberExpiry ? `有效期至 ${memberExpiry}` : '会员权益生效中')
    : 'AI 取名 20 次/月 · 回忆录 8 折 · 健康报告无限'

  /**
   * 渲染一组菜单：组标题（同色小圆点 + 标题 + 可选引导小字）+ 白卡列表
   * 「设置」组在行末再追加一条「主题皮肤」（展开四季色面板），故它的最后一行不吃 `--last`。
   */
  const renderMenuGroup = (group: MineMenuGroup) => (
    <View key={group.title} className='mine-menu-group'>
      <View className='mine-menu-group-head'>
        <View className={`mine-menu-group-dot mine-menu-group-dot--${group.tone}`} />
        <Text className='mine-menu-group-title'>{group.title}</Text>
        {/* v2 的「点进档案 ›」：纯引导小字，不可点（整行菜单才是入口） */}
        {group.more && <Text className='mine-menu-group-more'>{group.more}</Text>}
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
            {/* 标签一律包在 label-wrap 里：有副标题时两行左对齐同一个边缘（没有副标题也不吃亏） */}
            <View className='mine-menu-label-wrap'>
              <Text className='mine-menu-label'>{item.label}</Text>
              {item.desc && <Text className='mine-menu-desc'>{item.desc}</Text>}
            </View>
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
                <Text className='mine-menu-desc'>跟随季节</Text>
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
  )

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
          本版改为**上下分层**：上半是横幅图（容器按 16:9 取，与图同比例 → aspectFill 铺满
          又不裁主体），下半是白底信息区（文字在浅底上，**完全不需要遮罩**）。
          【2026-09-12 第三次调整：横幅换自有图】横幅来源从线上 Illustration(page-mine) 换成
          本页 assets 里的 16:9 全家福 —— 线上那套四季图有三张实测是 1:1（1254×1254），
          进 16:9 容器 + aspectFill 会居中裁掉约 44% 高度（猫耳/狗头被切、右侧空绿），
          上面"与图同比例"这个前提当初只对 summer 那张成立。
          猫狗完整可见、文字可读性最好，也不再依赖遮罩这种"两头不讨好"的手段。 */}
      <View className='mine-card'>
        {/* 卡片上半：自有宽幅全家福横幅（多猫狗一家人，本页 assets 静态资源，2026-09-12 本批替换）。
            容器仍按 16:9 取（686rpx 宽 → 386rpx 高），与新图**同比例**，
            所以 aspectFill 既铺满又**零裁切**（前两版把插画当整卡底图，比例差得远，
            结果只露出狗、猫被遮罩抹掉了）。
            ⚠️ 兜底不能省：横幅自身保留浅奶油兜底色（见 index.scss .mine-card__banner），
            图未加载完或加载失败时是一块"浅奶油纯色横幅"而不是空框；本地静态图带 lazyLoad，
            首屏不阻塞在这一张上。 */}
        <View className='mine-card__banner'>
          <Image className='mine-card__art' src={familyHero} mode='aspectFill' lazyLoad />
        </View>

        {/* 卡片下半：白色信息区（文字直接在浅底上，可读性最好，不需要任何遮罩） */}
        <View className='mine-card__body'>
          <View className='mine-card__top'>
            {/* 点头像 = 改头像昵称：原「个人资料」页已并入「设置」页（IA 第 2a 批），
                编辑区块在设置页顶部；路由已注销，这里不能再指 profile */}
            <View className='mine-avatar' onClick={() => navigateTo('/pagesUser/settings/index')}>
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
                {isMember && (
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
            {/* 「编辑」同上：指向设置页顶部的「个人资料」区块（不再有独立的个人资料路由） */}
            <View className='mine-edit-btn' onClick={() => navigateTo('/pagesUser/settings/index')}>
              <Icon name='pencil-simple' size={13} tone='primary' />
              <Text className='mine-edit-btn__text'>编辑</Text>
            </View>
          </View>
        </View>
      </View>

      {/* ===== 数据条 statbar（2026-09-12 本批新增，对齐 v2 第 3 块） =====
          v2 在名片卡下面有一横排 **4 项**数据（`.sec.card.statbar`：数字在上、标签在下、
          等距四列）。本页原先把其中 3 项挤在名片卡信息区里（宠物 / 打卡天数 / 回忆），
          与这一版式不符，而且再加一条数据条就会同屏重复显示同一批数字 ——
          故把名片卡里那一行整块**搬到这里**（tsx 与样式一并删除，不留死样式）。
          透明度按 v2 的基准档：卡底 = --glass-bg（rgba(255,255,255,0.72)，已在 _theme.scss），
          配 1rpx 白描边 —— 与 v2 的 `.card` 同款；数字用主色深色档（v2 的 --primary-deep），
          标签用三级文字色（v2 的 --ink3）。 */}
      <View className='mine-statbar'>
        {statItems.map(item => (
          <View key={item.label} className='mine-statbar__item'>
            <Text className='mine-statbar__num'>{item.value}</Text>
            <Text className='mine-statbar__label'>{item.label}</Text>
          </View>
        ))}
      </View>

      {/* ===== 家庭信息卡（星澜小筑，2026-09-11 第二轮重做） =====
          改版前它是一张与菜单卡同款的白卡：淡金圆底 + 家庭名 + 一行灰字 + 一个 › 箭头。
          夹在「我的毛孩子」切换器与三组白卡菜单之间，整段从上到下全是白底，
          和菜单糊成一片，行动指向也弱（只有一个灰箭头）。
          本版（切换器已删除，它是数据条之下的第一个独立主体）：
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

      {/* ===== 内容分组菜单（v2 顺序：我的宠物 → 家人与家庭 → 作品与回忆） =====
          这三组是本批按 v2 新增的（此前本页只有"数据服务 / 管理 / 设置"三组工具型入口）。
          每组一个色系：组标题左侧同色小圆点 + 组内图标与底色同源（见文件上方 MENU 定义注释）。 */}
      {contentGroups.map(renderMenuGroup)}

      {/* ===== 会员卡 memcard（本批新增，对齐 v2 第 6 块） =====
          v2 是一张**金色渐变**横卡：标题 + 一行说明 + 一个白底胶囊按钮（.memcard/.mbtn）。
          本页此前只有名片卡上的一个小徽章，没有这张卡。
          【配色】v2 的渐变是 rgba(255,201,77,.9) → rgba(255,140,60,.92)（秋天金→主色橙）。
          按"颜色一律走主题变量"落成 rgba(var(--gold-rgb),.9) → rgba(var(--primary-rgb),.92)：
          基线秋色与 v2 几乎同色（注：应用层默认主题 2026-09-12 起是春季），
          换季/星空主题时整卡跟随主题（不再写死 hex）。
          【状态】走 useMembership()：已开通 → 写真实到期日 + 按钮「会员中心」；
          非会员/已过期 → v2 那套引导态（文案用**真实权益**，不用 v2 的"无限回忆录/高清导出"，
          那两条权益在会员中心并不存在）。
          【整卡可点】点击与按钮同一个落点（回忆录会员中心页），不给"假按钮"：
          按钮不是独立可点区域，事件统一冒到卡上。 */}
      <View className='mine-memcard' onClick={() => navigateTo('/pagesUser/member/index')}>
        {/* 右上角柔光：纯装饰层（金色卡面上加一点光感方向），不接事件 */}
        <View className='mine-memcard__glow' />
        <View className='mine-memcard__body'>
          <Text className='mine-memcard__title'>星河宠记 · 会员</Text>
          <Text className='mine-memcard__desc'>{memberDesc}</Text>
          <View className='mine-memcard__btn'>
            <Text className='mine-memcard__btn-text'>{isMember ? '会员中心' : '去看看'}</Text>
            <Icon name='caret-right' size={11} tone='gold-deep' />
          </View>
        </View>
      </View>

      {/* ===== 工具分组菜单（数据服务 / 管理 / 设置-主题皮肤，v2 里没有这三组、保留） ===== */}
      {toolGroups.map(renderMenuGroup)}

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
