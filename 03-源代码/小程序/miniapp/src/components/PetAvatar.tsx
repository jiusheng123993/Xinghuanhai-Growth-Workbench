/**
 * 宠物头像组件
 * 展示优先级：imageUrl（显式传入）→ pet 档案形象（真实照片 / AI 形象 / 品种品牌头像）
 *            → 图片加载失败时退回「渐变底 + 物种 emoji」（不再使用简笔画 SVG）
 *
 * 注意：调用方只要传入 pet 对象，即使没显式传 imageUrl，也会自动用档案里的形象；
 * 没设过自定义形象的宠物会拿到「按品种匹配的品牌小动物头像」（与家庭页同源同图），
 * 而不是一个空渐变圆——见 data/homeStyleAvatars.ts 的 resolvePetAvatarUrl 说明。
 * 只有调用方连 pet 都没传（如形象定制页生成中态）才直接走 emoji 占位。
 */
import { View, Text, Image } from '@tarojs/components'
import { useEffect, useMemo, useState } from 'react'
import {
  calculateExpression,
  generateDiaryForToday,
  type ExpressionConfig,
  type ExpressionContext,
  type DiaryEntry
} from '../engines/petAvatar'
import { resolvePetAvatarUrl } from '../data/homeStyleAvatars'
import './PetAvatar.scss'

interface PetAvatarProps {
  species: 'dog' | 'cat'
  petName: string
  expressionContext: ExpressionContext
  /** 优先展示的头像图片（AI 卡通形象或真实照片），显式传入时优先级最高 */
  imageUrl?: string
  /**
   * 宠物档案对象（可选）：未显式传 imageUrl 时自动按全站统一口径解析头像
   * （真实照片 avatarPhotoUrl > AI 卡通形象 avatarCartoonUrl > 按品种匹配的品牌小动物头像）。
   * 字段类型显式放宽为可空（服务端/本地缓存可能返回 null，见 avatar-customize 保存逻辑）；
   * breed/breedId 用于品牌头像的品种匹配（不传则按物种兜底，仍能得到小动物头像）
   */
  pet?: {
    avatarPhotoUrl?: string | null
    avatarCartoonUrl?: string | null
    breed?: string
    breedId?: string
  } | null
  size?: number
  showDiary?: boolean
  showLabel?: boolean
  className?: string
  customExpression?: ExpressionConfig
}

export default function PetAvatar({
  species,
  petName,
  expressionContext,
  imageUrl,
  pet,
  size = 100,
  showDiary = false,
  showLabel = false,
  className = '',
  customExpression
}: PetAvatarProps) {
  // 图片加载失败标记：品牌头像/自定义形象都可能因网络或坏地址加载失败，
  // 失败后退回渐变 emoji 占位（与家庭页 FamilyPetAvatar 同款两级兜底，保证头像位不为空）
  const [imageFailed, setImageFailed] = useState(false)

  // 头像图解析：显式 imageUrl 优先；其次走全站统一口径（照片 > AI 形象 > 品种品牌头像）；
  // 调用方没传 pet 时（无档案上下文）自然得到 undefined，直接走 emoji 占位
  const resolvedImageUrl = imageUrl || (pet
    ? resolvePetAvatarUrl({
        species,
        breed: pet.breed || '',
        breedId: pet.breedId || '',
        avatarPhotoUrl: pet.avatarPhotoUrl,
        avatarCartoonUrl: pet.avatarCartoonUrl,
      })
    : undefined)

  // 地址变化（换宠物 / 换了形象 / 失败地址被替换）时重置失败标记，
  // 避免一次瞬断让头像永远卡在 emoji、新地址也不再重试
  useEffect(() => {
    setImageFailed(false)
  }, [resolvedImageUrl])

  const expression = useMemo(
    () => customExpression || calculateExpression(expressionContext),
    [customExpression, expressionContext]
  )

  const diary = useMemo(() => {
    if (!showDiary) return null
    return generateDiaryForToday(
      expressionContext.todayEntry,
      expressionContext.streakDays,
      expressionContext.isBirthday,
      expressionContext.isRecovery
    )
  }, [showDiary, expressionContext])

  const animationClass = `pet-avatar__image--${expression.animation}`
  // 兜底形象：物种 emoji + 渐变圆底（与品牌色系一致，比简笔画脸好看）
  const fallbackEmoji = species === 'cat' ? '🐱' : '🐶'
  const fallbackClass = species === 'cat' ? 'pet-avatar__placeholder--cat' : 'pet-avatar__placeholder--dog'

  return (
    <View className={`pet-avatar ${className}`}>
      <View className='pet-avatar__face'>
        {resolvedImageUrl && !imageFailed ? (
          <Image
            className={`pet-avatar__image ${animationClass}`}
            src={resolvedImageUrl}
            mode='aspectFill'
            style={{ width: `${size}px`, height: `${size}px` }}
            lazyLoad
            onError={() => setImageFailed(true)}
          />
        ) : (
          <View
            className={`pet-avatar__placeholder ${fallbackClass} ${animationClass}`}
            style={{ width: `${size}px`, height: `${size}px` }}
          >
            <Text
              className='pet-avatar__placeholder-emoji'
              style={{ fontSize: `${Math.round(size * 0.46)}px` }}
            >
              {fallbackEmoji}
            </Text>
          </View>
        )}
      </View>

      {showLabel && (
        <View className='pet-avatar__label' style={{ backgroundColor: expression.color }}>
          <Text className='pet-avatar__label-text'>{expression.label}</Text>
        </View>
      )}

      {diary && (
        <View className='pet-avatar__diary'>
          <Text className='pet-avatar__diary-emoji'>{diary.emoji}</Text>
          <Text className='pet-avatar__diary-text'>"{diary.text}"</Text>
          <Text className='pet-avatar__diary-author'>—— {petName}</Text>
        </View>
      )}
    </View>
  )
}
