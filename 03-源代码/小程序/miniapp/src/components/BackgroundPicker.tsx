/**
 * 背景选择器
 *
 * 「页面背景自定义」的完整交互，供设置页 / 首页背景入口复用：
 *  1. 预设背景：四季 + 星空银河 + 奶油格纹，共 6 套，点一下即切换（同时切换配色与原生导航栏）
 *  2. 宠物照片壁纸：从相册挑一张毛孩子的照片当背景，可随时清除
 *
 * 照片持久化（重要）：
 *  chooseImage 返回的是临时路径，小程序重启即失效；本地文件总配额只有 10MB，
 *  原图直存容易超。所以这里先 compressImage 压一道，再 saveFile 落成永久路径。
 *  落盘失败时降级用临时路径（本次会话仍可见）并如实告知用户。
 */
import { View, Text, Image, ScrollView } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { useState } from 'react'
import { useThemeStore, THEME_LIST, type ThemeKey } from '../stores/themeStore'
import { useThemeKey, usePetWallpaper } from '../hooks/useThemeClass'
import { chooseImageWithPrivacy } from '../utils/privacy'
import Icon from './Icon'
import './BackgroundPicker.scss'

interface BackgroundPickerProps {
  /** 切换背景后的回调（关闭弹层、埋点等） */
  onChange?: (theme: ThemeKey) => void
}

export default function BackgroundPicker({ onChange }: BackgroundPickerProps) {
  const current = useThemeKey()
  const wallpaper = usePetWallpaper()
  // 防止连点重复触发选图/落盘
  const [busy, setBusy] = useState(false)

  /** 切换预设背景 */
  const handleSelectTheme = (key: ThemeKey) => {
    if (key === current) return
    useThemeStore.getState().setTheme(key)
    onChange?.(key)
  }

  /** 选一张照片作为壁纸 */
  const handlePickWallpaper = async () => {
    if (busy) return
    setBusy(true)
    try {
      const res = await chooseImageWithPrivacy({ count: 1 })
      const temp = res.tempFilePaths?.[0]
      if (!temp) return

      try {
        // 压缩后再落盘，避开 10MB 本地文件配额
        const compressed = await Taro.compressImage({ src: temp, quality: 70 })
        const saved = await Taro.saveFile({ tempFilePath: compressed.tempFilePath })
        // saveFile 失败会走 reject，能执行到这里即成功；
        // 但其返回类型是「成功 | 失败」联合，需显式收窄后才能取路径
        if (!('savedFilePath' in saved)) throw new Error('saveFile 未返回文件路径')
        useThemeStore.getState().setPetWallpaper(saved.savedFilePath)
      } catch {
        // 落盘失败（配额满/平台不支持）：先用临时路径，至少本次可见，并如实告知
        useThemeStore.getState().setPetWallpaper(temp)
        Taro.showToast({ title: '背景已应用（重启后可能失效）', icon: 'none', duration: 2200 })
        return
      }
      Taro.showToast({ title: '已设为背景', icon: 'success' })
    } catch {
      // 用户取消 → 静默；其余失败（隐私未配置/权限被拒）privacy.ts 内已给出提示
    } finally {
      setBusy(false)
    }
  }

  /** 清除照片壁纸，回到纯色背景 */
  const handleClearWallpaper = () => {
    useThemeStore.getState().setPetWallpaper(null)
    Taro.showToast({ title: '已恢复纯色背景', icon: 'none' })
  }

  return (
    <View className='bg-picker'>
      {/* ---- 预设背景 ---- */}
      <View className='bg-picker__label'>预设背景</View>
      <ScrollView scrollX enableFlex className='bg-picker__scroll'>
        <View className='bg-picker__row'>
          {THEME_LIST.map((t) => (
            <View
              key={t.key}
              className={`bg-picker__item${t.key === current ? ' bg-picker__item--active' : ''}`}
              onClick={() => handleSelectTheme(t.key)}
            >
              <View className={`bg-picker__swatch bg-picker__swatch--${t.key}`}>
                {t.key === 'starry' && (
                  <>
                    <View className='bg-picker__star' style={{ left: '18%', top: '22%' }} />
                    <View className='bg-picker__star' style={{ left: '62%', top: '38%' }} />
                    <View className='bg-picker__star' style={{ left: '38%', top: '66%' }} />
                  </>
                )}
                {t.key === current && (
                  <View className='bg-picker__tick'>
                    <Icon name='check-circle' size={18} color='#FFFFFF' />
                  </View>
                )}
              </View>
              <Text className='bg-picker__name'>{t.name}</Text>
            </View>
          ))}
        </View>
      </ScrollView>

      {/* ---- 宠物照片壁纸 ---- */}
      <View className='bg-picker__label'>宠物照片壁纸</View>
      <ScrollView scrollX enableFlex className='bg-picker__scroll'>
        <View className='bg-picker__row'>
          {wallpaper && (
            <View className='bg-picker__item bg-picker__item--active'>
              <View className='bg-picker__swatch'>
                <Image className='bg-picker__photo' src={wallpaper} mode='aspectFill' />
                <View className='bg-picker__tick'>
                  <Icon name='check-circle' size={18} color='#FFFFFF' />
                </View>
                <View className='bg-picker__remove' onClick={handleClearWallpaper}>
                  <Icon name='x' size={12} color='#FFFFFF' />
                </View>
              </View>
              <Text className='bg-picker__name'>已设置</Text>
            </View>
          )}

          <View className='bg-picker__item' onClick={handlePickWallpaper}>
            <View className='bg-picker__swatch bg-picker__swatch--add'>
              <Icon name='image' size={24} color='#C9B49B' />
            </View>
            <Text className='bg-picker__name'>{wallpaper ? '换一张' : '选择照片'}</Text>
          </View>
        </View>
      </ScrollView>

      <Text className='bg-picker__hint'>
        {wallpaper
          ? '照片会做轻度虚化并加一层遮罩，保证页面文字看得清。'
          : '选一张毛孩子的照片当背景吧，只有你自己能看到。'}
      </Text>
    </View>
  )
}
