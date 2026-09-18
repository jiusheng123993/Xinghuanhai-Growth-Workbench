/**
 * 创作页 · 按高保真 v2 第 4 屏重做后的回归测试（2026-09-12 本批）
 *
 * 【为什么要测】本批把创作页整屏换成 v2 的四块结构，其中两条是**改指/改名**——
 * 改指改错的后果是"用户点进去看到一个只弹『即将上线』的占位页"，而这种错误
 * 光看截图发现不了（卡片长得一模一样）。所以本文件锁五件事：
 *   1. **形象工坊必须指 `/pagesPet/avatar-customize/index`**（真正的形象生成器），
 *      且**不许再出现 `/pagesMemoir/studio/index`**（103 行占位页，IA 已定"并入 avatar-customize"）。
 *   2. 「AI 取名」已按 v2 改名「**名字工具**」，路由仍是 `pagesPet/naming/index`。
 *   3. v2 的三个区块文案与「即将上线」的**如实标注**：表情包点下去只提示、不跳转
 *      （后端根本没有表情包生成能力，做假跳转就是"假按钮"）。
 *   4. 「今天可以做」那张卡的标题**固定为「给毛孩子换个新形象」**，不拼宠物名：
 *      2026-09-12 用户真机反馈「这个不要署名可乐 用毛孩子」—— 页面标题不随账号里的宠物名变
 *      （多宠物账号下写某一只有歧义、品牌文案要通用）。
 *      本文件为此留了一条**回归**：把 store 里的宠物名设成「烧鸡」，页面上也不许出现宠物名。
 *   5. **「作品工坊」两张方形宫格的主视觉是本地方图、且按当前季取**（2026-09-12 本批）：
 *      这两张卡原先走 `header-avatar-studio` / `header-naming` —— 那是**页头图**口径
 *      （960×540、主体偏左、右侧留标题位），塞进 1:1 方框被用户两次反馈「不符合比例」。
 *      现在换成本地专用方图（320×320、主体居中）并按主题换季，断言见下方两个用例。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import { createElement } from 'react'
import CreativeHub from '../index'
// 方形宫格那两个主视觉用的本地图：测试里 import **同一批资源**，是为了下面用「字符串相等」
// 断言渲染出来的 src —— 比断言路径片段更稳：无论打包器把 .jpg 解析成文件路径还是内联成
// dataURI，两边取到的都是同一个值，而「取错季 / 取错卡」照样会被抓出来。
import tileAvatarStudioSpring from '../assets/tile-avatar-studio-spring.jpg'
import tileAvatarStudioAutumn from '../assets/tile-avatar-studio-autumn.jpg'
import tileNamingSpring from '../assets/tile-naming-spring.jpg'
import tileNamingAutumn from '../assets/tile-naming-autumn.jpg'

// ── 可变 mock 状态（vi.mock 的工厂会被提升，必须用 vi.hoisted 暴露）──
const mocks = vi.hoisted(() => ({
  taro: {
    navigateTo: vi.fn(),
    switchTab: vi.fn(),
    showToast: vi.fn(),
    setNavigationBarTitle: vi.fn(),
  },
  petState: {
    currentPet: null as any,
    pets: [] as any[],
  },
  tabBarSelected: vi.fn(),
  redirectToLogin: vi.fn(),
}))

vi.mock('@tarojs/components', () => ({
  View: ({ children, className, hoverClass, onClick }: any) =>
    createElement('div', { className, 'data-hover': hoverClass, onClick }, children),
  Text: ({ children, className }: any) => createElement('span', { className }, children),
  Image: ({ src, className }: any) => createElement('img', { src, className }),
}))

vi.mock('@tarojs/taro', () => ({ default: mocks.taro }))

vi.mock('../../../stores/authStore', () => ({
  useAuthStore: (selector: any) =>
    selector({
      user: { id: 'user_1', nickname: '张河彬', avatar: '' },
      isAuthenticated: true,
      isInitialized: true,
    }),
}))

// 宠物 store：**2026-09-12 起创作页已经不再 import 它**（标题固定「毛孩子」，本页不读宠物数据）。
// 这个 mock 是**故意留着**的：下面那条回归断言正是"把 currentPet 设成「烧鸡」，页面上不许出现它"——
// 万一以后有人又把宠物名拼回标题（import 会重新生效），这把锁依旧拦得住。
vi.mock('../../../stores/petStore', () => ({
  usePetStore: (selector: any) => selector(mocks.petState),
}))

// 数据层插画注册表只为「主题 → 季节」的**口径统一**被 import（isSeasonKey / DEFAULT_SEASON），
// 它依赖的 services/api 换成极简替身即可 —— 与 components/__tests__/Illustration.test.tsx 同一做法，
// 免得把 api 那一长串依赖（Taro storage、mock 数据、config）拖进这层组件测试。
vi.mock('../../../services/api', () => ({
  resolveAvatarUrl: (path: string) => `https://api.xinghuanhai.com${path}`,
}))

/**
 * 主题 hook（**可变**）
 *
 * 2026-09-12 本批起「方形宫格的主视觉按当前季取图」，所以这里要同时给出类名**和**主题 key：
 * 页面改用 useThemeKey() 读季节，mock 里缺这个导出的话页面会直接崩。
 * 用可变对象而不是写死值 —— 下面的取图用例会临时改成 spring / starry，
 * 分别验证「四季主题取当季」与「非四季主题回退默认季」两种口径。
 */
const themeState = vi.hoisted(() => ({ key: 'autumn' as string }))
vi.mock('../../../hooks/useThemeClass', () => ({
  useThemeClass: () => `theme-${themeState.key}`,
  useThemeKey: () => themeState.key,
}))

// 每个用例开始前把主题复位成 autumn（四季之一），避免上一个用例改过的主题串到下一个
beforeEach(() => {
  themeState.key = 'autumn'
})

// 自定义 tabBar 的选中态广播：本页**必须**调用它（删了底部高亮不动），测试里只需记录调用
vi.mock('../../../constants/tabBar', () => ({ useTabBarSelected: mocks.tabBarSelected }))

vi.mock('../../../utils/authGuard', () => ({ redirectToLoginIfNeeded: mocks.redirectToLogin }))

// 三个共用组件在 jsdom 里不需要真渲染（插画是网络图、图标是 data URI）
vi.mock('../../../components', () => ({
  Icon: () => null,
  Illustration: () => null,
  PageBackground: () => null,
  PageHero: ({ illustration, title, subtitle }: any) =>
    createElement('div', { className: 'page-hero', 'data-illustration': illustration },
      createElement('span', { className: 'page-hero__title' }, title),
      createElement('span', { className: 'page-hero__subtitle' }, subtitle)),
}))

/** 取某片宫格里所有卡片的类名 + 主文案 + 副文案 */
function readTiles(root: HTMLElement) {
  return Array.from(root.querySelectorAll('.cve-tile')).map((el) => ({
    className: (el as HTMLElement).className,
    title: el.querySelector('.cve-tile__title')?.textContent ?? '',
    desc: el.querySelector('.cve-tile__desc')?.textContent ?? '',
    badge: el.querySelector('.cve-tile__badge')?.textContent ?? '',
  }))
}

/**
 * 取「更多」区横排小卡的类名 + 主文案 + 副文案
 *
 * 【为什么另开一个读取函数】2026-09-12 起「更多」不再是方形插画卡，而是 v2 设计稿
 * 原本的 `.gtile` 横排小卡（36×36 图标牌 + 右侧两行字）—— 那两个位置**设计稿没有插画位**，
 * 实现当初却给它们配了 1:1 插画，用的还是旧 IP 的 16:9 分享卡背景图，
 * 塞进 1:1 + aspectFill 会居中裁掉约 44% 宽度、连猫头都切掉（用户截图反馈"硬塞"）。
 * 选择器换了，但下面几条断言的**意图一字未改**：文案照 v2、分享卡真跳转、表情包如实标注。
 */
function readMoreTiles(root: HTMLElement) {
  return Array.from(root.querySelectorAll('.cve-gtile')).map((el) => ({
    className: (el as HTMLElement).className,
    title: el.querySelector('.cve-gtile__title')?.textContent ?? '',
    desc: el.querySelector('.cve-gtile__desc')?.textContent ?? '',
    badge: el.querySelector('.cve-gtile__badge')?.textContent ?? '',
  }))
}

/** 按主文案找那一张方形宫格卡（找不到返回 null） */
function findTile(title: string): HTMLElement | null {
  const hit = Array.from(document.querySelectorAll('.cve-tile')).find(
    (el) => el.querySelector('.cve-tile__title')?.textContent === title,
  )
  return (hit as HTMLElement) ?? null
}

/** 按主文案找那一张「更多」横排小卡（找不到返回 null） */
function findMoreTile(title: string): HTMLElement | null {
  const hit = Array.from(document.querySelectorAll('.cve-gtile')).find(
    (el) => el.querySelector('.cve-gtile__title')?.textContent === title,
  )
  return (hit as HTMLElement) ?? null
}

describe('创作页 - v2 第 4 屏四块结构', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.petState.currentPet = { id: 'pet_1', name: '可乐', species: 'cat', breed: '橘猫' }
    mocks.petState.pets = [mocks.petState.currentPet]
  })

  it('页头横幅渲染标题与副标题，且插画用 page-creative（季节图随主题走）', () => {
    const { container } = render(createElement(CreativeHub))
    const hero = container.querySelector('.page-hero') as HTMLElement
    expect(hero.getAttribute('data-illustration')).toBe('page-creative')
    // 2026-09-12：标题由 v2 whero 原文「你的宠物值得一件作品」改为 v2 自绘顶栏的副标题
    // 「把回忆做成作品」—— 前者无主语无动词、像广告口号，且位置在页顶容易被误当页面标题
    // （用户截图提出「这个标题怪怪的，这是页面标题吗？」）。
    // 断言的**性质**没变：页头必须同时渲染标题与副标题，两行都非空。
    expect(container.querySelector('.page-hero__title')?.textContent).toBe('把回忆做成作品')
    expect(container.querySelector('.page-hero__subtitle')?.textContent).toBe('形象 · 回忆录 · 纪念物')
  })

  it('三个区块标题与顺序照 v2：今天可以做 → 作品工坊 → ✨ 更多', () => {
    const { container } = render(createElement(CreativeHub))
    const titles = Array.from(container.querySelectorAll('.cve-sec__title')).map((el) => el.textContent)
    expect(titles).toEqual(['今天可以做', '作品工坊', '✨ 更多'])
    // 「作品工坊」标题右侧的副文案也是 v2 原文
    expect(container.querySelector('.cve-sec__more')?.textContent).toBe('点进去就是流程 ›')
  })

  it('「今天可以做」标题不再拼宠物名：一律显示「给毛孩子换个新形象」', () => {
    // 【回归断言 · 本次要锁的规矩】把当前宠物名设成项目历史上那个著名事故名「烧鸡」：
    // 标题若还在拼宠物名（上一版写法 `给${petName}换个新形象`），这里会渲染成「给烧鸡换个新形象」。
    // 2026-09-12 用户真机反馈「这个不要署名可乐 用毛孩子」—— 这条断言就是那把锁：
    // 结果必须是通用称呼，且**页面上任何位置都不许出现宠物名**（可乐/烧鸡 都不许）。
    mocks.petState.currentPet = { id: 'pet_9', name: '烧鸡', species: 'cat', breed: '橘猫' }
    render(createElement(CreativeHub))
    expect(document.querySelector('.cve-today__title')?.textContent).toBe('给毛孩子换个新形象')
    expect(document.body.textContent).not.toContain('烧鸡')
    expect(document.body.textContent).not.toContain('可乐')
    // 15 画风 / 12 表情是 avatar-customize 里 GEN_STYLES / GEN_EXPRESSIONS 的真实条数
    expect(document.querySelector('.cve-today__desc')?.textContent)
      .toBe('15 种画风 · 12 种表情，生成后自动放进档案')
  })

  it('无宠物时标题同样是「给毛孩子换个新形象」（标题与宠物数据无关，已不存在回退分支）', () => {
    // 这一条在新行为下与"有宠物"的结果相同 —— 保留它是为了锁住**本页不依赖宠物数据**：
    // 无宠物（store 为空）时标题既不能变成 undefined，也不能冒出别的文案
    // （原实现这里走的是 `|| '毛孩子'` 回退分支，那个分支已随 selector 一起删除）。
    mocks.petState.currentPet = null
    render(createElement(CreativeHub))
    expect(document.querySelector('.cve-today__title')?.textContent).toBe('给毛孩子换个新形象')
  })

  it('「今天可以做」与「回忆录」都是真实路由（navigateTo，不是 switchTab）', () => {
    render(createElement(CreativeHub))
    fireEvent.click(document.querySelector('.cve-today') as HTMLElement)
    expect(mocks.taro.navigateTo).toHaveBeenCalledWith({ url: '/pagesPet/avatar-customize/index' })
    // 本页是 tab 页，但目标是普通页面 —— 用 switchTab 会静默失败，断言它一次都没被调用
    expect(mocks.taro.switchTab).not.toHaveBeenCalled()

    fireEvent.click(document.querySelector('.cve-memoir') as HTMLElement)
    expect(mocks.taro.navigateTo).toHaveBeenCalledWith({ url: '/pagesMemoir/memoir-center/index' })
    expect(document.querySelector('.cve-memoir__desc')?.textContent)
      .toBe('三档位在页内选，不再分三个页面')
  })
})

describe('创作页 - 作品工坊 / 更多 的宫格（v2 第 3、4 块）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.petState.currentPet = { id: 'pet_1', name: '可乐', species: 'cat', breed: '橘猫' }
    mocks.petState.pets = [mocks.petState.currentPet]
  })

  it('两片宫格：作品工坊两张方形插画卡 + 更多两张横排小卡，文案照 v2 原文', () => {
    const { container } = render(createElement(CreativeHub))
    // 「作品工坊」= 方形插画卡（v2 的 .banner.sq）
    expect(readTiles(container as HTMLElement).map((t) => `${t.title}|${t.desc}`)).toEqual([
      '形象工坊|15 种画风',
      '名字工具|取名 / 解读 / 灵感',
    ])
    // 「更多」= 横排小卡（v2 的 .gtile），**没有插画位** —— 文案仍照 v2 原文
    expect(readMoreTiles(container as HTMLElement).map((t) => `${t.title}|${t.desc}`)).toEqual([
      '分享卡|做一张给家人',
      '表情包|用它的脸做一套',
    ])
    // 关键回归：这两张卡**不许**再挂插画（旧 IP 的 16:9 分享卡背景图塞进 1:1 会被裁掉猫头）
    expect(container.querySelectorAll('.cve-gtile .cve-tile__illus')).toHaveLength(0)
    expect(container.querySelectorAll('.cve-gtile illustration')).toHaveLength(0)
  })

  it('【本批硬要求】两张方形宫格改用本地专用方图：按当前季取，且不再是页头图', () => {
    const { container } = render(createElement(CreativeHub))
    // mock 的当前主题是 autumn（四季之一）→ 取「秋」那张本地方图
    const illus = Array.from(container.querySelectorAll('.cve-tile__illus'))
    expect(illus).toHaveLength(2)
    expect(illus.map((el) => el.getAttribute('src'))).toEqual([
      tileAvatarStudioAutumn,
      tileNamingAutumn,
    ])
    // 这一条专门抓「写回页头图」：页头图是**服务器 URL**（https://api.../uploads/...）——
    // 一旦有人把宫格换回 <Illustration name='header-avatar-studio'>，src 就不再是本地资源；
    // 而且 <Illustration> 在本文件里是 mock 成 null 的，那时这两个元素压根不存在，
    // 上面那条 toHaveLength(2) 会先红。所以「换回去」这条路一定会被拦下。
    illus.forEach((el) => {
      expect(el.getAttribute('src')).not.toContain('/uploads/')
      expect(el.getAttribute('src')).not.toContain('header-')
    })
  })

  it('宫格方图随主题换季；starry 这类非四季主题回退默认季（与 illustrationUrl 口径一致）', () => {
    themeState.key = 'spring'
    const spring = render(createElement(CreativeHub))
    expect(
      Array.from(spring.container.querySelectorAll('.cve-tile__illus')).map((el) => el.getAttribute('src')),
    ).toEqual([tileAvatarStudioSpring, tileNamingSpring])
    spring.unmount()

    // starry（星空银河）/ grid（奶油格纹）没有四季插画，一律回退 DEFAULT_SEASON（autumn）。
    // 这条锁的是「口径一致」：宫格取图与服务端四季插画必须回退到同一季，
    // 否则星空主题下会出现「页头是秋景、宫格却是别的季」这种谁都想不到的错配。
    themeState.key = 'starry'
    const starry = render(createElement(CreativeHub))
    expect(
      Array.from(starry.container.querySelectorAll('.cve-tile__illus')).map((el) => el.getAttribute('src')),
    ).toEqual([tileAvatarStudioAutumn, tileNamingAutumn])
    starry.unmount()
  })

  it('【本批硬要求】形象工坊改指 avatar-customize，且不再出现 studio 占位页', () => {
    render(createElement(CreativeHub))
    fireEvent.click(findTile('形象工坊') as HTMLElement)
    expect(mocks.taro.navigateTo).toHaveBeenCalledWith({ url: '/pagesPet/avatar-customize/index' })
    // studio 是 103 行占位页（两张「趣味变装」卡点了只弹"即将上线"），IA 已定并入 avatar-customize
    expect(mocks.taro.navigateTo).not.toHaveBeenCalledWith(
      expect.objectContaining({ url: expect.stringContaining('studio') }),
    )
  })

  it('【本批硬要求】「AI 取名」已改名「名字工具」，路由仍是 naming（无宠物也进得去）', () => {
    render(createElement(CreativeHub))
    // 旧名不许再出现在页面上
    expect(document.body.textContent).not.toContain('AI 取名')
    fireEvent.click(findTile('名字工具') as HTMLElement)
    expect(mocks.taro.navigateTo).toHaveBeenCalledWith({ url: '/pagesPet/naming/index' })
  })

  it('分享卡是真能力，正常跳转', () => {
    render(createElement(CreativeHub))
    fireEvent.click(findMoreTile('分享卡') as HTMLElement)
    expect(mocks.taro.navigateTo).toHaveBeenCalledWith({ url: '/pagesPet/share-card/index' })
  })

  it('表情包如实标注「即将上线」：点了只提示、不跳转、不假装有这能力', () => {
    render(createElement(CreativeHub))
    const sticker = findMoreTile('表情包') as HTMLElement
    expect(sticker.querySelector('.cve-gtile__badge')?.textContent).toBe('即将上线')
    expect(sticker.className).toContain('cve-gtile--soon')

    fireEvent.click(sticker)
    expect(mocks.taro.showToast).toHaveBeenCalledWith({ title: '表情包生成即将上线', icon: 'none' })
    expect(mocks.taro.navigateTo).not.toHaveBeenCalled()
  })

  it('tabBar 选中态广播照旧（删了底部高亮就不动）', () => {
    render(createElement(CreativeHub))
    expect(mocks.tabBarSelected).toHaveBeenCalledWith('/pages/creative/index')
  })
})
