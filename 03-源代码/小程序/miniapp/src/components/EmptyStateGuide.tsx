/**
 * 空状态引导组件
 * 用户无宠物时展示欢迎语、添加宠物入口及核心功能亮点
 */
import { View, Text } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { buildAiEntryUrl, type AiCapabilityKey } from '../utils/aiEntry'
import './EmptyStateGuide.scss'

interface EmptyStateGuideProps {
  onAddPet: () => void
  onExplore: () => void
}

/**
 * 功能亮点条目
 *
 * 【IA 口径：哪些能力算「AI 能力」、该不该收拢到团团】（2026-09-12 收口批次 §2 定的判断标准）
 *   · **需要 AI 推理的能力**（食物安全查询 / 症状初筛 / 附近医院 / AI 取名 / AI 记忆）
 *     → 入口统一先跳团团（`TAB_BAR_AI_PATH`）。团团是这些能力的唯一入口，本组件只负责「把人送过去」。
 *   · **纯记录 / 查询类能力**（健康打卡 / 品种百科 / 疫苗日历 / 时光记录）
 *     → 保留原路径直达，不进团团 —— 它们不需要 AI 推理，强行绕一层只会多一次点击。
 *
 * 按这条标准，下面三条里 `food` / `symptom` 归团团，`breed`（品种百科）保持原样。
 * ⚠️ 路径这里给的是「点下去的落地页」而不是「能力的实现页」：食物查询 / 症状初筛的真实实现在
 * `pagesPet/food-query`、`pagesPet/symptom-check`，但那两个页是团团流程内部的落地页，不再作为入口。
 *
 * 【`capability` 字段：把收拢带来的"多一步"补回来】跳团团时带上能力 key，团团会在进页面后
 * 自动触发该能力（契约见 `utils/aiEntry.ts`）。只有 AI 能力条目才有这个字段 —— 非 AI 条目是
 * 原路径直达，不需要。
 */
const FEATURE_HIGHLIGHTS: Array<{
  key: string
  icon: string
  title: string
  desc: string
  /** 直达路径（非 AI 能力条目用） */
  path?: string
  /** 团团内要自动触发的 AI 能力 key（AI 能力条目用，与 path 二选一） */
  capability?: AiCapabilityKey
}> = [
  { key: 'food', icon: '🍖', title: '食物查询', desc: '能不能吃一查便知', capability: 'food' },
  { key: 'symptom', icon: '🩺', title: '症状初筛', desc: '异常表现早发现', capability: 'symptom' },
  { key: 'breed', icon: '📖', title: '品种百科', desc: '40+品种全知道', path: '/pagesPet/breed/index' },
]

export default function EmptyStateGuide({ onAddPet, onExplore }: EmptyStateGuideProps) {
  /**
   * 点击功能亮点：AI 能力条目跳团团并带上 `capability`（进页即自动开流程），其余原路径直达
   *
   * 【为什么用 navigateTo 而不是 switchTab】团团（`pagesYuantuan/agent`）**不是 tab 页**
   * （tabBar 中心圆钮是自绘的，见 `constants/tabBar.ts` 顶部说明），所以必须 navigateTo。
   *
   * 【为什么没有宠物也能点进团团】团团页自身有「还没有宠物」空态，会引导用户去添加宠物
   * （`pagesYuantuan/agent/index.tsx` 的 `chat-empty` 分支）；这种情况下团团**不会**自动触发能力
   * （没有档案可问），所以这里不需要额外拦截，把判断留给团团一处维护，避免两处口径漂移。
   *
   * @param item - FEATURE_HIGHLIGHTS 里的一条（`capability` 与 `path` 必居其一）
   */
  const handleHighlightClick = (item: (typeof FEATURE_HIGHLIGHTS)[number]): void => {
    const url = item.capability ? buildAiEntryUrl(item.capability) : item.path
    // 数据表保证二者必居其一，这里仍留一道防御：真机上"点了没反应"比报错更难排查
    if (!url) return
    Taro.navigateTo({ url })
  }

  return (
    <View className='empty-state-guide'>
      <View className='empty-state-guide__hero'>
        <Text className='empty-state-guide__hero-emoji'>🐾</Text>
        <Text className='empty-state-guide__hero-title'>欢迎来到星河宠记</Text>
        <Text className='empty-state-guide__hero-subtitle'>你的宠物健康管家</Text>
      </View>

      <View className='empty-state-guide__actions'>
        <View className='empty-state-guide__primary-btn' onClick={onAddPet}>
          <Text className='empty-state-guide__primary-btn-text'>添加我的宠物</Text>
        </View>
        <View className='empty-state-guide__secondary-btn' onClick={onExplore}>
          <Text className='empty-state-guide__secondary-btn-text'>先逛逛</Text>
        </View>
      </View>

      <View className='empty-state-guide__highlights'>
        {FEATURE_HIGHLIGHTS.map(item => (
          <View
            key={item.key}
            className='empty-state-guide__highlight-item'
            onClick={() => handleHighlightClick(item)}
          >
            <View className='empty-state-guide__highlight-icon'>
              <Text className='empty-state-guide__highlight-emoji'>{item.icon}</Text>
            </View>
            <Text className='empty-state-guide__highlight-title'>{item.title}</Text>
            <Text className='empty-state-guide__highlight-desc'>{item.desc}</Text>
          </View>
        ))}
      </View>
    </View>
  )
}
