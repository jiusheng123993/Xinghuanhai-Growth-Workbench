/**
 * 分享卡片页面
 * 展示用户生成的分享卡片列表，支持生成新卡片和分享
 */
import { useEffect, useState, useCallback } from 'react'
import { useThemeClass } from '../../hooks/useThemeClass'
import { View, Text, Image, ScrollView } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { shareCardService } from '../../services/shareCardService'
import type { ShareCardRow } from '../../services/shareCardService'
import './index.scss'
import { PageBackground, Icon  } from '../../components'

const CARD_TYPES = ['全部', '健康报告', '周报', '回忆录', '里程碑', '家族图谱', '取名', '生日', '成就', '日常动态', '年度回顾']
const CARD_TYPE_MAP: Record<string, string> = {
  '健康报告': 'health_report',
  '周报': 'weekly_summary',
  '回忆录': 'memoir',
  '里程碑': 'milestone',
  '家族图谱': 'family_tree',
  '取名': 'naming',
  '生日': 'birthday',
  '成就': 'achievement',
  '日常动态': 'daily_moment',
  '年度回顾': 'yearly_review',
}
const CARD_TYPE_LABELS: Record<string, string> = {
  health_report: '健康报告',
  weekly_summary: '周报',
  memoir: '回忆录',
  milestone: '里程碑',
  family_tree: '家族图谱',
  naming: '取名',
  birthday: '生日',
  achievement: '成就',
  daily_moment: '日常动态',
  yearly_review: '年度回顾',
}
const THEME_OPTIONS = [
  { key: 'warm', label: '温暖', color: '#FF7043' },
  { key: 'elegant', label: '典雅', color: '#D4AF37' },
  { key: 'cute', label: '可爱', color: '#FF69B4' },
  { key: 'minimal', label: '简约', color: '#607D8B' },
] as const
const SHARE_CHANNELS = [
  { key: 'wechat', label: '微信好友', icon: '💬' },
  { key: 'moments', label: '朋友圈', icon: '🟢' },
  { key: 'save', label: '保存图片', icon: '💾' },
  { key: 'copy', label: '复制链接', icon: '🔗' },
] as const

/** 模板网格（常用 6 类） */
const TEMPLATES = [
  { key: '健康报告', icon: '📊', label: '健康报告' },
  { key: '周报', icon: '📄', label: '周报' },
  { key: '回忆录', icon: '📖', label: '回忆录' },
  { key: '里程碑', icon: '🏆', label: '里程碑' },
  { key: '取名', icon: '✨', label: '取名' },
  { key: '年度回顾', icon: '🎬', label: '年度回顾' },
]

export default function ShareCardPage() {
  /**
   * 主题类名：**必须挂在页面自己的根节点上**
   *
   * 为什么：小程序端每个页面独立渲染，app 组件的 JSX 不包裹页面节点，挂在 app 层的
   * `.theme-*` 传不进页面；不挂就会永远吃 styles/_theme.scss 里 page{} 的秋季基线变量。
   *
   * 【为什么本页还是挂了，而不是分享卡故意固定配色】本页没有任何 canvas / 导出逻辑，
   * 真正分享出去的卡片是**服务端生成的图片**（`card_url`，见 services/shareCardService），
   * 那段图片不受页面 CSS 变量影响；本页 scss 里那些 var(--*) 全部只作用于页面自己的
   * 页头 / 筛选 / 生成面板 / 预览弹窗等交互外壳（见 index.scss 里「配色纠偏」那节注释），
   * 不跟随主题反而会让这页跟宠物板块其它页脱节。故正常跟随。
   */
  const themeClass = useThemeClass()
  const [cards, setCards] = useState<ShareCardRow[]>([])
  const [activeTab, setActiveTab] = useState('全部')
  const [previewCard, setPreviewCard] = useState<ShareCardRow | null>(null)
  const [generating, setGenerating] = useState(false)
  const [showGenPanel, setShowGenPanel] = useState(false)
  const [genType, setGenType] = useState('周报')
  const [genTheme, setGenTheme] = useState('warm')
  const [genText, setGenText] = useState('')
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)

  const loadCards = useCallback(async (p = 1) => {
    try {
      const cardType = activeTab === '全部' ? undefined : CARD_TYPE_MAP[activeTab]
      const res = await shareCardService.getShareCards({ page: p, page_size: 20, card_type: cardType })
      setCards(p === 1 ? res.data : [...cards, ...res.data])
      setTotal(res.total)
      setPage(p)
    } catch {
      Taro.showToast({ title: '加载失败', icon: 'none' })
    }
  }, [activeTab, cards])

  useEffect(() => {
    loadCards(1)
  }, [activeTab])

  const handleTabChange = (tab: string) => {
    setActiveTab(tab)
  }

  const handleCardClick = (card: ShareCardRow) => {
    setPreviewCard(card)
  }

  const handleCardLongPress = (card: ShareCardRow) => {
    Taro.showModal({
      title: '删除卡片',
      content: '确认删除这张分享卡片吗？',
      confirmColor: '#D08AA8',
      success: async (res) => {
        if (res.confirm) {
          try {
            await shareCardService.deleteShareCard(card.id)
            setCards(prev => prev.filter(c => c.id !== card.id))
            Taro.showToast({ title: '已删除', icon: 'success' })
          } catch {
            Taro.showToast({ title: '删除失败', icon: 'none' })
          }
        }
      },
    })
  }

  const handleGenerate = async () => {
    if (generating) return
    setGenerating(true)
    try {
      const card = await shareCardService.generateShareCard({
        card_type: CARD_TYPE_MAP[genType],
        source_data: { custom_text: genText },
        style: { theme: genTheme as 'warm' | 'elegant' | 'cute' | 'minimal' },
      })
      setCards(prev => [card, ...prev])
      setShowGenPanel(false)
      setGenText('')
      Taro.showToast({ title: '生成成功', icon: 'success' })
    } catch {
      Taro.showToast({ title: '生成失败', icon: 'none' })
    } finally {
      setGenerating(false)
    }
  }

  const handleShare = async (channel: string) => {
    if (!previewCard) return
    try {
      await shareCardService.recordShare(previewCard.id, { channel: channel as 'wechat' | 'moments' | 'save' | 'copy' })
      setPreviewCard(prev => prev ? { ...prev, share_count: prev.share_count + 1 } : null)
      setCards(prev => prev.map(c => c.id === previewCard.id ? { ...c, share_count: c.share_count + 1 } : c))
      Taro.showToast({ title: '分享成功', icon: 'success' })
    } catch {
      Taro.showToast({ title: '分享失败', icon: 'none' })
    }
  }

  const hasMore = cards.length < total

  return (
    <View className={`card-container ${themeClass}`}>
      <PageBackground />
      {/* ===== 分享 hero 卡 ===== */}
      <View className='share-hero'>
        <View className='share-hero__icon'>
          <Text className='share-hero__icon-text'>🃏</Text>
        </View>
        <Text className='share-hero__title'>分享卡片</Text>
        <Text className='share-hero__sub'>记录美好瞬间，分享给家人朋友</Text>
        <View className='share-hero__btn' onClick={() => setShowGenPanel(true)}>
          <Text className='share-hero__btn-text'>✨ 生成卡片</Text>
        </View>
      </View>

      {/* ===== 模板网格 ===== */}
      <View className='template-grid'>
        {TEMPLATES.map(t => (
          <View
            key={t.key}
            className={`template-item${genType === t.key ? ' template-item--active' : ''}`}
            onClick={() => {
              setGenType(t.key)
              setShowGenPanel(true)
            }}
          >
            <View className='template-item__icon'>
              <Text className='template-item__icon-text'>{t.icon}</Text>
            </View>
            <Text className='template-item__label'>{t.label}</Text>
          </View>
        ))}
      </View>

      <View className='card-header'>
        <Text className='card-header__title'>我的卡片</Text>
        <Text className='card-header__subtitle'>{total}张卡片</Text>
      </View>

      <ScrollView className='filter-tabs' scrollX enableFlex>
        {CARD_TYPES.map(tab => (
          <View
            key={tab}
            className={`filter-tabs__item ${activeTab === tab ? 'filter-tabs__item--active' : ''}`}
            onClick={() => handleTabChange(tab)}
          >
            <Text className='filter-tabs__text'>{tab}</Text>
          </View>
        ))}
      </ScrollView>

      <ScrollView className='card-grid' scrollY onScrollToLower={() => hasMore && loadCards(page + 1)}>
        <View className='card-grid__inner'>
          {cards.map(card => (
            <View
              key={card.id}
              className='card-item'
              onClick={() => handleCardClick(card)}
              onLongPress={() => handleCardLongPress(card)}
            >
              <Image className='card-item__image' src={card.card_url} mode='aspectFill' />
              <View className='card-item__info'>
                <View className='card-type-tag'>
                  <Text className='card-type-tag__text'>{CARD_TYPE_LABELS[card.card_type] || card.card_type}</Text>
                </View>
                <View className='card-share-count'>
                  <Text className='card-share-count__text'>📤 {card.share_count}</Text>
                </View>
              </View>
            </View>
          ))}
          {cards.length === 0 && (
            <View className='card-grid__empty'>
              <Icon name='clipboard-text' size={40} tone='primary' className='card-grid__empty-icon' />
              <Text className='card-grid__empty-text'>暂无分享卡片</Text>
              <Text className='card-grid__empty-desc'>点击下方按钮生成第一张卡片</Text>
            </View>
          )}
        </View>
      </ScrollView>

      <View className='generate-btn' onClick={() => setShowGenPanel(true)}>
        <Text className='generate-btn__text'>✨ 生成卡片</Text>
      </View>

      {showGenPanel && (
        <View className='generate-panel'>
          <View className='generate-panel__mask' onClick={() => setShowGenPanel(false)} />
          <View className='generate-panel__body'>
            <Text className='generate-panel__title'>选择卡片类型</Text>
            <View className='generate-form'>
              <ScrollView className='generate-form__types' scrollX enableFlex>
                {CARD_TYPES.filter(t => t !== '全部').map(type => (
                  <View
                    key={type}
                    className={`generate-form__type ${genType === type ? 'generate-form__type--active' : ''}`}
                    onClick={() => setGenType(type)}
                  >
                    <Text className='generate-form__type-text'>{type}</Text>
                  </View>
                ))}
              </ScrollView>

              <View className='generate-form__section'>
                <Text className='generate-form__label'>选择主题</Text>
                <View className='generate-form__themes'>
                  {THEME_OPTIONS.map(theme => (
                    <View
                      key={theme.key}
                      className={`theme-option ${genTheme === theme.key ? 'theme-option--active' : ''}`}
                      onClick={() => setGenTheme(theme.key)}
                    >
                      <View className='theme-option__dot' style={{ background: theme.color }} />
                      <Text className='theme-option__text'>{theme.label}</Text>
                    </View>
                  ))}
                </View>
              </View>

              <View className='generate-form__section'>
                <Text className='generate-form__label'>自定义文字（选填）</Text>
                <View className='generate-form__textarea-wrap'>
                  {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                  <textarea
                    className='generate-form__textarea'
                    placeholder='输入想展示的文字...'
                    maxLength={100}
                    value={genText}
                    onInput={(e: any) => setGenText(e.detail.value)}
                  />
                </View>
              </View>

              <View className='generate-form__actions'>
                <View className='generate-form__btn generate-form__btn--cancel' onClick={() => setShowGenPanel(false)}>
                  <Text className='generate-form__btn-text'>取消</Text>
                </View>
                <View
                  className={`generate-form__btn generate-form__btn--confirm ${generating ? 'generate-form__btn--loading' : ''}`}
                  onClick={handleGenerate}
                >
                  <Text className='generate-form__btn-text'>{generating ? '生成中...' : '确认生成'}</Text>
                </View>
              </View>
            </View>
          </View>
        </View>
      )}

      {previewCard && (
        <View className='card-preview-modal'>
          <View className='card-preview-modal__mask' onClick={() => setPreviewCard(null)} />
          <View className='card-preview-modal__body'>
            <View className='card-preview-modal__close' onClick={() => setPreviewCard(null)}>
              <Text className='card-preview-modal__close-text'>✕</Text>
            </View>
            <Image className='card-preview-image' src={previewCard.card_url} mode='widthFix' />
            <View className='card-preview-actions'>
              {SHARE_CHANNELS.map(ch => (
                <View key={ch.key} className='share-btn' onClick={() => handleShare(ch.key)}>
                  <Text className='share-btn__icon'>{ch.icon}</Text>
                  <Text className='share-btn__text'>{ch.label}</Text>
                </View>
              ))}
            </View>
          </View>
        </View>
      )}
    </View>
  )
}
