import { useEffect } from 'react'
import Taro from '@tarojs/taro'
import { View, Text, Image } from '@tarojs/components'
import { useAuthStore } from '../../stores/authStore'
import { redirectToLoginIfNeeded } from '../../utils/authGuard'
import { useThemeClass, useThemeKey } from '../../hooks/useThemeClass'
/*
 * 方形宫格图的「主题 → 季节」口径**故意复用 data 层这两个导出**，不自己再写一张映射表：
 * DEFAULT_SEASON / isSeasonKey 正是 `illustrationUrl()` 判断季节时用的那一对，
 * 抄一份映射迟早会漂移（默认季改了、宫格还停在旧季，而且不会报错）。
 */
import { DEFAULT_SEASON, isSeasonKey, type SeasonKey } from '../../data/illustrations'
import type { IconName } from '../../components'
// 自定义 tabBar 的选中态广播 hook（本页 = tabBar 第 3 项，路径写错 tsc 直接报错）
import { useTabBarSelected } from '../../constants/tabBar'

import './index.scss'
import { PageBackground, Icon, Illustration, PageHero } from '../../components'
// 「作品工坊」两张方形宫格的**专用方图**（320×320，主体居中、四边无预留位）。
// ⚠️ 必须静态 import：拼字符串路径不参与打包，小程序端会拿不到资源（详见 TILE_ART 注释）。
import tileAvatarStudioSpring from './assets/tile-avatar-studio-spring.jpg'
import tileAvatarStudioSummer from './assets/tile-avatar-studio-summer.jpg'
import tileAvatarStudioAutumn from './assets/tile-avatar-studio-autumn.jpg'
import tileAvatarStudioWinter from './assets/tile-avatar-studio-winter.jpg'
import tileNamingSpring from './assets/tile-naming-spring.jpg'
import tileNamingSummer from './assets/tile-naming-summer.jpg'
import tileNamingAutumn from './assets/tile-naming-autumn.jpg'
import tileNamingWinter from './assets/tile-naming-winter.jpg'

/**
 * 创作 tab 页 —— 按**高保真 v2 第 4 屏**（`04-creative.png` / 原型 `screenCreative()`）整屏对齐。
 *
 * ───────────────────────────────────────────────────────────────────────────
 * 【本屏的验收基准】截图 `E:\Codex\2026-09-11\xinghe-ui-redesign\outputs\web3\04-creative.png`
 * （750×1624），细节数值回原型 HTML `原型-v2\index.html` 的 `screenCreative()` 抄。
 * v2 这一屏自上而下的四块，本文件逐块承载：
 *   ① 页头横幅   —— `PageHero(page-creative)`：`你的宠物值得一件作品 / 形象 · 回忆录 · 纪念物`
 *   ② 今天可以做 —— 单张「左缩略图 + 右文字」横向卡：`给毛孩子换个新形象`
 *      （**固定文案，不拼宠物名** —— 2026-09-12 用户真机反馈，见下方「标题为什么固定写毛孩子」的决策记录）
 *   ③ 作品工坊   —— 一张左图右文的「回忆录」卡 + 两列宫格（形象工坊 / 名字工具）
 *   ④ ✨ 更多    —— 两列宫格（分享卡 / 表情包）
 *
 * ───────────────────────────────────────────────────────────────────────────
 * 【拆掉的四块（为什么）】v2 这一屏没有它们，且 IA 文档
 * （`星河宠记-信息架构重做方案v1.md`）明写「创作 = 把记录变成作品」，并点名
 * 「`pages/creative`：保留，但把『AI 管家』卡移走（→团团），只留生成类」：
 *   · 宠物主卡（头像 + 今日健康分 + 打卡状态）—— 健康数据归宠物档案，今天页已有摘要
 *   · 宠物切换器（`PetSwitcher`）—— 它跟着主卡一起走；今天页仍有同款切换器，多宠用户不丢能力
 *   · 「📋 今日」宫格（健康打卡 / AI 管家 / 家庭图谱 / 周报）—— 四条都在别处有入口
 *     （健康打卡＝今天页唯一入口；AI 管家＝团团；家庭图谱＝我的/家庭页；周报＝时光页）
 *   · 「✨ 更多」旧宫格（疫苗日历 / 健康报告）—— v2 脚注明写「疫苗/健康报告移出创作页
 *     （它们属健康档案）」；今天页有直达入口（`pages/index/index.tsx` 的 goNotice / goTrends）
 *
 * ⚠️ 上一条是**能力迁移**不是删除：本页移除的四类能力在别页均有正式入口，
 *    因此本页不保留任何"为了不丢功能"的残留卡片（v2 的四块结构 + 透明度基线是验收基准）。
 */

/** 「作品工坊」的宫格卡 / 「更多」的工具卡共用的色相枚举 */
type TileHue = 'coral' | 'gold' | 'sage' | 'teal'

/**
 * 「作品工坊」两张方形宫格主视觉的 key（与 TILE_ART 的取值一一对应）
 *
 * 单独抽成联合类型而不是用 string：拼错时 tsc 直接报错，
 * 而不是运行时取到 undefined、宫格悄悄变成一块空牌。
 */
type TileArtKey = 'avatar-studio' | 'naming'

/**
 * 方形宫格主视觉：**本地静态方图**，按当前主题取当季那张（2026-09-12 本批）
 *
 * 【为什么不再用 header-avatar-studio / header-naming】
 *   那两个 key 属 `HeaderIllustration`（**页头图**口径：960×540，主体偏左、右侧留标题位），
 *   塞进 1:1 方形宫格就成了「主体偏左 + 右侧一片空」—— 用户两次反馈「不符合比例」，
 *   并经确认「所有主题都有这个问题」。根因是**图的口径与控件比例不匹配**，不是样式没调好。
 *   本批换成本页新出的**专用方图**（320×320，主体居中、四边无预留位）：
 *   1:1 的方框配 1:1 的图，四边都不留位，也就没有可裁 / 可空的地方。
 *
 * 【为什么用本地图、不用服务器四季图】
 *   ① 服务器上没有方形版：`avatar-studio-<季>-hero.jpg` / `naming-<季>-card.jpg`
 *      本身就是页头口径的图（`data/illustrations.ts` 里这两个 key 也正指向它们）；
 *      本批方图**跟着创作页分包一起发**，8 张合计约 230KB，不动主包 2MB 那条红线。
 *   ② 宫格是**始终可见**的区域，本地图不依赖网络：弱网 / 无网也不会裂图。
 *   ⚠️ 必须**静态 import**（不能拼字符串路径）：拼出来的路径不参与打包，
 *      小程序端拿不到该资源，运行时表现为一块空白。
 *
 * 【主题 → 季节的口径】与 `data/illustrations.ts` 的 `illustrationUrl()` **完全一致**：
 *   四季主题取自己那一季；starry（星空银河）/ grid（奶油格纹）这类非四季主题
 *   一律回退 `DEFAULT_SEASON`（当前是 autumn）。渲染时用的是组件里的 tileSeason。
 */
const TILE_ART: Record<TileArtKey, Record<SeasonKey, string>> = {
  'avatar-studio': {
    spring: tileAvatarStudioSpring,
    summer: tileAvatarStudioSummer,
    autumn: tileAvatarStudioAutumn,
    winter: tileAvatarStudioWinter,
  },
  naming: {
    spring: tileNamingSpring,
    summer: tileNamingSummer,
    autumn: tileNamingAutumn,
    winter: tileNamingWinter,
  },
}

/**
 * 作品工坊 / 更多 里的**宫格卡**（两列布局，v2 的 `.banner.sq` + `.gtile`）
 *
 * 【2026-09-12 主视觉从服务器插画换成本地方图】
 *   原先这里传的是 `illustration`（`header-avatar-studio` / `header-naming`），
 *   由 `<Illustration>` 去服务器取四季图 —— 但那两个 key 是**页头图**口径，
 *   塞进 1:1 方框后用户两次反馈「不符合比例」（详见 TILE_ART 的注释）。
 *   现在方形卡改用 `art` 指向 TILE_ART 里的**专用方图**，按当前主题取当季那张；
 *   `illustration` 字段随之删除 —— 两张卡都不再需要它，不能留死字段。
 *
 * 【图标牌为什么还留着】方形卡里它垫在方图底下 —— 本地图必然能出，正常看不到它；
 * 万一本地方图缺失，露出来的也是一块与卡片同色相的实色牌，而不是空白方块，
 * 与全站「照片 → 品牌头像 → emoji」是同一套兜底思路。横排小卡里它是唯一视觉主体。
 */
type WorkshopTile = {
  key: string
  /**
   * 方形卡主视觉（**本地方图**，按当前主题取当季那张，见 TILE_ART）
   *
   * 可选：「作品工坊」两张方形卡必传；「更多」两张横排小卡按 v2 设计稿
   * **没有插画位**（见 renderMoreTiles 注释），故不传。省略 = 该卡不渲染主视觉图。
   */
  art?: TileArtKey
  /** 图标：方形卡里垫在方图下的实色牌（见上面的兜底说明）；横排小卡里是唯一的视觉主体 */
  icon: IconName
  /** 色相：图标牌底色 + 卡片淡底 */
  hue: TileHue
  title: string
  desc: string
  /** 目标路由（**必须已注册**，见 src/app.config.ts）；未上线能力留空串 */
  url: string
  /** true = 能力未上线，点击只提示、不跳转（如表情包），false/省略 = 正常跳转 */
  comingSoon?: boolean
}

/**
 * 「作品工坊」两列宫格：形象工坊 / 名字工具
 *
 * 【2026-09-12 本批两处改名与改指，都是 v2 + IA 明文要求】
 *   ① 形象工坊：路由由 `/pagesMemoir/studio/index`（103 行占位页，两张「趣味变装」卡点了只弹
 *      "即将上线"）**改指 `/pagesPet/avatar-customize/index`** —— 那才是真正的形象生成器
 *      （`AGENTS.md`/IA 第 2b 批口径：studio「并入 avatar-customize」）。
 *      ⚠️ studio 路由**仍然注册**在 `pagesMemoir` 分包里、页面文件也不删（本批只许改本页，
 *         且别处可能还有引用），只是**不再作为创作页的主入口**。
 *   ② 「AI 取名」→「**名字工具**」：IA 原文「改名（4 个模式里 3 个不是取名）」；
 *      路由不变，仍是 `pagesPet/naming/index`。
 */
const WORKSHOP_TILES: WorkshopTile[] = [
  {
    key: 'avatar-studio',
    art: 'avatar-studio',
    icon: 'palette',
    hue: 'coral',
    title: '形象工坊',
    desc: '15 种画风',
    url: '/pagesPet/avatar-customize/index',
  },
  {
    key: 'naming',
    art: 'naming',
    icon: 'note-pencil',
    hue: 'gold',
    title: '名字工具',
    desc: '取名 / 解读 / 灵感',
    url: '/pagesPet/naming/index',
  },
]

/**
 * 「✨ 更多」两列宫格：分享卡 / 表情包（v2 标注这里就是**透明度基准位**）
 *
 * ⚠️ 表情包的「即将上线」是**如实标注**，不是假按钮：
 *    全仓检索 `表情包|sticker|emoji-pack` 只在分享卡组件里命中过词，
 *    服务端与前端都**没有**生成表情包的能力。所以这条：
 *      · 不做假跳转（点了只弹「表情包生成即将上线」，不承诺任何不存在的权益）
 *      · 与 v2 画的 §4 区块**位置与文案一致**，等后端能力上线只需把 comingSoon 去掉、补 url
 *    分享卡则是**真能力**（`pagesPet/share-card/index` 已注册、`shareCardService` 已上线），正常跳转。
 */
const MORE_TILES: WorkshopTile[] = [
  {
    key: 'share-card',
    icon: 'share',
    hue: 'coral',
    title: '分享卡',
    desc: '做一张给家人',
    url: '/pagesPet/share-card/index',
  },
  {
    key: 'sticker',
    icon: 'smiley',
    hue: 'gold',
    title: '表情包',
    desc: '用它的脸做一套',
    url: '',
    comingSoon: true,
  },
]

/** 表情包未上线时的提示文案（唯一出口，避免文案散落两处） */
const STICKER_COMING_SOON_TIP = '表情包生成即将上线'

const CreativeHub = () => {
  /**
   * 主题类名：**必须挂在页面自己的根节点上**（2026-09-11 修复用户反馈「创作页没有跟随主题变化」）
   *
   * 为什么 app.js 那层不管用：`src/app.js` 确实把 `theme-{key}` 挂在了 `.app-root` 上，
   * 但那只在 **H5** 端成立 —— Taro 在 H5 里把 app 组件当成了页面的外壳。
   * **小程序端每个页面是独立渲染的，app 组件的 JSX 并不包裹页面节点**，
   * 所以 `.theme-starry` 这类类名的 CSS 变量根本传不到页面里。
   * 这也正是全站另外 7 个主页面各自调一次 useThemeClass() 的原因。
   *
   * 教训：主题相关改动**不能用 H5 渲染验证代替**，H5 的 app-root 会把问题盖住。
   */
  const themeClass = useThemeClass()
  /**
   * 宫格方形图要用的「当前季」（2026-09-12 本批新增）
   *
   * 主题 key 用和 `components/Illustration.tsx` **同一套读法**（`useThemeKey()`：
   * 内部是 local state + Taro.eventCenter 监听 themeChange —— Taro3 + zustand v3 下
   * 直接用 selector 订阅不可靠，所以不新造一套主题订阅）。
   * 非四季主题（starry / grid）回退默认季，与 `data/illustrations.ts` 的
   * `illustrationUrl()` 口径一致（那边同样是 isSeasonKey ? 自身 : DEFAULT_SEASON）。
   */
  const themeKey = useThemeKey()
  const tileSeason: SeasonKey = isSeasonKey(themeKey) ? themeKey : DEFAULT_SEASON
  /**
   * 广播「当前选中的是第 3 个 tab」给自定义 tabBar 组件（创作 = 下标 2）。
   *
   * 【为什么必须由页面主动广播】微信给**每个 tab 页各创建一个**自定义 tabBar 实例
   * （官方文档原话：每个 tab 页下的自定义 tabBar 组件实例是不同的），实例建好后就不随
   * `switchTab` 重新挂载，React 也不会因路由变化自动重渲染它 ——
   * 选中态只能由 tab 页在 `useDidShow` 时推进来，否则「页面切了、底部高亮不动」。
   *
   * 位置要求：组件函数体顶层、与其它 hook 同级（无条件调用，不能放进下面那个 useEffect 里）。
   * ⚠️ 这一行是本页的**硬要求**，任何改造都不许删。
   */
  useTabBarSelected('/pages/creative/index')
  const user = useAuthStore((s) => s.user)
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  const isInitialized = useAuthStore((s) => s.isInitialized)

  // 页面级未登录守卫：与其他 tab 页（mine/timeline/pet-profile）对齐——
  // 未登录进入创作页时统一走 redirectToLoginIfNeeded 收口跳登录页，
  // 避免创作页裸渲染出一堆点了没反应的入口却不引导登录（2026-09-11 修复，本批保留）。
  useEffect(() => {
    if (!isInitialized) return
    if (!isAuthenticated || !user) {
      redirectToLoginIfNeeded()
      return
    }
  }, [isInitialized, isAuthenticated, user])

  /**
   * 宫格卡片的统一点击处理（作品工坊 / 更多 两处共用）
   *
   * @param tile - 被试点的卡片
   * 行为：未上线的能力只提示、不跳转；其余一律 `navigateTo`。
   *
   * ⚠️ 本页**不做"有没有宠物"的前置拦截**（原实现有 `requirePet` 字段）：
   *    按 v2 重做后本页不再读取任何宠物数据，而三个目标页各自都有
   *    ① 登录态处理 ② 无宠物/无数据的空态引导（本批已逐个核对页面实现），
   *    在本页再拦一道反而会挡住"想先看看能做什么"的新用户。
   *    所以那个字段连同它的注释一并删掉，避免留下"文档说有拦截、代码里没有"的坑。
   *
   * ⚠️ 本页是 **tab 页**，但这里所有目标（avatar-customize / naming / share-card）
   *    都是**普通页面**，所以只能 `navigateTo`；用 `switchTab` 会静默失败（不报错、页面不动）。
   */
  const handleTileTap = (tile: WorkshopTile) => {
    if (tile.comingSoon || !tile.url) {
      Taro.showToast({ title: STICKER_COMING_SOON_TIP, icon: 'none' })
      return
    }
    Taro.navigateTo({ url: tile.url })
  }

  /*
   * 【决策记录：标题为什么固定写「毛孩子」，不再拼当前宠物名】（原 petName 订阅已随之删除）
   *
   * 2026-09-12 用户真机反馈：「这个不要署名可乐 用毛孩子」
   * （可乐 = 原型稿/测试账号里的宠物名，用户截图里出现了它）。
   * 于是「今天可以做」那张卡的标题**固定为「给毛孩子换个新形象」**。
   *
   * 上一版写法是 `给${当前宠物名}换个新形象`、无宠物时回退「毛孩子」——现在一律用「毛孩子」，
   * 那行 selector 连同 `usePetStore` 的 import 一并删除：本页**不再读取任何宠物数据**
   * （这也是上一节 handleTileTap 注释里那句"按 v2 重做后本页不再读取任何宠物数据"的兑现；
   *  留着一个没人用的订阅只会让人误以为标题还跟宠物走）。
   *
   * 代价与理由（为什么明知"更贴心"还是要去掉宠物名）：
   *   ① 多宠物账号下写某一只有**歧义** —— 这张卡点进去是通用的形象生成器
   *      （`avatar-customize` 里自己选宠物），并不针对标题里那只生效；
   *   ② 品牌文案要**通用**：页面标题不该随账号数据漂移（宠物改名/删除后，标题也跟着变，
   *      同一张卡的文案在不同用户那里不一致，截图、客服话术、验收基准都无法对齐）。
   *
   * ⚠️ 不要再把宠物名拼回来：`__tests__/index.test.tsx` 有一条回归断言锁住了这一点 ——
   *    把 store 里的宠物名设成项目历史上那个著名事故名「烧鸡」，页面上也不许出现该名字。
   */

  /** 渲染一片两列宫格（作品工坊 / 更多共用，避免以后只改一处漏改另一处） */
  const renderTiles = (list: WorkshopTile[]) => (
    <View className='cve-grid2'>
      {list.map((t) => (
        /*
         * 【className 里那截 `cve-tile--soon` 是**预留类名**，不是漏写样式】
         * 它目前**永远不会命中**：`WORKSHOP_TILES`（本文件 :90，= 形象工坊 + 名字工具）里
         * 没有任何一项带 `comingSoon`；全页唯一 `comingSoon: true` 在 `MORE_TILES`（:121，表情包），
         * 那一组走的是下面的 `.cve-gtile` 分支，与本处这套方形宫格的类名无关。
         * 因此 scss 里也**暂无** `.cve-tile--soon` 规则 —— `creative/index.scss:357` 那个 `&--soon`
         * 在 `.cve-gtile` 块内（`.cve-gtile` 从 :298 开始），展开是 `.cve-gtile--soon`。
         * 【为什么保留这截拼接】方形宫格将来可能有未上线项，模板分支留着，到时候只补样式即可。
         * ⚠️ 将来往 `WORKSHOP_TILES` 里加 `comingSoon: true` 的项时，记得**同步补 `.cve-tile--soon` 样式**：
         *    最小口径是禁用观感 + `pointer-events: none`（禁止点击），否则那张卡只有角标「即将上线」
         *    却依然显示成可点入口，点进去什么也没有 —— 那正是注释里反复强调的"假按钮"。
         */
        <View
          key={t.key}
          className={`cve-tile cve-tile--${t.hue}${t.comingSoon ? ' cve-tile--soon' : ''}`}
          hoverClass='cve-tile--hover'
          onClick={() => handleTileTap(t)}
        >
          {/* 主视觉：方形插画框（1:1）—— 1:1 这个口径来自原型 CSS（`.banner.sq` 的原话：
              按原比例各缩会出现「左边矮一截、说明条上沿差 49px」）。
              2026-09-12 本批换成专用方图（320×320、主体居中）后，两张图**本身就是 1:1**，
              不再需要靠「把不同比例的图都当方图用」来对齐；
              同日起这个框**满铺卡片**（卡片 padding 归零、只圆上两角），主视觉不再被内边距缩一圈。 */}
          <View className='cve-tile__pic'>
            <Icon name={t.icon} size={28} tone='white' className='cve-tile__icon' />
            {/* 主视觉 = **本地方图**（见 TILE_ART，按当前季取那张）：只有「作品工坊」这两张方形卡有。
                「更多」的两张横排小卡走 renderMoreTiles 那个分支，本来就没有插画位。
                ⚠️ 这里必须用原生 Image 组件，不能换回服务器插画组件 —— 后者只认服务端那套 key 图库，
                   取不到本地资源（本批方图没上传服务器），换回去就是一块空白。 */}
            {t.art ? (
              <Image className='cve-tile__illus' src={TILE_ART[t.art][tileSeason]} mode='aspectFill' />
            ) : null}
            {/* 未上线的能力在卡片上如实标注，不靠用户点了才知道。
                ⚠️ 必须放在**方形插画框内**（绝对定位在左上角），不能挂在卡片流里：
                   实测（2026-09-12 真机量尺）挂在卡片底部会让含角标的那张卡高 20px
                   （无角标的 `175×175` vs 有角标的 `175×195`）—— 同一行两张卡不等高，
                   v2 的方形宫格就歪了。放进插画框后四张卡尺寸完全一致。 */}
            {t.comingSoon ? <Text className='cve-tile__badge'>即将上线</Text> : null}
          </View>
          {/* 说明条：**排在方形主视觉下方**的独立文字区（2026-09-12 用户反馈「图片太小/被压住」后改）。
              ⚠️ 它必须留在 `.cve-tile__pic` 的**外面**，这不是排版偏好而是几何硬约束：
                 pic 靠 `padding-top: 100%` 撑出 1:1，而框内那张绝对定位的插画用的是 `height: 100%` ——
                 绝对定位元素的百分比高度算的是包含块的 **padding box**。说明条只要还留在 pic 里
                 （即使改成普通文档流、不再绝对定位），这个盒子就会被文字撑高，
                 插画随之被拉长并压到文字下面（正是用户要修的那个"被压住"），
                 同时 pic 那层实色底牌也会铺到文字后面。所以这里是**结构性的一步外移**，不是为了好看。 */}
          <View className='cve-tile__cap'>
            <Text className='cve-tile__title'>{t.title}</Text>
            <Text className='cve-tile__desc'>{t.desc}</Text>
          </View>
        </View>
      ))}
    </View>
  )

  /**
   * 「更多」区的两张**横排小卡**（v2 的 `.card.gtile`：图标牌 + 右侧标题/说明）
   *
   * 【为什么这两张不做成方形插画卡】v2 设计稿在这两个位置**根本没有插画位** ——
   * 原型 `screenCreative()` 里它们是 `.card.gtile` + `<span class="gi tone-x">` 的
   * **36×36 图标牌 + 右侧两行文字**（横排小卡）。
   * 实现当初给这两张卡配了 1:1 插画，用的还是**旧 IP**素材：`share-card-warm` 实测是
   * **750×422 的 16:9 分享卡背景图、主体在右下角**，塞进 1:1 + `aspectFill`（小程序只能居中裁切、
   * 没法像设计稿那样指定 `object-position: left center`）→ **居中裁掉约 44% 宽度、连猫头都切掉**。
   * 用户 2026-09-12 截图反馈「图片根本不符合控件大小，硬塞看得很难受」，指的就是这两张。
   * 删掉插画＝回到设计稿本身，不是"少做了一块"。
   *
   * 【图标为什么仍用 Icon 而不是 v2 的 emoji】项目已把 v2 的 emoji 占位统一换成 Phosphor 图标，
   * 同页「作品工坊」的四张牌也是 Icon；这里跟着用 Icon 才不会在同一种元素里出现两套图标语言。
   */
  const renderMoreTiles = (list: WorkshopTile[]) => (
    <View className='cve-gtiles'>
      {list.map((t) => (
        <View
          key={t.key}
          className={`cve-gtile cve-gtile--${t.hue}${t.comingSoon ? ' cve-gtile--soon' : ''}`}
          hoverClass='cve-gtile--hover'
          onClick={() => handleTileTap(t)}
        >
          <View className='cve-gtile__plate'>
            <Icon name={t.icon} size={18} tone='white' />
          </View>
          <View className='cve-gtile__texts'>
            <Text className='cve-gtile__title'>{t.title}</Text>
            <Text className='cve-gtile__desc'>{t.desc}</Text>
          </View>
          {/* 行尾信号二选一：未上线 → 「即将上线」角标；**已上线的真能力 → 一枚"可点"箭头**
              （2026-09-12 用户反馈「这两个控件都没有优化 太丑了」）。
              ⚠️ 未上线的卡**不给箭头**：整行白玻璃卡原本没有任何"点了会走"的暗示，加箭头是对的，
                 但给一个点不动的能力加箭头就是本页注释反复强调的「假按钮」。
              箭头用 Icon（同页图标语言一致），尺寸压到 13px、tone='muted' 只做轻提示，不抢主视觉。 */}
          {t.comingSoon ? (
            <Text className='cve-gtile__badge'>即将上线</Text>
          ) : (
            <Icon name='caret-right' size={13} tone='muted' className='cve-gtile__chev' />
          )}
        </View>
      ))}
    </View>
  )

  return (
    <View className={`cve ${themeClass}`}>
      <PageBackground />

      {/* ===== ① 页头横幅（始终可见，不受"有没有数据"影响） =====
          v2 这一块是「猫狗一起画画」的品牌插画 + 右侧两行标题。
          实现走全站共用的 <PageHero>（今天/时光/家庭/我的/宠物档案都是它），
          `className='cve-hero-art'` 用来把组件默认的暖橙底色换成
          与本张插画右缘同色的底，避免插画与底色之间裂出一条硬缝（详见 scss 注释）。

          【标题为什么不照抄 v2 的 whero 原文】v2 的 whero 写的是「你的宠物值得一件作品」，
          但这句话**无主语、无动词**，读起来像广告口号，而且它待在页面最上方，
          很容易被当成"页面标题"（用户 2026-09-12 截图提出：「这个标题怪怪的，这是页面标题吗？」）。
          本页真正的页面标题是原生导航栏的「创作」；这一行是**板块说明**，
          因此改用 v2 **自绘顶栏**的副标题「把回忆做成作品」—— 动词开头、说清了这页能干什么，
          且仍是设计稿里的原文（不是我们自己编的）。副标题「形象 · 回忆录 · 纪念物」照旧。 */}
      <PageHero
        illustration='page-creative'
        title='把回忆做成作品'
        subtitle='形象 · 回忆录 · 纪念物'
        className='cve-hero-art'
      />

      {/* ===== ② 今天可以做（单张横卡，左缩略图 + 右文字） ===== */}
      <View className='cve-sec'>
        <View className='cve-sec__head'>
          <View className='cve-sec__dot' />
          <Text className='cve-sec__title'>今天可以做</Text>
        </View>
        <View
          className='cve-today'
          hoverClass='cve-today--hover'
          onClick={() => Taro.navigateTo({ url: '/pagesPet/avatar-customize/index' })}
        >
          <View className='cve-today__thumb'>
            <Illustration name='grid-agent' fill mode='aspectFill' className='cve-today__illus' />
          </View>
          <View className='cve-today__body'>
            {/* 文案固定为通用称呼「毛孩子」，不拼宠物名（决策记录见文件上方） */}
            <Text className='cve-today__title'>给毛孩子换个新形象</Text>
            {/* 文案照 v2 原文。⚠️ 这 15/12 是 avatarPresets 的真实数量口径，
                若以后预设增加，这里要同步（不许改成拍脑袋的数字） */}
            <Text className='cve-today__desc'>15 种画风 · 12 种表情，生成后自动放进档案</Text>
          </View>
        </View>
      </View>

      {/* ===== ③ 作品工坊（一横卡 + 两列宫格） ===== */}
      <View className='cve-sec'>
        <View className='cve-sec__head'>
          <View className='cve-sec__dot' />
          <Text className='cve-sec__title'>作品工坊</Text>
          {/* 右侧副文案：v2 原文，用来说明"点进去就是完整流程、不再分子页面" */}
          <Text className='cve-sec__more'>点进去就是流程 ›</Text>
        </View>

        {/* 回忆录：v2 从"整宽横幅"改成了「左图右文」——
            原型注释原话：1254×1254 的方图整幅纵向都有内容，横切成横幅必切掉一颗头；
            改成左图右文后插画零裁切，卡片高度也从 341px 降到 150px。 */}
        <View
          className='cve-memoir'
          hoverClass='cve-memoir--hover'
          onClick={() => Taro.navigateTo({ url: '/pagesMemoir/memoir-center/index' })}
        >
          <View className='cve-memoir__pic'>
            <Illustration name='header-memoir' fill mode='aspectFit' className='cve-memoir__illus' />
            {/* 由透明到暖白的横向渐变：插画按原始比例居中显示（aspectFit 不裁切），
                左右两侧会留出底色 —— 这层渐变把"图与底色"的边界抹平，
                同时保证右侧文字始终可读（v2 那张卡同样是图右缘直接接纯色区） */}
            <View className='cve-memoir__scrim' />
          </View>
          <View className='cve-memoir__body'>
            <Text className='cve-memoir__title'>回忆录</Text>
            {/* 文案照 v2 原文：档位在页内选，不再分三个页面（对应 IA 第 2d 批删掉 memoir-vlog 入口页） */}
            <Text className='cve-memoir__desc'>三档位在页内选，不再分三个页面</Text>
          </View>
        </View>

        {renderTiles(WORKSHOP_TILES)}
      </View>

      {/* ===== ④ ✨ 更多（两张**横排小卡**，v2 的 `.card.gtile`；v2 标注这一块是"透明度基准位"） =====
          不用方形插画卡：设计稿这两个位置没有插画位（详见 renderMoreTiles 的注释） */}
      <View className='cve-sec'>
        <View className='cve-sec__head'>
          <View className='cve-sec__dot' />
          <Text className='cve-sec__title'>✨ 更多</Text>
        </View>
        {renderMoreTiles(MORE_TILES)}
      </View>
    </View>
  )
}

export default CreativeHub
