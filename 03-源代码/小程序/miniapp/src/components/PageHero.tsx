/**
 * 页面头图（插画横幅）
 *
 * 【为什么需要】此前给页面加的都是「空态插画」，但空态只有**没有数据**的用户才看得到，
 * 有数据的老用户永远触发不到 —— 等于没改。页面要让人感觉到变好了，必须改**始终可见**的区域。
 * 本组件放在页面顶部，无论有没有数据都渲染。
 *
 * 【构图：左侧插画 + 右侧文案，整条横幅恒定 156rpx 高】
 *   插画**高度定死 156rpx、宽度由图片自身的比例算出来**（`mode='heightFix'`）：
 *     · 方图 1.00（春/秋/冬，含默认主题的春季）→ 宽 156rpx，正好是个正方形；
 *     · 宽图 1.50（夏季那批）→ 宽 234rpx（= 156 × 1.5）。
 *   两种比例都**零裁切、零留白**；卡片总高恒为 156rpx，与图片比例、与季节都无关。
 *
 *   改前的写法是「左侧小图 + 右侧文字」，但**假设插画是 16:9**：
 *   横幅固定高 156rpx → 反推出插画宽必须 = 156 × 16/9 ≈ 277rpx = 卡片内容宽 694rpx 的 40%，
 *   卡片渐变也把硬拐点钉在 40%（好让底色"接上"插画右缘）。
 *
 *   这个假设**与服务器上的真实资产对不上**。2026-09-12 用 image-size 逐张下载实测
 *   `uploads/illustrations/seasonal/`：
 *
 *   | 文件                                                | 尺寸      | 比例 |
 *   | --------------------------------------------------- | --------- | ---- |
 *   | creative-spring-hero / -autumn-hero / -winter-hero  | 1254×1254 | 1.00 |
 *   | creative-summer-hero                                | 1536×1024 | 1.50 |
 *   | mine-summer-hero                                    | 1536×1024 | 1.50 |
 *   | mine-autumn-hero                                    | 1254×1254 | 1.00 |
 *   | avatar-studio-autumn-hero                           | 1254×1254 | 1.00 |
 *   | timeline-autumn / checkin-autumn（非 -hero 那类）    | 1254×1254 | 1.00 |
 *
 *   → **同一个槽位、不同季节的比例就不一样**：只有夏季那批（最新生成）是 1536×1024 宽图，
 *     春 / 秋 / 冬全是方图。而**默认主题（2026-09-12 起是春季）同样是方图**，所以默认观感就是错的：
 *     方图被 `aspectFit` 塞进 277.6×156rpx 的框里，只会渲染 156×156rpx 并水平居中，
 *     **左右各留约 60rpx 空带**；偏偏渐变的硬拐点就卡在 40%（= 277.6rpx），
 *     于是图片右缘到拐点之间露出一条底色带 —— 真机上就是「图片右边多出一条空带 / 硬缝」。
 *
 *   ⚠️ 病根**不是"数值算错了"，而是组件里存在"由比例反推出的尺寸"**
 *      （高 156rpx → 宽 = 高 × 16/9 → 占卡片 40%）。现在这条推导被整条删除：
 *      **高度只由"横幅多高"决定（156rpx），宽度让图片自己按比例算** —— 再也没有会过期的数字。
 *      卡片底色也删掉了那条按 40% 拐点的暖橙渐变：它唯一的用途是"接住插画右边界、不裂硬缝"，
 *      而"接缝"这个概念在"高度定死、宽度自适应"的写法下根本不存在。
 *
 * 【构图决策链：三轮试错，别再走一遍】
 *   判定标准只有两条 —— **零裁切 + 零留白**。本组件要同时伺候 1.00 与 1.50 两种比例的图，
 *   在这个前提下逐个试过的方案是：
 *
 *   | 方案 | 结果 | 结论 |
 *   | --- | --- | --- |
 *   | 插画满宽在上 + `widthFix` | 页头涨到 ≈694rpx 图 + ≈140rpx 文案 ≈ **830rpx（约半屏）**，而 v2 的页头只有约 330rpx；且图片加载完成前高度未知 → 首屏跳动 | **退掉** |
 *   | 固定方框 156×156 + `aspectFill` | 1.00 完美；但 1.50 要覆盖方框得左右各裁约 16.7%，实测（look.cjs + 只喂中间 66.7% 区域）**把猫的头脸整块裁掉**，狗虽完整但猫成"无头残影" | **退掉** |
 *   | 固定方框 156×156 + `aspectFit` | 1.00 完美；1.50 被缩成 156×104rpx，框内上下各留约 26rpx **空带** | **直接排除**（空带正是本次要修的缺陷） |
 *   | **高度定死 156rpx + `heightFix`** | 1.00 → 156rpx 宽；1.50 → 234rpx 宽。**零裁切、零留白**，总高恒 156rpx | **采纳** |
 *
 *   即：**"同一位置要放不同比例的图、又不想裁切也不想留白"时，只有 `heightFix` / `widthFix`
 *   这类"一边定死、另一边让图片自算"的 mode 能做到**（`aspectFit` 必留白带、`aspectFill` 必裁切，
 *   在跨季比例不一致的资产上都会露馅）。本组件取 `heightFix` 而不是 `widthFix`，是因为
 *   **高度必须恒定**（页头高度是版式常量，不能随季节变），宽度变化则由右侧弹性文案列吸收。
 *
 *   ⚠️ **本方案唯一的代价（明确记下来，别让它变成"以后有人发现的怪现象"）**：
 *      插画宽度随季节变（方图 156rpx / 宽图 234rpx），所以**文案起点在夏季会右移约 78rpx**，
 *      文案可用宽也从约 500rpx 缩到约 422rpx（卡片宽 694rpx − 插画宽 − 左右内边距 20/18rpx）。
 *      页头总高与整体版式**不变**；只是夏季主题下左侧图更宽、右边留给文字的地方略窄
 *      （现有的页头文案都是短句，两季都不折行，实测宽度见测试与自述）。
 *
 * 【文案为什么不叠在插画上（高保真 v2 原型是叠的）】
 *   v2 的页头是「满宽横幅 + 文案叠在图上右侧」，但那是给**主体偏左的横构图**插画准备的；
 *   本批插画是**方图且主体居中**（6 张 -hero 里 4 张是方图），叠字会直接压住猫狗
 *   （用 look.cjs 复核 `04-creative.png` 时，视觉模型也把"文案压在狗头上"判成了视觉缺陷）。
 *   今天页当初就是为这个才把文案放到图外面，这里沿用同一结论：**文案排在图右侧，不盖在图上**。
 *
 * 【标题不要挂具体宠物名】本 App 支持多宠物，页头挂某一只的名字在切换宠物后就会立刻失效。
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
      {/*
        heightFix（高度定死、宽度由图片自身比例算）是"跨季比例不一致"下唯一零裁切又零留白的 mode：
        1.00 的方图与 1.50 的宽图都完整显示，页头总高仍恒为 156rpx。
        ⛔ 不要改成 aspectFit（宽图会上下留空带）或 aspectFill（宽图会裁掉两边，实测会切到猫头）。
        fill 让尺寸完全交给 CSS（不写内联像素宽高，否则类名怎么设都会被内联值盖掉）。
        className 仍叫 page-hero__art：3 个消费页可能拿它做覆盖，类名保持不变。
      */}
      <Illustration name={illustration} fill mode='heightFix' className='page-hero__art' />
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
