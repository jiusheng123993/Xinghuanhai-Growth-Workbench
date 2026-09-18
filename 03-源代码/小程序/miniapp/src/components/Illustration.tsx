/**
 * 品牌插画组件
 *
 * 用法：
 *   <Illustration name='empty-timeline' />                       // 空态，默认 132px
 *   <Illustration name='empty-checkin' size={148} />             // 指定边长
 *   <Illustration name='header-memoir' width={343} height={193} /> // 头图，按容器给定比例
 *
 * 【降级策略】加载失败时整块不渲染，而不是留一块破图或空白框：
 * 插画是锦上添花，网络不好时宁可少一张图，也不要让页面出现「半张图 + 空白」的残破感。
 * 调用方若希望失败后有兜底内容，请自行在父级提供（例如标题与按钮始终在）。
 *
 * 【尺寸】插画是位图且走网络，务必显式给定展示尺寸，避免加载完成瞬间页面跳动。
 *
 * 【四季插画】同一个 name 会随主题换图（详见 data/illustrations.ts 的 SEASONAL_SLOT）：
 * 本组件负责把「当前主题」读出来传给 illustrationUrl()。data 层是纯函数、不读 store，
 * 所以主题必须由这里注入 —— 这样 data 层不会与 stores 形成循环依赖，也便于单测。
 */
import { useState } from 'react'
import { Image } from '@tarojs/components'
import { illustrationUrl, type IllustrationName } from '../data/illustrations'
/*
 * 主题读取复用仓库既有的 useThemeKey()（Taro3 + zustand v3 下 selector 订阅不可靠，
 * 它内部用 local state + Taro.eventCenter 监听 themeChange）。
 *
 * 为什么不用 Icon.tsx 那种「直接 useThemeStore.getState().current」：
 * Icon 依赖宿主页面用 useThemeClass 订阅主题来触发重渲染，而插画的宿主页面
 * （如 pages/family）本身没有订阅主题，那样读法会导致切主题后插画不换。
 * 插画数量少（每页 1~8 张），多几次幂等的 applyNativeBars 换来「切主题必换图」是划算的。
 */
import { useThemeKey } from '../hooks/useThemeClass'
import './Illustration.scss'

interface IllustrationProps {
  /** 插画 key（合法值见 data/illustrations.ts） */
  name: IllustrationName
  /** 正方形边长（px）。给了 width 时以 width 为准 */
  size?: number
  /** 展示宽度（px） */
  width?: number
  /** 展示高度（px），省略时等于宽度（正方形） */
  height?: number
  /**
   * 铺满父容器（当卡片背景图用）
   *
   * 开启后**不再写内联 width/height**，尺寸完全交给 className 的 CSS ——
   * 否则内联样式优先级高于类，父级怎么设都会被覆盖成固定像素。
   *
   * ⚠️ `fill` **只管"尺寸从哪来"**，它**不要求** `mode='aspectFill'`：
   * mode 按用途另选 —— 铺满背景用 `aspectFill`；想"零裁切又零留白"用 `widthFix`/`heightFix`
   * （`src/components/PageHero.tsx` 就是 `fill` + `heightFix`，其注释里有完整决策链）。
   */
  fill?: boolean
  /**
   * 裁切方式，默认 aspectFit（完整显示）；fill 场景通常配 aspectFill
   *
   * ⚠️ 2026-09-12 补 `widthFix` / `heightFix`：这两个都是微信 `<image>` 的**合法 mode**
   * （`widthFix` = 宽由 CSS 定、高按图片自身比例算；`heightFix` = 高由 CSS 定、宽按比例算）。
   * 之前这里漏了，逼得 `PageHero` 想用时只能 `as unknown as 'aspectFit'` 硬转。
   * 判定口径：**同一个位置要放不同比例的图、又不想裁切也不想留白时，就该用这两个 mode**
   * （`aspectFit` 会留空带、`aspectFill` 会裁切，两者在"跨季比例不一致"的资产上都会露馅）。
   */
  mode?: 'aspectFit' | 'aspectFill' | 'scaleToFill' | 'widthFix' | 'heightFix'
  className?: string
}

export default function Illustration({
  name,
  size = 132,
  width,
  height,
  fill = false,
  mode = 'aspectFit',
  className = '',
}: IllustrationProps) {
  const [failed, setFailed] = useState(false)
  // 当前主题：四季主题 → 取对应季节插画；starry 等非四季主题由 illustrationUrl 回退默认季
  const theme = useThemeKey()

  const w = width ?? size
  const h = height ?? w

  // 加载失败 → 不渲染，避免破图/空白占位
  if (failed) return null

  return (
    <Image
      className={`illustration ${fill ? 'illustration--fill' : ''} ${className}`}
      src={illustrationUrl(name, theme)}
      mode={mode}
      lazyLoad={!fill}
      style={fill ? undefined : { width: `${w}px`, height: `${h}px` }}
      onError={() => setFailed(true)}
    />
  )
}
