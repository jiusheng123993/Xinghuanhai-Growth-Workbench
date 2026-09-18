/**
 * 推荐内容卡片组件
 * 展示热门品种百科、食物安全速查等推荐功能入口，支持关闭
 */
import { View, Text } from '@tarojs/components'
import { useState } from 'react'
import Taro from '@tarojs/taro'
import { buildAiEntryUrl } from '../utils/aiEntry'
import './RecommendContentCard.scss'

interface RecommendItem {
  key: string
  icon: string
  title: string
  desc: string
  path: string
}

interface RecommendContentCardProps {
  onNavigate: (path: string) => void
}

/**
 * 推荐条目
 *
 * 【IA 口径：哪些能力算「AI 能力」、该不该收拢到团团】（2026-09-12 收口批次 §2 定的判断标准）
 *   · **需要 AI 推理的能力**（食物安全查询 / 症状初筛 / 附近医院 / AI 取名 / AI 记忆）
 *     → 入口统一先跳团团（`TAB_BAR_AI_PATH`）；
 *   · **纯记录 / 查询类能力**（健康打卡 / 品种百科 / 疫苗日历 / 时光记录）
 *     → 保留原路径直达，不进团团。
 *
 * 按这条标准，`food`（食物安全速查，需要 AI 判断「这种食物对这只宠物能不能吃」）归团团；
 * `breed`（本地品种库查询）与 `health`（打卡）保持原样。
 * 卡片文案刻意不动 —— 能力没变，变的只是「从哪进」，改文案反而会让用户以为功能没了。
 *
 * 【`food` 带 `capability` 参数】跳团团时带上 `capability=food`（由 `buildAiEntryUrl` 拼装），
 * 团团进页后会自动打开食物查询流程，用户点到「食物安全速查」仍然是**一步到位**，
 * 不会因为入口收拢而多一次点击。契约见 `utils/aiEntry.ts`。
 */
const RECOMMEND_ITEMS: RecommendItem[] = [
  { key: 'breed', icon: '🐱', title: '热门品种百科', desc: '了解40+品种特征和护理要点', path: '/pagesPet/breed/index' },
  { key: 'food', icon: '🍖', title: '食物安全速查', desc: '巧克力、葡萄...这些不能吃！', path: buildAiEntryUrl('food') },
  { key: 'health', icon: '💡', title: '健康小贴士', desc: '每天3秒打卡，守护毛孩子', path: '/pagesPet/checkin/index' },
]

const DISMISSED_KEY = 'xhh_recommend_dismissed'

export default function RecommendContentCard({ onNavigate }: RecommendContentCardProps) {
  const [dismissed, setDismissed] = useState<boolean>(() => {
    return Taro.getStorageSync(DISMISSED_KEY) || false
  })

  if (dismissed) return null

  const handleDismiss = (): void => {
    setDismissed(true)
    Taro.setStorageSync(DISMISSED_KEY, true)
  }

  return (
    <View className='recommend-content-card'>
      <View className='recommend-content-card__header'>
        <Text className='recommend-content-card__title'>为你推荐</Text>
        <View className='recommend-content-card__close' onClick={handleDismiss}>
          <Text className='recommend-content-card__close-text'>✕</Text>
        </View>
      </View>

      <View className='recommend-content-card__list'>
        {RECOMMEND_ITEMS.map(item => (
          <View
            key={item.key}
            className='recommend-content-card__item'
            onClick={() => onNavigate(item.path)}
          >
            <View className='recommend-content-card__item-icon'>
              <Text className='recommend-content-card__item-emoji'>{item.icon}</Text>
            </View>
            <View className='recommend-content-card__item-info'>
              <Text className='recommend-content-card__item-title'>{item.title}</Text>
              <Text className='recommend-content-card__item-desc'>{item.desc}</Text>
            </View>
            <Text className='recommend-content-card__item-arrow'>›</Text>
          </View>
        ))}
      </View>
    </View>
  )
}
