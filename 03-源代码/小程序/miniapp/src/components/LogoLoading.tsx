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
// 2026-09-12 换成新 IP 油画版；旧毡毛版（logo-catdog-felt.jpg）是早期 IP、与全站插画不同族，已弃用。
// 插画系统的画风口径见 02-UI设计/插画系统/。
// 扩展名一律与真实字节一致 —— 此前 assets 下曾出现「内容其实是 JPEG、文件名却写 .png」
// 的资产管线遗留（auth-hero.png 等，已随 2026-09-12 这轮换图清理；根因是当年的生成脚本
// 把 Seedream 返回的 JPEG 字节直接按 .png 落盘）。此后新资产一律按真实格式命名，不再沿用。
import logoCatdog from '../assets/logo-catdog-oil.jpg'
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
