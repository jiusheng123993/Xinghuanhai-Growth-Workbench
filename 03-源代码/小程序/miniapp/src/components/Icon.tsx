/**
 * 图标组件
 *
 * 项目有两套图标体系，由本组件统一承载：
 *  1. line —— 线性描边图标（Heroicons 风格，viewBox 24）：项目历史图标，保留兼容
 *  2. fill —— 面性实心图标（Phosphor Fill，viewBox 256）：新视觉体系，圆润亲和
 *
 * 渲染方式：SVG data URI（**base64**）+ <Image>。
 *  小程序 WXSS 不支持内联 <svg>，用 iconfont 又要额外维护字体文件；
 *  把 SVG 编码成 data URI 交给 Image 渲染，既保留矢量清晰度，又不引入字体依赖。
 *
 * ⚠️ data URI 必须是 base64 形式（2026-09-10 修复，血泪教训）：
 *  小程序 <image> 只解析 `data:xxx;base64,` 这种 data URI，**URL 编码形式
 *  （data:image/svg+xml,%3Csvg…）在开发者工具和真机上都不渲染**，表现为
 *  「换过图标的页面图标整体空白、只剩文字」，而 emoji 位置一切正常 ——
 *  极易被误判成「图标路径写错了」或「背景层盖住了」。
 *  小程序 JSCore 没有 btoa，所以这里自带一个纯 ASCII 的 base64 实现。
 *
 * 颜色：由 color 参数注入到 SVG 内部（line 注入 stroke、fill 注入 fill），
 *  因此同一个图标可任意换色，不需要为每种颜色各准备一份资源。
 *
 * 用法：
 *  <Icon name='syringe' />                    // 面性（自动判断：面性表里有就用面性）
 *  <Icon name='syringe' color='#FF6B3D' />    // 面性 + 具体色值
 *  <Icon name='home' variant='line' />        // 强制用线性历史图标
 *
 * 【配色约定】—— 什么时候用 tone、什么时候可以写死色值：
 *  · 图标「浮在主题背景上」（页面标题、Hero、空态等，背景随主题变）→ **必须用 tone**。
 *    否则深色主题（星空银河）下会变成深色图标压深色底，直接看不见。
 *  · 图标「待在同色系 tint 底里」（如宫格圆底）→ **也要用 tone**。
 *    因为 tint 底是用 rgba(var(--xxx-rgb), α) 画的、会跟着主题变，
 *    图标若写死 hex 就会「底变色不变」，切换主题后出现图标色 ≠ 底色的违和。
 *  · 图标「待在固定白卡片里，且不需要跟任何主题色呼应」（绝大多数业务图标）→ 可以写死色值。
 *  · 想让图标跟随所在宫格的底色（如 gold 宫格配金色图标）→ 用对应的 tone（tone='gold'）。
 *
 * ｜可用 tone｜primary · gold · gold-deep · sage · teal · danger · success · ink · muted · white
 *  除了 ink/muted/white 这几个中性色，其余全部取自当前主题的色板（themeStore.ThemeMeta.palette），
 *  与 styles/_theme.scss 的 CSS 变量一一对应，改主题时两边一起改。
 */
import { Image } from '@tarojs/components'
import { FILL_ICON_PATHS, type FillIconName } from './icons-fill'
import { useThemeStore, THEME_LIST, type ThemeKey } from '../stores/themeStore'
import './Icon.scss'

/** 线性图标名（历史图标，保留兼容） */
export type LineIconName =
  | 'home'
  | 'pet'
  | 'trend'
  | 'member'
  | 'mine'
  | 'checkin'
  | 'vaccine'
  | 'hospital'
  | 'food'
  | 'symptom'
  | 'avatar'
  | 'edit'
  | 'arrow-right'
  | 'arrow-down'
  | 'close'
  | 'check'
  | 'warning'
  | 'error'
  | 'info'
  | 'loading'
  | 'star'
  | 'heart'
  | 'settings'
  | 'logout'
  | 'crown'

/** 全部可用图标名（线性 + 面性） */
export type IconName = LineIconName | FillIconName

export type { FillIconName }

/** 线性图标路径（Heroicons 风格，24 网格，描边绘制） */
const LINE_PATHS: Record<LineIconName, string> = {
  home: 'M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2V9z M9 22V12h6v10',
  pet: 'M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z M12 8a4 4 0 100 8 4 4 0 000-8z',
  trend: 'M13 7h8m0 0v8m0-8l-8 8-4-4-6 6',
  member: 'M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z',
  mine: 'M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z',
  checkin: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4',
  vaccine: 'M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l1.828 1.828a2 2 0 01.586 1.414V19H8v-1.172a2 2 0 00-.586-1.414L5.586 14.586A2 2 0 015 13.172V5l-1-1h8z',
  hospital: 'M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4',
  food: 'M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z',
  symptom: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z',
  avatar: 'M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z',
  edit: 'M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z',
  'arrow-right': 'M9 5l7 7-7 7',
  'arrow-down': 'M19 9l-7 7-7-7',
  close: 'M6 18L18 6M6 6l12 12',
  check: 'M5 13l4 4L19 7',
  warning: 'M12 9v2m0 4h.01m-6.938 4h13.876c1.035 0 1.87-1.035 1.648-2.047l-6.938-27.876c-.22-.88-1.395-1.395-2.276-1.395-.88 0-2.055.515-2.275 1.395L3.414 18.953c-.222 1.012.613 2.047 1.648 2.047z',
  error: 'M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
  info: 'M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
  loading: 'M4 4v5h.582a15.05 15.05 0 007.424-2.624M20 20v-5h-.581a15.05 15.05 0 01-7.424 2.624',
  star: 'M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118L2.985 9.89c-.783-.57-.38-1.81.588-1.81h4.914a1 1 0 00.95-.69L11.05 2.927z',
  heart: 'M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z',
  settings: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.067 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.067c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.067c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.067-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37 1.608.926 3.62-.34 4.17-1.544zM12 15a3 3 0 100-6 3 3 0 000 6z',
  logout: 'M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1',
  crown: 'M5 16l3-9 3 6 3-6 3 9H5z',
}

interface IconProps {
  /** 图标名（面性图标清单见 icons-fill.ts） */
  name: IconName
  /** 渲染风格；省略时自动判断：面性图标表里存在就用 fill，否则用 line */
  variant?: 'line' | 'fill'
  /**
   * 边长。数字按 px 处理；也可传 CSS 长度字符串，
   * 例如 '1em' 让图标自动跟随所在文字的字号 —— 替换 emoji 时最省事，
   * 原有样式的 font-size 直接生效，无需逐处改尺寸
   */
  size?: number | string
  /** 具体色值（如 #FF6B3D）；与 tone 二选一，tone 优先 */
  color?: string
  /**
   * 语义色：随当前主题自动解析成合适色值。
   * data URI 方案下颜色必须写死进 SVG，所以「跟随主题」只能靠这里查表，
   * 调用方用 tone 即可，不必关心当前是哪套主题、是不是深色。
   */
  tone?: IconTone
  className?: string
}

/** 语义色名（除中性色外均取自当前主题色板） */
export type IconTone =
  | 'primary'
  | 'gold'
  | 'gold-deep'
  | 'sage'
  | 'teal'
  | 'danger'
  | 'success'
  | 'ink'
  | 'muted'
  | 'white'

/**
 * 把语义色解析成具体色值
 *
 * 直接读 store 当前值而不订阅：页面级已经通过 useThemeClass 订阅了主题变化，
 * 主题切换会触发页面重渲染，图标随之重新取色；每个图标再各自订阅会造成无谓的性能开销。
 */
function resolveTone(tone: IconTone, theme: ThemeKey): string {
  const meta = THEME_LIST.find((t) => t.key === theme) ?? THEME_LIST[0]
  switch (tone) {
    case 'primary':
      return meta.primaryColor
    case 'gold':
      return meta.palette.gold
    case 'gold-deep':
      return meta.palette.goldDeep
    case 'sage':
      return meta.palette.sage
    case 'teal':
      return meta.palette.teal
    case 'danger':
      return meta.palette.danger
    case 'success':
      return meta.palette.success
    case 'ink':
      // 深色主题正文是白色，浅色主题是深棕
      return meta.dark ? '#FFFFFF' : '#40281C'
    case 'muted':
      return meta.dark ? 'rgba(255, 255, 255, 0.62)' : '#8B6E58'
    case 'white':
    default:
      return '#FFFFFF'
  }
}

/** base64 字符表（标准 Alphabet，A-Z a-z 0-9 + /） */
const BASE64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

/**
 * 把纯 ASCII 字符串编码成 base64
 *
 * 为什么不用 btoa：小程序 JSCore 没有 btoa/atob（项目里 platform/storage.ts 那处
 * 用了 btoa，属于不可靠用法，本组件不跟随）。
 * 为什么不处理多字节：图标 SVG 由固定模板 + path 数据 + 十六进制色值拼成，
 * 全部落在 ASCII 范围内，按码点直接当字节即可；万一有 >255 的码点，
 * charCodeAt 的结果会被位运算截断，只会画出个别异常图标，不会抛错拖垮页面。
 *
 * @param input 待编码字符串
 * @returns base64 字符串（含 = 补齐）
 */
export function asciiToBase64(input: string): string {
  let out = ''
  for (let i = 0; i < input.length; i += 3) {
    const c1 = input.charCodeAt(i)
    // 越界位置 charCodeAt 返回 NaN，位运算后按 0 处理，正好等于 base64 的补零规则
    const c2 = i + 1 < input.length ? input.charCodeAt(i + 1) : NaN
    const c3 = i + 2 < input.length ? input.charCodeAt(i + 2) : NaN
    const has2 = !Number.isNaN(c2)
    const has3 = !Number.isNaN(c3)
    out += BASE64_CHARS[c1 >> 2]
    out += BASE64_CHARS[((c1 & 3) << 4) | ((c2 >> 4) & 15)]
    out += has2 ? BASE64_CHARS[((c2 & 15) << 2) | ((c3 >> 6) & 3)] : '='
    out += has3 ? BASE64_CHARS[c3 & 63] : '='
  }
  return out
}

/** 线性图标：24 网格、描边、圆角端点，颜色注入 stroke */
function lineDataUri(inner: string, size: number, color: string): string {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${size}' height='${size}' viewBox='0 0 24 24' fill='none' stroke='${color}' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'>${inner}</svg>`
  return `data:image/svg+xml;base64,${asciiToBase64(svg)}`
}

/** 面性图标：256 网格、实心填充，颜色注入 fill */
function fillDataUri(inner: string, size: number, color: string): string {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${size}' height='${size}' viewBox='0 0 256 256' fill='${color}'>${inner}</svg>`
  return `data:image/svg+xml;base64,${asciiToBase64(svg)}`
}

export default function Icon({
  name,
  variant,
  size = 24,
  color,
  tone,
  className = '',
}: IconProps) {
  const useFill = variant ? variant === 'fill' : name in FILL_ICON_PATHS
  const inner = useFill
    ? FILL_ICON_PATHS[name as FillIconName]
    : LINE_PATHS[name as LineIconName]

  // 图标名不在两套表里时直接不渲染，避免画出空白占位
  if (!inner) return null

  // 取色优先级：语义色 > 具体色值 > 品牌主色（默认用主色比原来的 #333 更贴合产品调性）
  const theme = useThemeStore.getState().current
  const finalColor = tone ? resolveTone(tone, theme) : color ?? resolveTone('primary', theme)

  // data URI 内固定按 viewBox 原尺寸生成：SVG 是矢量，CSS 再怎么缩放都不失真，
  // 所以显示尺寸完全交给 style（支持 px / em / rpx），不必为每个尺寸重造 data URI
  const src = useFill ? fillDataUri(inner, 256, finalColor) : lineDataUri(inner, 24, finalColor)

  const cssSize = typeof size === 'number' ? `${size}px` : size

  return (
    <Image
      className={`icon ${className}`}
      src={src}
      mode='aspectFit'
      style={{ width: cssSize, height: cssSize }}
    />
  )
}
