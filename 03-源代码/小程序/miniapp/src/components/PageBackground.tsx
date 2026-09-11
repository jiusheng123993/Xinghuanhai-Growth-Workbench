/**
 * 页面背景组件
 *
 * 全站统一用它铺背景，避免各页面各写一套导致风格漂移。
 * 三层结构（自下而上）：
 *   1. 主题渐变底 —— 取各主题的 --gradient-page
 *   2. 主题装饰层 —— 四季光斑 / 星空星点 / 奶油格纹，按当前主题渲染
 *   3. 宠物照片壁纸 —— 用户在设置里开启后叠加（轻模糊 + 遮罩保证内容可读）
 *
 * 使用约定：
 *   · 放在页面根容器的第一个子元素
 *   · 页面根容器保持 position: relative，内容区 z-index 高于背景层
 *   · 组件自身 pointer-events: none，不会挡住点击
 */
import { View, Image } from '@tarojs/components'
import { useThemeKey, usePetWallpaper } from '../hooks/useThemeClass'
import './PageBackground.scss'

/**
 * 星空星点：用索引做确定性伪随机
 * 不用 Math.random —— 否则每次重渲染星点都会跳动
 */
const STARS = Array.from({ length: 46 }, (_, i) => ({
  left: (i * 37) % 100,
  top: (i * 61) % 100,
  size: 2 + ((i * 13) % 3),
  delay: ((i * 7) % 30) / 10,
  twinkle: i % 3 === 0,
}))

export default function PageBackground() {
  const theme = useThemeKey()
  const wallpaper = usePetWallpaper()

  const isStarry = theme === 'starry'
  const isGrid = theme === 'grid'

  return (
    <View className='xhh-bg'>
      {/* 1. 主题渐变底（颜色由各主题的 --gradient-page 决定，见 app.scss 的 .app-root） */}
      <View className='xhh-bg__base' />

      {/* 2. 主题装饰层 */}
      {isStarry && (
        <View className='xhh-bg__stars'>
          {STARS.map((s, i) => (
            <View
              key={i}
              className={`xhh-bg__star${s.twinkle ? ' xhh-bg__star--twinkle' : ''}`}
              style={{
                left: `${s.left}%`,
                top: `${s.top}%`,
                width: `${s.size}px`,
                height: `${s.size}px`,
                animationDelay: `${s.delay}s`,
              }}
            />
          ))}
        </View>
      )}

      {isGrid && <View className='xhh-bg__grid' />}

      {!isStarry && !isGrid && (
        <>
          <View className='xhh-bg__blob xhh-bg__blob--a' />
          <View className='xhh-bg__blob xhh-bg__blob--b' />
          <View className='xhh-bg__blob xhh-bg__blob--c' />
        </>
      )}

      {/* 3. 宠物照片壁纸（可选） */}
      {wallpaper && (
        <View className='xhh-pet-wallpaper'>
          <Image className='xhh-pet-wallpaper__img' src={wallpaper} mode='aspectFill' />
          <View className='xhh-pet-wallpaper__veil' />
        </View>
      )}
    </View>
  )
}
