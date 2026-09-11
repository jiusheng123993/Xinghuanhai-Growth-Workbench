/**
 * 通用空状态组件
 *
 * 【为什么要有它】全项目有 74 处空态散落在 36 个文件里，此前只有 8% 带图，
 * 且各写各的（有的只有一行字、有的 emoji、有的小图标），既不好看也不统一。
 * 本组件把「插画 + 标题 + 说明 + 可选行动按钮」收成一套，改一处全站生效。
 *
 * 用法：
 *   <EmptyState illustration='empty-timeline' title='还没有时光记录' desc='点右上角「记录」…' />
 *   <EmptyState illustration='empty-checkin' title='还没有打卡记录' actionText='去打卡' onAction={go} />
 *   <EmptyState icon='note-pencil' title='暂无内容' />   // 没有对应插画时的兜底
 */
import { View, Text } from '@tarojs/components'
import Illustration from './Illustration'
import Icon from './Icon'
import type { IllustrationName } from '../data/illustrations'
import type { IconName } from './Icon'
import './EmptyState.scss'

interface EmptyStateProps {
  /** 插画 key；与 icon 二选一，优先插画 */
  illustration?: IllustrationName
  /** 无插画时的图标兜底（面性图标，跟随主题取色） */
  icon?: IconName
  /** 主标题（必填，说明「现在是什么状态」） */
  title: string
  /** 补充说明（建议给出「下一步做什么」，别只描述状态） */
  desc?: string
  /** 可选行动按钮文案；给了才渲染按钮 */
  actionText?: string
  onAction?: () => void
  /** 插画展示边长（px） */
  illustrationSize?: number
  className?: string
}

export default function EmptyState({
  illustration,
  icon,
  title,
  desc,
  actionText,
  onAction,
  illustrationSize = 132,
  className = '',
}: EmptyStateProps) {
  return (
    <View className={`empty-state ${className}`}>
      {illustration ? (
        <Illustration name={illustration} size={illustrationSize} className='empty-state__illus' />
      ) : icon ? (
        <Icon name={icon} size={Math.round(illustrationSize * 0.3)} tone='muted' className='empty-state__icon' />
      ) : null}

      <Text className='empty-state__title'>{title}</Text>
      {desc ? <Text className='empty-state__desc'>{desc}</Text> : null}

      {actionText ? (
        <View className='empty-state__action' onClick={onAction}>
          <Text className='empty-state__action-text'>{actionText}</Text>
        </View>
      ) : null}
    </View>
  )
}
