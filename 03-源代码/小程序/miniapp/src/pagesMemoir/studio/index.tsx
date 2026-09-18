import Taro from '@tarojs/taro'
import { View, Text } from '@tarojs/components'
import { usePetStore } from '../../stores/petStore'

import './index.scss'
import PageBackground from '../../components/PageBackground'
import { Icon } from '../../components'

/**
 * 形象工坊页（2026-09-09 对齐高保真原型 creative-hub-prototype.html 屏2）：
 * 生图类能力全聚合——变装玩法（趣味形象，服装模块待实施→占位）+ 形象资产四件套。
 * - 变装玩法两卡（穿戴写真 / 拟人剧场）：后端服装模块未上线，点击占位提示
 * - 形象资产：形象生成 / 全家福 / 我的形象库 / 分享卡片 四卡真实路由
 * 米白暖色主题，与创作页/回忆录馆同语言。
 */
const Studio = () => {
  const currentPet = usePetStore((s) => s.currentPet)
  const petId = currentPet?.id || ''
  const petName = currentPet?.name || '毛孩子'

  const go = (url: string) => {
    Taro.navigateTo({ url: `${url}${petId ? `?petId=${petId}` : ''}` })
  }

  /** 趣味形象占位（服装模块 P1 待实施） */
  const funComing = () => {
    Taro.showToast({ title: '趣味变装即将上线', icon: 'none' })
  }

  return (
    <View className='stu'>
      <PageBackground />
      {/* ===== 橙粉 hero（原型 .hero.studio） ===== */}
      <View className='stu-hero'>
        <Text className='stu-hero-face'>🎭</Text>
        <Text className='stu-hero-title'>形象工坊</Text>
        <Text className='stu-hero-sub'>{petName}的形象资产与趣味创作都在这里</Text>
      </View>

      {/* 新客礼 banner（趣味形象营销位） */}
      <View className='stu-banner'>
        <Text className='stu-banner-text'>🎁 新客礼：趣味变装免费体验 1 次 · 会员每月 4 次不限主题</Text>
      </View>

      {/* ===== 变装玩法（占位） ===== */}
      <View className='stu-sectitle'>
        变装玩法
        <Text className='stu-sectitle-tag'>新</Text>
      </View>

      <View className='stu-wide' onClick={funComing}>
        <View className='stu-wide-thumb stu-wide-thumb--a'><Text className='stu-wide-thumb-emoji'>👘</Text></View>
        <View className='stu-wide-txt'>
          <Text className='stu-wide-title'>趣味形象 · 穿戴写真</Text>
          <Text className='stu-wide-desc'>真实猫咪本尊穿上小衣服，认得出是自家崽</Text>
          <View className='stu-modes'>
            <View className='stu-mode'><Text className='stu-mode-emoji'>👘</Text><Text className='stu-mode-text'>汉服</Text></View>
            <View className='stu-mode'><Text className='stu-mode-emoji'>🍳</Text><Text className='stu-mode-text'>厨师</Text></View>
            <View className='stu-mode'><Text className='stu-mode-emoji'>🎄</Text><Text className='stu-mode-text'>圣诞</Text></View>
          </View>
        </View>
      </View>

      <View className='stu-wide' onClick={funComing}>
        <View className='stu-wide-thumb stu-wide-thumb--b'><Text className='stu-wide-thumb-emoji'>🕴️</Text></View>
        <View className='stu-wide-txt'>
          <Text className='stu-wide-title'>趣味形象 · 拟人剧场</Text>
          <Text className='stu-wide-desc'>站起来的小家伙，汉服/学者/大厨/侠客随 TA 演</Text>
          <View className='stu-modes'>
            <View className='stu-mode'><Text className='stu-mode-emoji'>👘</Text><Text className='stu-mode-text'>汉服</Text></View>
            <View className='stu-mode'><Text className='stu-mode-emoji'>🎓</Text><Text className='stu-mode-text'>学者</Text></View>
            <View className='stu-mode'><Text className='stu-mode-emoji'>⚔️</Text><Text className='stu-mode-text'>侠客</Text></View>
          </View>
        </View>
      </View>

      {/* ===== 形象资产（真实路由） ===== */}
      <View className='stu-sectitle'>形象资产</View>
      <View className='stu-grid2'>
        <View className='stu-mini' onClick={() => go('/pagesPet/avatar-customize/index')}>
          <Text className='stu-mini-em'>✨</Text>
          <Text className='stu-mini-title'>形象生成</Text>
          <Text className='stu-mini-desc'>文字/照片 → 头像+四视图设定图</Text>
        </View>
        {/* 全家福：2026-09-12「家庭看板」（family/dashboard）已并入家庭页，
            这里必须改指家庭页（全家福生成器 + 相册都在该页的「全家福 / 全家福相册」两张卡里） */}
        <View className='stu-mini' onClick={() => go('/pages/family/index')}>
          <Text className='stu-mini-em'>👨‍👩‍👧‍👦</Text>
          <Text className='stu-mini-title'>全家福</Text>
          <Text className='stu-mini-desc'>多宠合拍 · 22 场景 · 节日限定</Text>
        </View>
        <View className='stu-mini' onClick={() => go('/pagesPet/avatar-customize/index')}>
          <Icon name='image' size={24} tone='primary' className='stu-mini-em' />
          <Text className='stu-mini-title'>我的形象库</Text>
          <Text className='stu-mini-desc'>头像 / 设定图 / 趣味 三类管理</Text>
        </View>
        <View className='stu-mini' onClick={() => go('/pagesPet/share-card/index')}>
          <Text className='stu-mini-em'>💌</Text>
          <Text className='stu-mini-title'>分享卡片</Text>
          <Text className='stu-mini-desc'>把形象做成贺卡送朋友</Text>
        </View>
      </View>
    </View>
  )
}

export default Studio
