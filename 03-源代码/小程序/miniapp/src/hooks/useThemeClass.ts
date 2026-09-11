/**
 * 主题管理 Hook
 * 提供当前主题 key 的响应式获取与 CSS 类名转换，自动应用原生导航栏样式
 */
import { useEffect, useState } from 'react'
import Taro, { useDidShow } from '@tarojs/taro'
import { useThemeStore, type ThemeKey } from '../stores/themeStore'

/**
 * 返回当前主题 key（如 "autumn"）
 * 不依赖 Zustand 订阅（Taro 3 + Zustand v3 中 selector 不可靠触发重渲染）
 * 改用 local state + Taro.eventCenter 监听变更
 *
 * 每个页面挂载/显示时自动调用 applyNativeBars，**只保证导航栏颜色**正确
 * （applyNativeBars 现在只调 Taro.setNavigationBarColor，标签栏已不在它的职责内）；
 * 底部标签栏的底色/文字色/图标由 src/custom-tab-bar 组件按主题渲染，与本 Hook 无关。
 */
export function useThemeKey(): ThemeKey {
  const [theme, setTheme] = useState<ThemeKey>(() => useThemeStore.getState().current)

  // 页面挂载时应用原生导航栏
  useEffect(() => {
    useThemeStore.getState().applyNativeBars(useThemeStore.getState().current)
  }, [])

  // 页面每次显示时重新应用（从其他页面返回时导航栏可能被重置）
  useDidShow(() => {
    useThemeStore.getState().applyNativeBars(useThemeStore.getState().current)
  })

  useEffect(() => {
    // 同步一次 store 最新值
    setTheme(useThemeStore.getState().current)
    const handler = (t: ThemeKey) => {
      setTheme(t)
    }
    Taro.eventCenter.on('themeChange', handler)
    return () => {
      Taro.eventCenter.off('themeChange', handler)
    }
  }, [])

  return theme
}

/**
 * 返回当前主题对应的 CSS 类名（如 "theme-autumn"）
 */
export function useThemeClass(): string {
  const theme = useThemeKey()
  return `theme-${theme}`
}

/**
 * 返回当前的宠物照片壁纸地址（未设置时为 null）
 *
 * 与 useThemeKey 同理：用 local state + eventCenter 监听，绕开 zustand selector
 * 在 Taro3 + zustand v3 下订阅不可靠的问题。
 */
export function usePetWallpaper(): string | null {
  const [url, setUrl] = useState<string | null>(() => useThemeStore.getState().petWallpaper)

  useEffect(() => {
    // 同步一次 store 最新值（可能在其他页面被改过）
    setUrl(useThemeStore.getState().petWallpaper)
    const handler = (next: string | null) => {
      setUrl(next)
    }
    Taro.eventCenter.on('wallpaperChange', handler)
    return () => {
      Taro.eventCenter.off('wallpaperChange', handler)
    }
  }, [])

  return url
}
