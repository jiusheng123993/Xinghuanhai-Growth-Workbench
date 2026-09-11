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
 * 图标颜色却还停在默认主题，切换主题后就会出现「图标色 ≠ 底色」的违和。
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
   * 微信 tabBar 图标是 PNG 图片，颜色烘焙在文件里，不受 setTabBarStyle 的
   * color/selectedColor 影响；而 tabBar 文字色是逐主题变化的，所以图标必须成套出。
   * null 表示沿用 app.config.ts 里声明的默认套（暖阳珊瑚橙配色）。
   */
  tabBarIconDir: string | null;
  // 导航栏（原生组件，需 Taro.setNavigationBarColor 动态设置）
  navbarBg: string;
  navbarFrontColor: '#ffffff' | '#000000';
  // 标签栏（原生组件，需 Taro.setTabBarStyle 动态设置）
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
const DEFAULT_THEME: ThemeKey = 'autumn';

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

/** 从本地存储获取已保存的主题（非法值回退默认） */
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
function getMeta(theme: ThemeKey): ThemeMeta {
  return THEME_LIST.find(t => t.key === theme) ?? THEME_LIST[0];
}

/**
 * 当前主题是否为深色背景
 * 供页面在「星空银河」等深色背景下把文字/图标切成浅色使用
 */
export function isDarkTheme(theme: ThemeKey): boolean {
  return getMeta(theme).dark;
}

/** tabBar 五个 tab 的图标文件名，顺序必须与 app.config.ts 的 tabBar.list 一致 */
const TAB_BAR_ICON_NAMES = ['home', 'creative', 'timeline', 'pet', 'mine'] as const;

/** 默认配色图标目录，与 app.config.ts 里声明的 iconPath 保持一致 */
const DEFAULT_TABBAR_ICON_DIR = 'assets/icons';

/**
 * 按主题切换 tabBar 图标
 *
 * tabBar 图标是 PNG 图片，颜色烘焙在文件里，setTabBarStyle 只能改文字色改不了图标色，
 * 因此每套主题配一套与文字同色的图标，切换主题时逐个 setTabBarItem 换掉。
 * 默认配色（autumn / grid）直接复用 app.config.ts 里声明的那套，不额外发一份资源。
 */
function applyTabBarIcons(meta: ThemeMeta) {
  const dir = meta.tabBarIconDir ?? DEFAULT_TABBAR_ICON_DIR;
  // 换图标失败绝不能连累页面：单测的 Taro mock、旧版本基础库都可能没有这个 API，
  // 直接同步抛 TypeError 会把整个页面组件打崩（不是被 .catch 兜住的 Promise 拒绝）。
  if (typeof Taro.setTabBarItem !== 'function') return;
  TAB_BAR_ICON_NAMES.forEach((name, index) => {
    try {
      Taro.setTabBarItem({
        index,
        iconPath: `${dir}/${name}.png`,
        selectedIconPath: `${dir}/${name}-active.png`,
      }).catch(() => {});
    } catch {}
  });
}

/** 动态更新微信原生导航栏和标签栏颜色 */
function applyNativeBars(theme: ThemeKey) {
  const meta = getMeta(theme);
  Taro.setNavigationBarColor({
    frontColor: meta.navbarFrontColor,
    backgroundColor: meta.navbarBg,
    animation: { duration: 300, timingFunc: 'easeInOut' },
  }).catch(() => {});
  Taro.setTabBarStyle({
    color: meta.tabBarColor,
    selectedColor: meta.tabBarSelectedColor,
    backgroundColor: meta.tabBarBg,
    borderStyle: meta.tabBarBorderStyle,
  }).catch(() => {});
  applyTabBarIcons(meta);
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
