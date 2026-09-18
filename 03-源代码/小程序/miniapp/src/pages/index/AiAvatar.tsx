/**
 * 首页 AI 宠物管家头像组件
 *
 * 品牌专属形象：戴金色星冠的橘猫管家（Seedream 生成，与 20 张品牌小动物头像同风格），
 * 本地打包进主包。原 WebP 在微信安卓真机兼容性差（真机不显示、模拟器正常），
 * 故改用真位图；2026-09-12 换成新 IP 油画版 256×256 JPEG，按真实字节命名为 .jpg。
 * 同目录旧的 ai-manager.png 暂留不删，待构建验证通过后统一清理。
 */
import { useState, useEffect } from 'react'
import { Image, Text } from '@tarojs/components'
import aiManager from '../../assets/ai-avatar/ai-manager.jpg'

interface AiAvatarProps {
  /** 图片样式类（圆形裁剪铺满） */
  imgClass: string
  /** 加载失败回退 emoji 的样式类 */
  emojiClass: string
}

export default function AiAvatar({ imgClass, emojiClass }: AiAvatarProps) {
  // 图片加载失败标记（本地资源几乎不会失败，防御性兜底）
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    setFailed(false)
  }, [])

  if (failed) {
    return <Text className={emojiClass}>🤖</Text>
  }

  return <Image src={aiManager} className={imgClass} mode='aspectFill' lazyLoad onError={() => setFailed(true)} />
}
