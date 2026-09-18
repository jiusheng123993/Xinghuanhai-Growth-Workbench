/**
 * 主题与页面背景状态管理
 *
 * 这里管两个维度：
 *  1. theme —— 主题：决定配色变量，以及微信原生导航栏/标签栏的颜色
 *     · 四季主题：秋·暖阳珊瑚橙 / 春·嫩芽绿 / 夏·海盐蓝 / 冬·冰晶紫
 *     · 风格背景：星空银河（呼应「星河」品牌名） / 奶油格纹
 *  2. petWallpaper —— 宠物照片壁纸：可选叠加在背景层上，用自家毛孩子的照片当背景
 *
 * 持久化：均写入本地存储，冷启动后由 loadTheme / loadWallpaper 恢复。
 * 变更通知：切换时通过 Taro.eventCenter 广播（Taro3 + zustand v3 的 selector 订阅不可靠）。
 */
import create from 'zustand';
import Taro from '@tarojs/taro';

export type ThemeKey = 'spring' | 'summer' | 'autumn' | 'winter' | 'starry' | 'grid';

/**
 * 图标语义色板
 *
 * 与 styles/_theme.scss 里的 --gold / --gold-deep / --sage / --teal / --danger / --success
 * 一一对应，改主题时两边必须一起改。
 *
 * 【为什么必须有】图标用 SVG data URI 渲染，颜色得写死进 SVG，拿不到页面的 CSS 变量；
 * 所以「跟随主题」只能靠这里查表。没有这张表时，宫格底色已经跟着主题变了、
 * 图标颜色却还停在旧配色（当年写死的那套橙），切换主题后就会出现「图标色 ≠ 底色」的违和。
 *
 * 补充（2026-09-12 自定义 tabBar）：底部标签栏的底色/文字色/图标也同理跟着主题走，
 * 由 `custom-tab-bar` 组件读本表渲染（原生 tabBar API 已失效）。
 */
export interface ThemePalette {
  /** 明快金黄（--gold） */
  gold: string;
  /** 沉稳金棕（--gold-deep） */
  goldDeep: string;
  /** 鼠尾草绿（--sage） */
  sage: string;
  /** 湖水蓝（--teal） */
  teal: string;
  /** 警示红（--danger） */
  danger: string;
  /** 成功绿（--success） */
  success: string;
}

export interface ThemeMeta {
  key: ThemeKey;
  name: string;
  emoji: string;
  desc: string;
  primaryColor: string;
  /** 是否为深色背景主题（决定叠加文字/图标该用浅色还是深色） */
  dark: boolean;
  /** 图标语义色板（tone='gold' | 'sage' | 'teal' | 'danger' | 'success' 取色来源） */
  palette: ThemePalette;
  /**
   * 底部 tabBar 图标目录（主题专属配色图标集）
   *
   * 微信 tabBar 图标是 PNG 图片，颜色烘焙在文件里，标签栏自带的配色选项改不了图标色；
   * 而 tabBar 文字色是逐主题变化的，所以图标必须成套出。
   * null 表示沿用 `assets/icons` 根目录那套（暖阳珊瑚橙配色）。
   *
   * 【2026-09-12 自定义 tabBar 后】本字段不再是"给原生 API 换图标用"，而是给
   * `custom-tab-bar` 组件经 `getTabBarIconDir()` 取目录、直接渲染 `<Image>` 用；
   * `app.config.ts` 里那份 iconPath 只是让 app.json 的 4 个 tab 描述完整，不再驱动渲染。
   */
  tabBarIconDir: string | null;
  // 导航栏（原生组件，需 Taro.setNavigationBarColor 动态设置）
  navbarBg: string;
  navbarFrontColor: '#ffffff' | '#000000';
  // 标签栏：**不再走原生 API** —— tabBar.custom 下 `Taro.setTabBarStyle` 已失效
  // （本文件里那条调用已随之删除，只留 Taro.setNavigationBarColor），
  // 这四个字段现在由 src/custom-tab-bar/index.tsx 读 getThemeMeta(theme) 后内联渲染
  // （底色 / 未选中文字色 / 选中文字色 / 顶部分隔线）。
  tabBarBg: string;
  tabBarColor: string;
  tabBarSelectedColor: string;
  tabBarBorderStyle: 'black' | 'white';
}

export const THEME_LIST: ThemeMeta[] = [
  {
    key: 'autumn',
    name: '暖阳珊瑚橙',
    emoji: '🍊',
    desc: '高饱和珊瑚橙 · 暖金 · 奶油暖白',
    primaryColor: '#FF6B3D',
    dark: false,
    palette: {
      gold: '#FFB020',
      goldDeep: '#E8920A',
      sage: '#2FC98E',
      teal: '#4FA3E3',
      danger: '#FF5A5F',
      success: '#2FC98E',
    },
    tabBarIconDir: null,
    navbarBg: '#FFF6EE',
    navbarFrontColor: '#000000',
    tabBarBg: '#FFFFFF',
    tabBarColor: '#B69B83',
    tabBarSelectedColor: '#FF6B3D',
    tabBarBorderStyle: 'white',
  },
  {
    key: 'spring',
    name: '嫩芽绿',
    emoji: '🌱',
    desc: '清新嫩芽绿 · 迎春花黄 · 奶油嫩白',
    primaryColor: '#54B460',
    dark: false,
    palette: {
      gold: '#FFC94D',
      goldDeep: '#E8A81C',
      sage: '#2FC98E',
      teal: '#4FA3E3',
      danger: '#FF5A5F',
      success: '#2FC98E',
    },
    tabBarIconDir: 'assets/icons/tabbar/spring',
    navbarBg: '#F3FAEF',
    navbarFrontColor: '#000000',
    tabBarBg: '#FFFFFF',
    tabBarColor: '#9BB494',
    tabBarSelectedColor: '#54B460',
    tabBarBorderStyle: 'white',
  },
  {
    key: 'summer',
    name: '海盐蓝',
    emoji: '🌊',
    desc: '海盐天蓝 · 落日橙 · 清爽蓝白',
    primaryColor: '#2FA8E8',
    dark: false,
    palette: {
      gold: '#FFB84D',
      goldDeep: '#E8931C',
      sage: '#2FC98E',
      teal: '#4FA3E3',
      danger: '#FF5A5F',
      success: '#2FC98E',
    },
    tabBarIconDir: 'assets/icons/tabbar/summer',
    navbarBg: '#EFF7FC',
    navbarFrontColor: '#000000',
    tabBarBg: '#FFFFFF',
    tabBarColor: '#8FA6B8',
    tabBarSelectedColor: '#2FA8E8',
    tabBarBorderStyle: 'white',
  },
  {
    key: 'winter',
    name: '冰晶紫',
    emoji: '❄️',
    desc: '冰晶紫 · 雪青蓝 · 霜白',
    primaryColor: '#6C7CF0',
    dark: false,
    palette: {
      gold: '#8FA8E8',
      goldDeep: '#6A82CE',
      sage: '#2FC98E',
      teal: '#4FA3E3',
      danger: '#FF5A5F',
      success: '#2FC98E',
    },
    tabBarIconDir: 'assets/icons/tabbar/winter',
    navbarBg: '#F1F3FB',
    navbarFrontColor: '#000000',
    tabBarBg: '#FFFFFF',
    tabBarColor: '#929CBA',
    tabBarSelectedColor: '#6C7CF0',
    tabBarBorderStyle: 'white',
  },
  {
    // 星空银河：呼应「星河」品牌名，也是「毛孩子回到天上当星星」的情感表达
    key: 'starry',
    name: '星空银河',
    emoji: '🌌',
    desc: '深蓝夜空 · 星河流转 · 暖金星点',
    primaryColor: '#7A8CFF',
    dark: true,
    palette: {
      gold: '#FFD068',
      goldDeep: '#E8A81C',
      sage: '#2FC98E',
      teal: '#6FC0F5',
      danger: '#FF7A7F',
      success: '#2FC98E',
    },
    tabBarIconDir: 'assets/icons/tabbar/starry',
    navbarBg: '#1B2450',
    navbarFrontColor: '#ffffff',
    tabBarBg: '#232C57',
    tabBarColor: 'rgba(255,255,255,0.55)',
    tabBarSelectedColor: '#FFD068',
    tabBarBorderStyle: 'black',
  },
  {
    key: 'grid',
    name: '奶油格纹',
    emoji: '🧇',
    desc: '奶油底色 · 细格纹 · 手账质感',
    primaryColor: '#FF6B3D',
    dark: false,
    palette: {
      gold: '#FFB020',
      goldDeep: '#E8920A',
      sage: '#2FC98E',
      teal: '#4FA3E3',
      danger: '#FF5A5F',
      success: '#2FC98E',
    },
    tabBarIconDir: null,
    navbarBg: '#FFF9F0',
    navbarFrontColor: '#000000',
    tabBarBg: '#FFFFFF',
    tabBarColor: '#B69B83',
    tabBarSelectedColor: '#FF6B3D',
    tabBarBorderStyle: 'white',
  },
];

const THEME_STORAGE_KEY = 'xhh_theme';
const WALLPAPER_STORAGE_KEY = 'xhh_pet_wallpaper';

/**
 * 默认主题：春 · 嫩芽绿
 *
 * 【2026-09-12 用户明确要求「把春季主题设为默认」】本值的语义只有一条：
 * **本地存储里没有 `xhh_theme`（新用户 / 清过缓存）时用哪套配色**。
 * 老用户存过自己的选择 → getStoredTheme() 原样读回，本次改动**不会**给他们换主题。
 *
 * ⚠️ 别把本值与「兜底层」混为一谈：非法 key 的元数据兜底（getThemeMeta → THEME_LIST[0]）、
 * styles/_theme.scss 里 page / .app-root 的基线变量、根目录 tabBar 图标
 * （DEFAULT_TABBAR_ICON_DIR）都仍然是**秋季那套**，没人改它们；
 * 也正因为兜底层还是秋色，data/illustrations.ts 的 DEFAULT_SEASON 才继续留 autumn。
 *
 * 【2026-09-12 补记（默认主题收尾批）】`app.config.ts` 的窗口底色
 * （navigationBarBackgroundColor / backgroundColor）原本也算兜底秋色之一，现已改为
 * **春季** navbarBg '#F3FAEF' —— 它是 JS 接管前的首帧色，跟着默认主题走才不会闪色。
 * 注意这**不改变**上面的结论：真正的兜底层仍是 _theme.scss 的 page / .app-root 基线（秋季）。
 */
const DEFAULT_THEME: ThemeKey = 'spring';

/** 主题与背景状态定义 */
interface ThemeState {
  current: ThemeKey;
  /** 宠物照片壁纸（本地路径或 https 地址）；null 表示不使用照片壁纸 */
  petWallpaper: string | null;
  loadTheme: () => void;
  setTheme: (theme: ThemeKey) => void;
  setPetWallpaper: (url: string | null) => void;
  loadWallpaper: () => void;
  applyNativeBars: (theme: ThemeKey) => void;
}

/** 从本地存储获取已保存的主题（**没存过**或存了非法值 → 都回退 DEFAULT_THEME） */
function getStoredTheme(): ThemeKey {
  try {
    const raw = Taro.getStorageSync(THEME_STORAGE_KEY);
    if (raw && THEME_LIST.some(t => t.key === raw)) return raw as ThemeKey;
  } catch {}
  return DEFAULT_THEME;
}

/** 从本地存储获取已保存的宠物照片壁纸 */
function getStoredWallpaper(): string | null {
  try {
    const raw = Taro.getStorageSync(WALLPAPER_STORAGE_KEY);
    return raw ? String(raw) : null;
  } catch {
    return null;
  }
}

/** 根据主题 key 查找元数据（找不到回退第一套） */
export function getThemeMeta(theme: ThemeKey): ThemeMeta {
  return THEME_LIST.find(t => t.key === theme) ?? THEME_LIST[0];
}

/** 兼容旧内部调用名的别名（本文件内使用） */
const getMeta = getThemeMeta;

/**
 * 当前主题是否为深色背景
 * 供页面在「星空银河」等深色背景下把文字/图标切成浅色使用
 */
export function isDarkTheme(theme: ThemeKey): boolean {
  return getMeta(theme).dark;
}

/** 默认配色图标目录，与 app.config.ts 里声明的 iconPath 保持一致 */
const DEFAULT_TABBAR_ICON_DIR = 'assets/icons';

/**
 * 取某套主题的 tabBar 图标目录（**根路径**，可直接给 `<Image src>` 用）
 *
 * 【为什么返回根路径而不是相对路径】
 * 自定义 tabBar 组件里 `<Image src='assets/...'>` 的相对路径会按**页面所在包**解析：
 * 主包页面是 `assets/...`，分包页面则是 `../../assets/...`，一处写错就是「分包里图裂」。
 * 小程序支持以 `/` 开头的根路径，从任何包引用都解析到同一份文件，故统一前置 `/`。
 * 对应文件由 `config/index.js` 的 copy 规则从 `src/assets/icons` 原样拷进 `dist/assets/icons`。
 *
 * @param theme - 主题 key
 * @returns 形如 `/assets/icons/tabbar/starry` 或 `/assets/icons`
 */
export function getTabBarIconDir(theme: ThemeKey): string {
  return `/${getMeta(theme).tabBarIconDir ?? DEFAULT_TABBAR_ICON_DIR}`;
}

/**
 * 动态更新微信原生导航栏颜色
 *
 * ⚠️ 2026-09-12（IA 第 3 批）：底部导航改为**自定义 tabBar**（`app.config.ts` 的
 * `tabBar.custom: true`）后，微信原生 tabBar 不再渲染，`Taro.setTabBarStyle` /
 * `setTabBarItem` 全部失效（调了也不报错，只是没有任何效果）。因此这里只剩导航栏；
 * 标签栏的底色/文字色/图标改由 `src/custom-tab-bar/index.tsx` 自己按主题渲染
 * （它读 `getThemeMeta(theme)` 的 tabBar* 字段 + `getTabBarIconDir(theme)`）。
 *
 * 这也意味着「切主题换 tabBar 图标」不再需要运行时替换 —— 组件订阅主题后重渲染即可，
 * 原先那条 `setTabBarItem` 逐个换图标的链路（及其单测）已随之删除。
 */
function applyNativeBars(theme: ThemeKey) {
  const meta = getMeta(theme);
  Taro.setNavigationBarColor({
    frontColor: meta.navbarFrontColor,
    backgroundColor: meta.navbarBg,
    animation: { duration: 300, timingFunc: 'easeInOut' },
  }).catch(() => {});
}

export const useThemeStore = create<ThemeState>((set) => ({
  current: getStoredTheme(),
  petWallpaper: getStoredWallpaper(),

  /** 从本地存储加载主题并应用到原生组件 */
  loadTheme: () => {
    const theme = getStoredTheme();
    set({ current: theme });
    applyNativeBars(theme);
  },

  /**
   * 切换主题并持久化
   * @param theme - 主题 key
   */
  setTheme: (theme: ThemeKey) => {
    try {
      Taro.setStorageSync(THEME_STORAGE_KEY, theme);
    } catch {}
    set({ current: theme });
    applyNativeBars(theme);
    // 通过事件中心通知各页面组件重渲染
    Taro.eventCenter.trigger('themeChange', theme);
  },

  /**
   * 设置宠物照片壁纸
   * @param url - 照片路径；传 null 表示取消照片壁纸
   */
  setPetWallpaper: (url: string | null) => {
    try {
      if (url) Taro.setStorageSync(WALLPAPER_STORAGE_KEY, url);
      else Taro.removeStorageSync(WALLPAPER_STORAGE_KEY);
    } catch {}
    set({ petWallpaper: url });
    Taro.eventCenter.trigger('wallpaperChange', url);
  },

  /** 从本地存储恢复照片壁纸 */
  loadWallpaper: () => {
    set({ petWallpaper: getStoredWallpaper() });
  },

  applyNativeBars,
}));
