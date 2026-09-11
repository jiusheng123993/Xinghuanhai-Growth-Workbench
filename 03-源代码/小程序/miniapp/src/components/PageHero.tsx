/**
 * 页面头图（插画横幅）
 *
 * 【为什么需要】此前给页面加的都是「空态插画」，但空态只有**没有数据**的用户才看得到，
 * 有数据的老用户永远触发不到 —— 等于没改。页面要让人感觉到变好了，必须改**始终可见**的区域。
 * 本组件放在页面顶部，无论有没有数据都渲染。
 *
 * 【布局为什么不是「插画铺满 + 文字压上去」】
 *   插画是 16:9，而横幅远宽于 16:9，用 aspectFill 铺满会**裁掉约四成画面高度**
 *   （实测首版就是这样把猫头切了）。因此改为：插画按原始比例完整放在**左侧**，
 *   文字排在右侧 —— 不裁切、也不需要在图上叠文字，也就不需要遮罩。
 *   底色必须与插画右边缘衔接（见 .scss 注释），否则会出现一条硬缝。
 *
 * 【标题不要挂具体宠物名】本 App 支持多宠物，页头挂某一只的名字在切换宠物后会立刻失效。
 *   需要体现"当前对象"的场景交给页面内的宠物切换器，页头只写页面名。
 *
 * 用法：
 *   <PageHero illustration='page-mine' title='我的' subtitle='记录你和毛孩子的每一天' />
 *   <PageHero illustration='page-timeline' title='时光线' subtitle='…' actionText='记录' onAction={fn} />
 */
import { View, Text } from '@tarojs/components'
import Illustration from './Illustration'
import type { PageHeaderIllustration } from '../data/illustrations'
import './PageHero.scss'

interface PageHeroProps {
  /** 页面头图插画 key（page-* 系列） */
  illustration: PageHeaderIllustration
  /** 主标题 */
  title: string
  /** 副标题（可选） */
  subtitle?: string
  /** 行动按钮文案；给了才渲染（配 onAction 使用） */
  actionText?: string
  onAction?: () => void
  className?: string
}

export default function PageHero({
  illustration,
  title,
  subtitle,
  actionText,
  onAction,
  className = '',
}: PageHeroProps) {
  return (
    <View className={`page-hero ${className}`}>
      <Illustration name={illustration} fill mode='aspectFit' className='page-hero__art' />
      <View className='page-hero__body'>
        <Text className='page-hero__title'>{title}</Text>
        {subtitle ? <Text className='page-hero__subtitle'>{subtitle}</Text> : null}
        {actionText ? (
          <View className='page-hero__action' hoverClass='page-hero__action--hover' onClick={onAction}>
            <Text className='page-hero__action-text'>{actionText}</Text>
          </View>
        ) : null}
      </View>
    </View>
  )
}
