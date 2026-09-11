/**
 * themeStore 测试
 *
 * 这个 store 管两件事：① 6 套背景主题（含深色「星空银河」）② 宠物照片壁纸。
 * 关键约定：持久化、原生导航栏同步、以及深色主题标记 —— 任一条坏了都会表现为
 * 「切了背景没反应」或「深色背景下文字看不见」，所以逐条锁住。
 *
 * 2026-09-12（IA 第 3 批）变更：底部导航改成**自定义 tabBar**（app.config 的
 * tabBar.custom: true），微信原生标签栏不再渲染，因此：
 *  · `Taro.setTabBarStyle` / `Taro.setTabBarItem` 全部失效 → 本文件改为断言
 *    **它们一次都不许被调用**（防止后人把失效链路又加回来）；
 *  · 标签栏图标改为「组件按主题选目录渲染」→ 由 `getTabBarIconDir()` 提供根路径，
 *    原「切主题逐个 setTabBarItem 换 5 个图标」的用例已删除。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// vi.mock 会被提升到文件顶部，工厂里引用的变量必须用 vi.hoisted 提前初始化
// 注：两个原生栏 mock 显式声明可选入参，否则 TS 推断 calls 为空元组，取 calls[0][0] 会报越界
const { storage, mockSetNavigationBarColor, mockSetTabBarStyle, mockSetTabBarItem, mockTrigger } =
  vi.hoisted(() => ({
    storage: new Map<string, any>(),
    mockSetNavigationBarColor: vi.fn((_opts?: any) => Promise.resolve()),
    mockSetTabBarStyle: vi.fn((_opts?: any) => Promise.resolve()),
    mockSetTabBarItem: vi.fn((_opts?: any) => Promise.resolve()),
    mockTrigger: vi.fn(),
  }))

vi.mock('@tarojs/taro', () => ({
  default: {
    getStorageSync: (k: string) => storage.get(k),
    setStorageSync: (k: string, v: any) => storage.set(k, v),
    removeStorageSync: (k: string) => storage.delete(k),
    setNavigationBarColor: mockSetNavigationBarColor,
    setTabBarStyle: mockSetTabBarStyle,
    setTabBarItem: mockSetTabBarItem,
    eventCenter: { trigger: mockTrigger, on: vi.fn(), off: vi.fn() },
  },
}))

vi.mock('zustand', () => ({
  default: (init: any) => {
    // 极简 store 实现：够本测试验证 set/get 行为
    let state: any
    const set = (patch: any) => {
      state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) }
    }
    state = init(set)
    const api: any = (selector?: any) => (selector ? selector(state) : state)
    api.getState = () => state
    api.setState = (patch: any) => set(patch)
    return api
  },
}))

// eslint-disable-next-line import/first
import { useThemeStore, THEME_LIST, isDarkTheme, getThemeMeta, getTabBarIconDir } from '../themeStore'

describe('themeStore', () => {
  beforeEach(() => {
    storage.clear()
    mockSetNavigationBarColor.mockClear()
    mockSetTabBarStyle.mockClear()
    mockSetTabBarItem.mockClear()
    mockTrigger.mockClear()
  })

  describe('主题列表', () => {
    it('包含 6 套背景主题（四季 + 星空银河 + 奶油格纹）', () => {
      expect(THEME_LIST.map((t) => t.key)).toEqual([
        'autumn', 'spring', 'summer', 'winter', 'starry', 'grid',
      ])
    })

    it('每套主题都带原生导航栏/标签栏适配信息', () => {
      for (const t of THEME_LIST) {
        expect(t.navbarBg).toBeTruthy()
        expect(['#ffffff', '#000000']).toContain(t.navbarFrontColor)
        expect(t.tabBarSelectedColor).toBeTruthy()
      }
    })

    it('只有星空银河标记为深色主题', () => {
      const dark = THEME_LIST.filter((t) => t.dark).map((t) => t.key)
      expect(dark).toEqual(['starry'])
    })

    it('每套主题都带完整的图标语义色板（tone=gold/sage/teal… 的取色来源）', () => {
      for (const t of THEME_LIST) {
        for (const key of ['gold', 'goldDeep', 'sage', 'teal', 'danger', 'success'] as const) {
          expect(t.palette[key], `${t.key}.palette.${key}`).toMatch(/^#[0-9A-Fa-f]{6}$/)
        }
      }
    })

    it('非默认主题都配了专属 tabBar 图标目录，否则图标色与文字色对不上', () => {
      // 默认配色（autumn / grid）复用 app.config.ts 声明的那套 → dir 为 null
      expect(THEME_LIST.find((t) => t.key === 'autumn')!.tabBarIconDir).toBeNull()
      expect(THEME_LIST.find((t) => t.key === 'grid')!.tabBarIconDir).toBeNull()
      // 其余主题的文字色各不相同，必须成套出图标
      for (const key of ['spring', 'summer', 'winter', 'starry'] as const) {
        expect(THEME_LIST.find((t) => t.key === key)!.tabBarIconDir).toBe(`assets/icons/tabbar/${key}`)
      }
    })
  })

  describe('isDarkTheme', () => {
    it('starry 为深色，其余为浅色', () => {
      expect(isDarkTheme('starry')).toBe(true)
      expect(isDarkTheme('autumn')).toBe(false)
      expect(isDarkTheme('grid')).toBe(false)
    })
  })

  describe('setTheme', () => {
    it('切换后写入本地存储、同步原生导航栏、并广播事件', () => {
      useThemeStore.getState().setTheme('starry')

      expect(storage.get('xhh_theme')).toBe('starry')
      expect(useThemeStore.getState().current).toBe('starry')
      expect(mockSetNavigationBarColor).toHaveBeenCalled()
      // 原生标签栏 API 在自定义 tabBar 下已失效：一次都不该调用，
      // 调了不会报错、但会让人误以为「标签栏颜色是靠这里同步的」。
      expect(mockSetTabBarStyle).not.toHaveBeenCalled()
      expect(mockSetTabBarItem).not.toHaveBeenCalled()
      expect(mockTrigger).toHaveBeenCalledWith('themeChange', 'starry')
    })

    it('深色主题会把导航栏前景色切成白色（否则深底上看不见）', () => {
      useThemeStore.getState().setTheme('starry')
      const arg = mockSetNavigationBarColor.mock.calls[0][0] as any
      expect(arg.frontColor).toBe('#ffffff')
    })

    it('getTabBarIconDir 给出**根路径**的图标目录（自定义 tabBar 组件按它渲染 <Image>）', () => {
      // 默认配色（autumn / grid）复用 app.config.ts 声明的那套 → 图标就在根 assets/icons 下
      expect(getTabBarIconDir('autumn')).toBe('/assets/icons')
      expect(getTabBarIconDir('grid')).toBe('/assets/icons')
      // 其余主题各有专属配色的成套图标
      expect(getTabBarIconDir('starry')).toBe('/assets/icons/tabbar/starry')
      expect(getTabBarIconDir('spring')).toBe('/assets/icons/tabbar/spring')
      // 必须前置 `/`：分包页面里 `<Image src='assets/...'>` 会被按「页面所在包」解析而图裂
      for (const t of THEME_LIST) {
        expect(getTabBarIconDir(t.key).startsWith('/')).toBe(true)
      }
    })

    it('getThemeMeta 暴露标签栏配色（自定义 tabBar 组件靠它上色，不许再写死色值）', () => {
      const starry = getThemeMeta('starry')
      expect(starry.tabBarBg).toBe('#232C57')
      expect(starry.tabBarColor).toBe('rgba(255,255,255,0.55)')
      expect(starry.tabBarSelectedColor).toBe('#FFD068')
      expect(starry.dark).toBe(true)
      // 非法 key 回退第一套（autumn），不能抛
      expect(getThemeMeta('nope' as any).key).toBe('autumn')
    })
  })

  describe('宠物照片壁纸', () => {
    it('设置后写入存储并广播', () => {
      useThemeStore.getState().setPetWallpaper('wxfile://tmp/pet.png')

      expect(storage.get('xhh_pet_wallpaper')).toBe('wxfile://tmp/pet.png')
      expect(useThemeStore.getState().petWallpaper).toBe('wxfile://tmp/pet.png')
      expect(mockTrigger).toHaveBeenCalledWith('wallpaperChange', 'wxfile://tmp/pet.png')
    })

    it('传 null 清除壁纸并移除存储', () => {
      useThemeStore.getState().setPetWallpaper('wxfile://tmp/pet.png')
      useThemeStore.getState().setPetWallpaper(null)

      expect(storage.has('xhh_pet_wallpaper')).toBe(false)
      expect(useThemeStore.getState().petWallpaper).toBeNull()
    })

    it('loadWallpaper 能从存储恢复', () => {
      storage.set('xhh_pet_wallpaper', 'wxfile://tmp/restored.png')
      useThemeStore.getState().loadWallpaper()
      expect(useThemeStore.getState().petWallpaper).toBe('wxfile://tmp/restored.png')
    })
  })
})
