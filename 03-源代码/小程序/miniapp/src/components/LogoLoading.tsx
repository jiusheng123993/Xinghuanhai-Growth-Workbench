/**
 * 品牌缓冲页（Logo 加载动画）
 *
 * 用于小程序启动/数据加载时作为缓冲层展示：
 * - 全屏暖色遮罩，居中展示猫狗 Logo
 * - Logo 浮动呼吸（logoFloat）+ 背后柔光（glowPulse）
 * - 品牌名"星河宠记"淡入 + 三点加载指示（dotBounce）
 * - 全部为 transform/opacity 动画，不阻塞主线程
 * - 提供 prefers-reduced-motion 降级：保留淡入，去掉位移动画
 */
import { View, Text, Image } from '@tarojs/components'
// 品牌 IP 原为 WebP，微信安卓真机对 webp 解码兼容性差（真机不显示、模拟器正常），已改位图格式。
// 2026-09-11 换为毛毡质感版：与全站 24 张插画质感统一（详见 02-UI设计/插画系统/）。
// 扩展名 .jpg 与真实字节一致 —— 此前 assets 下 auth-hero.png/login-hero.png 是
// JPEG 字节配 .png 扩展名，属资产管线遗留问题，新资产不再沿用。
import logoCatdog from '../assets/logo-catdog-felt.jpg'
import './LogoLoading.scss'

export default function LogoLoading() {
  return (
    <View className='logo-loading'>
      {/* 背后柔光层 */}
      <View className='logo-loading__glow' />
      <View className='logo-loading__center'>
        {/* 浮动呼吸的猫狗 Logo */}
        <View className='logo-loading__logo'>
          <Image className='logo-loading__logo-img' src={logoCatdog} mode='aspectFit' />
        </View>
        {/* 品牌名 */}
        <Text className='logo-loading__name'>星河宠记</Text>
        {/* 三点加载指示 */}
        <View className='logo-loading__dots'>
          <View className='logo-loading__dot' />
          <View className='logo-loading__dot' />
          <View className='logo-loading__dot' />
        </View>
      </View>
    </View>
  )
}
