/**
 * 品牌插画注册表
 *
 * 【为什么走服务器】24 张插画合计 1.6MB，而主包已 1.82MB / 2MB（微信上限），
 * 根本塞不进去；且空态分散在 pagesPet / pagesUser / pagesMemoir / 主包四个包里，
 * 靠分包也覆盖不了。因此与 20 张宠物预选头像采用同一套机制：
 * 图片放服务器 uploads/illustrations/ 静态托管，前端按 key 拼 URL。
 * （坑：/uploads 的 CORP 头此前给过 same-origin，会拦掉跨域 <img>，
 *   已由服务端 uploadsResourcePolicy 中间件修成 cross-origin，24 张已逐张验过 200。）
 *
 * 【风格】现在是**两代并存**，别再把它们当成一套：
 *   · 新 IP（全站主流）：**2D 厚涂印象派油画**，同一只布偶猫 + 同一只拉布拉多幼犬，
 *     按四季换色，放 `uploads/illustrations/seasonal/`，由本文件的 SEASONAL_SLOT 拼文件名。
 *   · 旧 IP（仅剩少数 key）：早期 **3D 毡毛/黏土**风，不随季节换图，放 `uploads/illustrations/<key>.jpg`。
 *     2026-09-12 已为 `grid-agent` / `moment-anniversary` / `moment-birthday` 补上四季版，
 *     三个用户一眼可见的槽位就此脱离旧 IP；剩下的旧 key 都是低频空态，尚未补图。
 * 角色一致性靠「把已有季节图当参考图喂生图模型 + 逐字重复角色锚点」双保险实现，
 * 生成器见 02-UI设计/插画系统/gen-illustrations.mjs（命名/尺寸/压缩口径）
 * 与 E:\Codex\2026-09-11\xinghe-ui-redesign\work\gen-ip-*.mjs（油画版角色锚点与画风词）。
 *
 * 【品牌 IP 为什么不在这个表里】logo-catdog-01.png 用在加载 logo / 首页 Hero /
 * 登录页徽章，是关键路径资产，依赖网络会在弱网白屏，因此留在本地包（仅 46KB）。
 */
import { resolveAvatarUrl } from '../services/api'
/*
 * 主题 key 只用「类型导入」引入：编译后会被完全擦除（不残留任何运行时 import），
 * 因此本文件在运行时不会依赖 stores/themeStore，也就不会与 stores 形成循环依赖。
 * 主题的实际取值由调用方（components/Illustration.tsx）传进来，见 illustrationUrl 的注释。
 */
import type { ThemeKey } from '../stores/themeStore'

/** 服务端静态目录（相对路径，由 resolveAvatarUrl 拼上 API_BASE_URL） */
const ILLUSTRATION_DIR = '/uploads/illustrations'

/** 四季插画子目录（命名 `<槽位>-<季><后缀>.jpg`，如 checkin-spring.jpg） */
const SEASONAL_DIR = `${ILLUSTRATION_DIR}/seasonal`

/** 空态插画（600×600，角色居中、四周留白） */
export type EmptyIllustration =
  | 'empty-timeline' // 时光线为空
  | 'empty-checkin' // 还没打卡
  | 'empty-pet' // 还没添加宠物
  | 'empty-search' // 搜索无结果
  | 'empty-photo' // 还没有照片
  | 'empty-chart' // 暂无健康数据
  | 'empty-vaccine' // 还没有疫苗记录
  | 'empty-family' // 还差一位家人
  | 'empty-achievement' // 还没有成就
  | 'empty-message' // 暂无对话

/** 功能头图（960×540，16:9，主体偏左、右侧留标题位） */
export type HeaderIllustration =
  | 'header-memoir' // 回忆录馆
  | 'header-avatar-studio' // 形象工坊
  | 'header-health' // 健康报告
  | 'header-family-photo' // 全家福
  | 'header-naming' // AI 取名

/** 激励时刻（600×600，主体偏下、上方留文字位） */
export type MomentIllustration =
  | 'moment-streak-7' // 连续 7 天
  | 'moment-streak-30' // 连续 30 天
  | 'moment-birthday' // 生日快乐（2026-09-12 起有四季版）
  | 'moment-anniversary' // 周年纪念（2026-09-12 起有四季版）
  | 'moment-achievement' // 成就解锁
  | 'moment-first-checkin' // 首次打卡

/** 页面头图（用于页面顶部「插画 + 标题」）
 *
 *  ⚠️ **不要按固定比例（如 16:9）反推展示尺寸**：2026-09-12 实测同一槽位**跨季比例不一致**
 *  （夏季 1536×1024 = 1.50 宽图；春/秋/冬 1254×1254 = 1.00 方图，主体居中，**含默认主题的春季**）。
 *  消费方正确做法：用 `widthFix`/`heightFix`（一边由 CSS 定死、另一边让图片按比例自算 →
 *  零裁切零留白），或明确接受裁切/留白并写下取舍。完整决策链见
 *  `src/components/PageHero.tsx` 的文件头。
 *
 *  为什么专门有这一类：空态插画只有「没有数据」的用户才看得到，
 *  老用户有数据时永远触发不到 —— 页面要让人感觉到变好了，必须改**始终可见**的区域。
 */
export type PageHeaderIllustration =
  | 'page-pet-profile' // 宠物档案：猫狗共看档案册
  | 'page-mine' // 我的：猫狗抬头看主人
  | 'page-family' // 家庭：猫狗坐在小屋前
  | 'page-home' // 今天：猫狗在温馨的家里等主人
  | 'page-creative' // 创作：猫狗一起画画
  | 'page-timeline' // 时光：猫狗走在摆满相框的小路上

/**
 * 固定远程插画（**不随主题季节变化**的那几张）
 *
 * 【为什么必须单开一张表】`seasonalIllustrationUrl` 的拼法是 `<slot>-<季><suffix>.jpg`，
 * 而「星空银河 / 奶油格纹」**不在四季里** —— 拿它们去套季节函数会拼出
 * `today-brand-autumn.jpg` 这种"看着像对、其实是另一张画"的名字，或者干脆是不存在的文件（裂图）。
 * 所以这类图**把服务器上的完整相对路径写死**，不走任何拼装。
 * （v2 原型 HTML 自己在同名函数上留过这条警告，2026-09-12 又差点被踩第二次。）
 */
export type FixedIllustration =
  | 'brand-starry' // 设置页「星空银河·深色主题」预览卡：固定用今天页品牌图的星空季版本

/** 分享卡背景（主体缩小靠边、中心留空放内容） */
export type ShareIllustration =

  | 'share-card-warm' // 暖色横版
  | 'share-card-starry' // 星空竖版
  | 'share-card-soft' // 夕阳竖版

/**
 * 功能入口插画（600×600，主体居中偏近景；创作页「今日 / 更多」六个入口专用）
 * ⚠️ `grid-agent` 与下面 MomentIllustration 的 `moment-anniversary` / `moment-birthday`
 *    自 2026-09-12 起**也有四季版**了（原先只有旧 IP 那张 3D 毡毛图，见 SEASONAL_SLOT 里的说明）。
 *
 *  为什么单独开一类：这批是**功能入口的说明图**，既不是空态、也不是页面头图。
 *  构图刻意比空态那批更"近"（猫狗合计占画面约三分之二）——
 *  卡片里只展示约 106pt，沿用空态那种"四周大片留白"会被缩得看不清主体。
 */
export type GridIllustration =
  | 'grid-checkin' // 健康打卡：一起看打卡板
  | 'grid-agent' // AI 管家：凑近小音箱
  | 'grid-lineage' // 家庭图谱：头顶一圈相连的小相框
  | 'grid-weekly' // 周报：一起看周报板
  | 'grid-vaccine' // 疫苗日历：一起看小台历
  | 'grid-report' // 健康报告：一起看报告单

export type IllustrationName =
  | EmptyIllustration
  | HeaderIllustration
  | PageHeaderIllustration
  | MomentIllustration
  | ShareIllustration
  | GridIllustration
  | FixedIllustration

/** 全部合法 key（供测试断言与遍历用） */
export const ILLUSTRATION_NAMES: IllustrationName[] = [
  // 固定远程图（不随季节变）—— 已在服务器上实测存在
  'brand-starry',
  'empty-timeline',
  'empty-checkin',
  'empty-pet',
  'empty-search',
  'empty-photo',
  'empty-chart',
  'empty-vaccine',
  'empty-family',
  'empty-achievement',
  'empty-message',
  'header-memoir',
  'header-avatar-studio',
  'header-health',
  'header-family-photo',
  'header-naming',
  'page-pet-profile',
  'page-mine',
  'page-family',
  'page-home',
  'page-creative',
  'page-timeline',
  'moment-streak-7',
  'moment-streak-30',
  'moment-birthday',
  'moment-anniversary',
  'moment-achievement',
  'moment-first-checkin',
  'share-card-warm',
  'share-card-starry',
  'share-card-soft',
  'grid-checkin',
  'grid-agent',
  'grid-lineage',
  'grid-weekly',
  'grid-vaccine',
  'grid-report',
]

/**
 * 季节插画的四季取值（与 02-UI设计/插画系统 产出的季节图命名一致）
 *
 * 文件命名规律：`<槽位>-<季节><后缀>.jpg`
 *   例：checkin-spring.jpg / mine-autumn-hero.jpg / achievement-summer-card.jpg
 *   ⚠️ 后缀必须与服务器上的真实文件名逐字符一致——拼错不会报错，只会**没图**（本仓踩过）。
 */
export type SeasonKey = 'spring' | 'summer' | 'autumn' | 'winter'

/** 四季取值表（isSeasonKey 的取值来源，顺序＝春→夏→秋→冬） */
const SEASON_KEYS: SeasonKey[] = ['spring', 'summer', 'autumn', 'winter']

/**
 * 默认季（**兜底季**）：autumn
 *
 * 【2026-09-12 默认主题由「秋」改成「春」，本值为什么是**有意**保持 autumn 的】
 *   本值只在「主题不带季节」时生效 —— starry（星空银河）/ grid（奶油格纹）/ 调用方没传主题。
 *   而这几处的**兜底配色本来就是秋色系**，兜底季跟着秋走才自洽：
 *     · getThemeMeta() 的非法 key 兜底取 THEME_LIST[0]（= autumn「暖阳珊瑚橙」）；
 *     · grid 那套主题的调色板整个复用了 autumn（primary #FF6B3D / gold #FFB020），
 *       它的 tabBar 图标也走 tabBarIconDir=null → 根目录那套**秋色图标**；
 *     · styles/_theme.scss 里 page / .app-root 的基线变量也全是 autumn 的色值
 *       （不许动 scss，故保持原样；app.config.ts 的窗口底色已于 2026-09-12 收尾批改成
 *       spring 的 '#F3FAEF'，那是 JS 接管前的首帧色，不改变这里的兜底结论）。
 *   若把本值改成 spring，就会出现「珊瑚橙底 / 深蓝底 + 嫩绿插画 + 秋色 tabBar 图标」这类撞色：
 *   实测插画边缘均色 —— 春 ≈ #CDD999（嫩绿）、秋 ≈ #E98C49（暖橙，与 grid 主色 #FF6B3D 同族），
 *   而 starry 是 #1B2450 深蓝 + #FFD068 暖金。所以「谁当兜底季」看的是兜底配色，不是默认主题。
 *   ⚠️ 默认主题（DEFAULT_THEME = spring）管的是「新用户第一眼看到哪套配色」，
 *      与本值**不是**同一个概念，别再把两者当成必须相等。
 *
 * 为什么不用当前日期推季节：主题是用户手动选的，跟真实季节无关 ——
 * 用户秋天把主题设成「海盐蓝 summer」，就该看到夏天的插画，不能被日期改回秋景。
 * starry（星空银河）没有四季插画，也统一回退到这里，保证「拿不到季节主题时结果确定」。
 */
export const DEFAULT_SEASON: SeasonKey = 'autumn'

/**
 * 判断主题 key 是不是四季主题
 * @param theme - 主题 key（可为 undefined，表示调用方没传）
 * @returns 四季主题返回 true；starry / grid（奶油脂纹理）/ undefined 一律返回 false
 */
export function isSeasonKey(theme: ThemeKey | undefined): theme is SeasonKey {
  return typeof theme === 'string' && (SEASON_KEYS as string[]).includes(theme)
}

/**
 * 季节插画的命名后缀（决定构图，三者不能混用）
 *  · ''      —— 方形控件图（600×600，主体居中偏近景）
 *  · '-hero' —— 页头插画。⚠️ **别按固定比例反推尺寸**：2026-09-12 实测同一槽位
 *              **跨季比例不一致** —— 夏季那批是 1536×1024（1.50 宽图），
 *              春/秋/冬是 1254×1254（1.00 方图，**含默认主题的春季**），主体居中而非偏左。
 *              所以消费方要么用 `widthFix`/`heightFix`（一边定死、另一边让图片自算，
 *              零裁切零留白），要么接受裁切/留白并写清取舍 —— 细节见
 *              `src/components/PageHero.tsx` 头部的三段决策链。**不要照着"16:9"写死宽度。**
 *  · '-card' —— 卡片小图（卡片里只露约 106pt，构图要比空态那批更「近」）
 */
type SeasonalSuffix = '' | '-hero' | '-card'

/**
 * 旧 key → 季节插画的「槽位名 + 后缀」。
 * 为什么要有这层映射：四季插画是按「槽位」组织的（15 个位置），
 * 而小程序沿用旧的 36 key 体系（key 是按用途命名的），两套命名对不上，
 * 且旧体系里有 20 个 key 在新体系里没有对应 —— 所以只映射有季节版的那些，
 * 其余继续用旧图，避免改一处、崩一片。
 *
 * 拼出来的样子（`<slot>-<季><suffix>.jpg`，季节取 spring|summer|autumn|winter）：
 *   page-mine（我的页头图）        → mine-spring-hero.jpg
 *   grid-checkin（健康打卡入口图） → checkin-spring.jpg
 *   empty-achievement（成就空态）  → achievement-spring-card.jpg
 */
const SEASONAL_SLOT: Partial<Record<IllustrationName, { slot: string; suffix: SeasonalSuffix }>> = {
  // —— 页面头图（PageHeaderIllustration：页顶「插画 + 标题」那条横幅）——
  'page-mine': { slot: 'mine', suffix: '-hero' }, // 我的页头图：猫狗抬头看主人
  'page-pet-profile': { slot: 'pet-profile', suffix: '-hero' }, // 宠物档案页头图：猫狗共看档案册
  'page-family': { slot: 'family', suffix: '' }, // 家庭页头图：猫狗坐在小屋前
  // 今天页品牌位：高保真 v2 第 1 屏那张「猫狗在湖边」的品牌插画。
  // 【为什么 2026-09-12 才补】`page-home` 这个 key 早就在用（`pages/index/index.tsx` 的
  // `today-hero__art`），但**从没进过本映射表** → `seasonalIllustrationUrl('page-home')`
  // 一直返回 null、退回旧 36 key 那套图，所以今天页永远显示不到 v2 的品牌图。
  // 图片本身 2026-09-12 已核实**在服务器上**（`today-brand-{spring,summer,autumn,winter}.jpg`
  // 全部 HEAD 200，其中 winter 本地没有、服务器有），缺的只是这一行映射。
  // 后缀取 ''：v2 的资产命名是 `<槽位>-<季>.jpg`（品牌图不是 -hero / -card 那两类）。
  'page-home': { slot: 'today-brand', suffix: '' },
  'page-creative': { slot: 'creative', suffix: '-hero' }, // 创作页头图：猫狗一起画画
  'page-timeline': { slot: 'timeline', suffix: '' }, // 时光页头图：猫狗走在摆满相框的小路上

  // —— 功能页头图（HeaderIllustration）——
  'header-memoir': { slot: 'memoir', suffix: '' }, // 回忆录页头图
  'header-avatar-studio': { slot: 'avatar-studio', suffix: '-hero' }, // 形象工坊页头图
  'header-naming': { slot: 'naming', suffix: '-card' }, // AI 取名页头图（卡片式构图）

  // —— 功能入口宫格图（GridIllustration：创作页六个入口卡片）——
  'grid-checkin': { slot: 'checkin', suffix: '' }, // 健康打卡入口：一起看打卡表
  'grid-vaccine': { slot: 'reminder-vaccine', suffix: '' }, // 疫苗日历入口：一起看小台历
  'grid-report': { slot: 'health-record', suffix: '-hero' }, // 健康报告入口：一起看报告单
  // ⚠️ 下面这三行是 2026-09-12 补的，属于「**补映射**」而不是「加 key」——三个 key 的语义没变，
  // 变的是它们终于有了新 IP 油画版的四季图（此前只有 `/uploads/illustrations/<key>.jpg`
  // 那张早期 3D 毡毛图）。因此**页面代码一行都不用改**，`illustrationUrl()` 会自动优先返回季节图。
  // 旧图**仍留在服务器上**作兜底：一旦季节图缺失（被误删/上传失败），
  // 把这三行删掉即可整体退回旧图，不需要动任何调用点。
  'grid-agent': { slot: 'agent', suffix: '' }, // AI 管家入口（创作页「今天可以做」缩略图，展示尺寸仅 66px）
  'moment-anniversary': { slot: 'anniversary', suffix: '' }, // 周年纪念（纪念日页头插画）
  'moment-birthday': { slot: 'birthday', suffix: '' }, // 生日快乐（纪念日页生日空态）

  // —— 空态插画（EmptyIllustration：只有还没数据的新用户看得到）——
  'empty-timeline': { slot: 'timeline', suffix: '' }, // 时光线为空：还没有记录
  'empty-pet': { slot: 'pet-profile', suffix: '-hero' }, // 还没添加宠物
  'empty-vaccine': { slot: 'reminder-vaccine', suffix: '' }, // 还没有疫苗记录
  'empty-family': { slot: 'family', suffix: '' }, // 家庭里还没加入其他成员
  'empty-achievement': { slot: 'achievement', suffix: '-card' }, // 还没有解锁成就
}

/**
 * 固定远程插画的完整路径表（key → 服务器相对路径）
 *
 * 与 `SEASONAL_SLOT` 的区别：那张表是"槽位 + 季节"由代码拼出来，这张表是**一张图一个完整路径**。
 * 用途：不随季节变的图（如设置页的星空主题预览），避免被季节函数拼成不存在的文件名。
 * ⚠️ 新增条目必须在服务器上实测 HEAD 200，否则就是裂图（本仓踩过）。
 */
const FIXED_ILLUSTRATION: Partial<Record<IllustrationName, string>> = {
  // 设置页「星空银河·深色主题」预览卡：今天页品牌图的星空季版本（2026-09-12 HEAD 200 实测）
  'brand-starry': `${SEASONAL_DIR}/today-brand-starry.jpg`,
}

/**
 * 固定远程图的 key 列表（供测试与调用方遍历）
 *
 * ⚠️ 这些 key 的路径**天然不含季节名**（比如 `today-brand-starry.jpg`），
 * 所以"走季节目录的图必须落在四季之一"那条一致性规则**不适用于它们** ——
 * 测试里必须排除，否则会把设计意图当成 bug 打红（2026-09-12 已踩过一次）。
 */
export const FIXED_ILLUSTRATION_NAMES = Object.keys(FIXED_ILLUSTRATION) as IllustrationName[]

/**
 * 拼「季节插画」的完整 URL（内部实现，同时导出给测试做逐字符断言）
 * @param name - 插画 key（见 ILLUSTRATION_NAMES）
 * @param theme - 当前主题 key；不传 / starry / grid 一律按默认季 autumn 处理
 * @returns 命中季节映射时返回完整 URL；该 key 没有季节版时返回 null（交给调用方回退旧图）
 */
export function seasonalIllustrationUrl(name: IllustrationName, theme?: ThemeKey): string | null {
  const mapping = SEASONAL_SLOT[name]
  // 没有季节版的 key（share-card-* / moment-* / grid-lineage / grid-weekly 等）：
  // 返回 null，让调用方继续用旧 36 key 那套图 —— 漏图比新图缺席严重得多
  if (!mapping) return null
  // 非四季主题（starry 星空银河 / grid 奶油脂纹理）或调用方没传 → 用默认季，
  // 保证结果确定且这张图一定存在，不会出现「主题不认识就拼出一个 404 文件名」
  const season: SeasonKey = isSeasonKey(theme) ? theme : DEFAULT_SEASON
  return resolveAvatarUrl(`${SEASONAL_DIR}/${mapping.slot}-${season}${mapping.suffix}.jpg`)
}

/**
 * 取插画完整 URL（全站唯一出口，由 components/Illustration.tsx 调用）
 *
 * 行为：有季节版的 key + 四季主题 → 返回季节图；否则原样返回旧的 36 key 图。
 * 为什么把 theme 做成入参、而不在本文件里读 store：避免 data 层 import stores/themeStore
 * 造成循环依赖（本文件对主题只用 `import type`，编译后零运行时依赖），
 * 顺带让这个纯函数能被测试逐字符断言。
 *
 * @param name - 插画 key
 * @param theme - 当前主题 key（调用方 Illustration.tsx 始终会传；不传时按默认季 autumn）
 * @returns 例：https://api.xinghuanhai.com/uploads/illustrations/seasonal/checkin-spring.jpg
 *              无季节版的 key 仍是 https://api.xinghuanhai.com/uploads/illustrations/share-card-warm.jpg
 */
export function illustrationUrl(name: IllustrationName, theme?: ThemeKey): string {
  // ① 固定远程图优先：这类 key 的路径是写死的完整路径，**绝对不能**进季节拼装
  //   （starry/grid 不在四季里，拼出来会是"另一张画"或 404）
  const fixed = FIXED_ILLUSTRATION[name]
  if (fixed) return resolveAvatarUrl(fixed)
  const seasonal = seasonalIllustrationUrl(name, theme)
  // 宁可用旧图，也不要裂图：拼不出季节图（该 key 没有季节版）就退回旧 URL
  if (seasonal) return seasonal
  return resolveAvatarUrl(`${ILLUSTRATION_DIR}/${name}.jpg`)
}
