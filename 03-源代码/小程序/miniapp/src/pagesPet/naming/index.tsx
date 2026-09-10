/**
 * 宠物取名页（按高保真原型 1:1 重构）
 * 取名引擎：AI推荐 / 名字解读 / 灵感探索 / 配对取名
 * 业务接回：recommendNames / interpretName（真实 AI 服务 + 本地降级）
 */
import { View, Text, Input } from '@tarojs/components'
import { useState, useCallback, useRef, useEffect } from 'react'
import Taro from '@tarojs/taro'
import { useThemeClass } from '../../hooks/useThemeClass'
import { usePetStore } from '../../stores/petStore'
import { interpretName, recommendNames } from '../../services/namingService'
import { parseRecommendResult, generateFallbackNames } from '../../utils/namingFallback'
import { AuthenticationError } from '../../utils/authGuard'
import type { NamingResult } from '../../types/chatTypes'
import './index.scss'
import { PageBackground, Icon  } from '../../components'

type NamingMode = 'ai' | 'interpret' | 'inspire' | 'pair'

const MODES: Array<{ key: NamingMode; icon: string; title: string; desc: string }> = [
  { key: 'ai', icon: '✨', title: 'AI推荐', desc: '没想法？AI 按五行星宿推荐 5 个候选' },
  { key: 'interpret', icon: '📖', title: '名字解读', desc: '已有名字，解析五行/星象/诗词内涵' },
  { key: 'inspire', icon: '🧭', title: '灵感探索', desc: '按诗词/星象/山川/色彩选方向' },
  { key: 'pair', icon: '🔗', title: '配对取名', desc: '与现有宠物名字成套搭配' },
]

const INSPIRE_STYLES = ['古风诗意', '可爱萌系', '食物系列', '自然元素']

const SPECIES_OPTIONS: Array<{ value: 'cat' | 'dog'; label: string }> = [
  { value: 'cat', label: '🐱 猫' },
  { value: 'dog', label: '🐶 狗' },
]

const GENDER_OPTIONS = [
  { value: 'male', label: '♂ 公' },
  { value: 'female', label: '♀ 母' },
]

/** 评分 → 星级展示 */
function renderStars(score: number): string {
  const s = Math.max(1, Math.min(5, Math.round((score || 80) / 20)))
  return '★'.repeat(s) + '☆'.repeat(5 - s)
}

/** 出处 chip 色调 */
function sourceTone(source: string): 'gold' | 'coral' | 'info' {
  if (!source) return 'gold'
  if (source.includes('诗') || source.includes('经') || source.includes('词')) return 'gold'
  if (source.includes('色彩') || source.includes('橘') || source.includes('食物') || source.includes('萌')) return 'coral'
  return 'info'
}

export default function NamingPage() {
  const themeClass = useThemeClass()
  const { currentPet } = usePetStore()

  const [mode, setMode] = useState<NamingMode>('ai')
  // 物种默认跟随当前宠物档案（2026-09-10 审查 P1 修复）：写死 'cat' 会让狗主人
  // 得到"为一只柯基（猫咪）推荐…"这类错误提示词——species 本轮起会真正进提示词
  const [species, setSpecies] = useState<'cat' | 'dog'>(currentPet?.species === 'dog' ? 'dog' : 'cat')
  const [breed, setBreed] = useState(currentPet?.breed || '')
  const [birthDate, setBirthDate] = useState(currentPet?.birthDate || '')
  const [gender, setGender] = useState<'male' | 'female'>('female')
  const [coatColor, setCoatColor] = useState('')
  const [keywords, setKeywords] = useState('')

  // 解读模式
  const [interpretInput, setInterpretInput] = useState('')
  const [interpretText, setInterpretText] = useState('')

  // 灵感探索 / 配对取名
  const [inspireStyle, setInspireStyle] = useState('古风诗意')
  const [pairName, setPairName] = useState('')

  const [loading, setLoading] = useState(false)
  const [names, setNames] = useState<NamingResult[]>([])
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null)
  const [generated, setGenerated] = useState(false)

  const isRecommendMode = mode !== 'interpret'
  /** 生成中（同步 ref）：防止慢响应时连点"开始取名"并发多次付费 LLM 调用 */
  const generatingRef = useRef(false)

  // 页面内切换宠物时同步物种（2026-09-10 审查 P1）：useState 初值只在首次挂载生效，
  // 不同步会出现"切到狗以后仍按猫咪取提示词"
  useEffect(() => {
    if (currentPet?.species === 'cat' || currentPet?.species === 'dog') {
      setSpecies(currentPet.species)
    }
  }, [currentPet?.id, currentPet?.species])

  /**
   * 判断 AI 返回文本是否为错误占位文案
   *
   * aiProvider.chat 在网络失败/服务异常时**不抛错**，而是返回固定文案
   * （'AI服务暂不可用，请稍后再试' / '网络异常，请检查网络连接后重试'）。
   * 不判断就会把错误提示当成本次解读正文展示给用户（2026-09-10 修复）。
   */
  const isAiErrorText = (text: string): boolean =>
    !text || text.startsWith('AI服务暂不可用') || text.startsWith('网络异常')

  /** 开始取名 */
  const handleGenerate = useCallback(async () => {
    // 防连点：每次点击=一次付费 LLM 调用，此前只改按钮文案未拦截重复点击
    if (generatingRef.current) return
    if (!breed.trim()) {
      Taro.showToast({ title: '请先填写品种', icon: 'none' })
      return
    }
    if (mode === 'interpret' && !interpretInput.trim()) {
      Taro.showToast({ title: '请输入要解读的名字', icon: 'none' })
      return
    }

    generatingRef.current = true
    setLoading(true)
    setGenerated(true)
    setInterpretText('')

    try {
      if (mode === 'interpret') {
        const text = await interpretName(interpretInput.trim(), breed.trim(), birthDate)
        if (isAiErrorText(text)) {
          // 失败时不显示假结果（此前会把 'AI服务暂不可用' 当解读正文渲染）
          setInterpretText('')
          setGenerated(false)
          Taro.showToast({ title: '解读服务暂时不可用，请稍后再试', icon: 'none' })
          return
        }
        setInterpretText(text)
        setNames([])
        return
      }

      // 推荐类模式：AI 推荐 / 灵感探索 / 配对取名
      const style = mode === 'inspire' ? inspireStyle : keywords.trim() || undefined
      const description = [
        mode === 'pair' && pairName.trim() ? `与「${pairName.trim()}」成套搭配的名字` : '',
        coatColor.trim() ? `毛色：${coatColor.trim()}` : '',
      ].filter(Boolean).join('；') || undefined

      let resultList: NamingResult[] = []
      const res = await recommendNames({
        breed: breed.trim(),
        birthDate,
        gender,
        style,
        // 物种必须传下去（2026-09-10 修复）：此前页面上的"🐱猫/🐶狗"chip 是无效控件，
        // 用户选"狗"也只会得到没有任何物种信息的提示词
        species,
        description: description || undefined,
      })
      const parsed = parseRecommendResult(res)
      if (parsed.length > 0) {
        resultList = parsed
      }

      if (resultList.length === 0) {
        resultList = generateFallbackNames(style || '不限风格')
      }

      setNames(resultList.slice(0, 5))
      setExpandedIndex(0)
    } catch (err) {
      // 未登录/登录过期：requireAuth 内部已跳登录页，这里不再生成"假成功"的本地名字
      if (err instanceof AuthenticationError || (err as Error)?.name === 'AuthenticationError') {
        setGenerated(false)
        Taro.showToast({ title: '请先登录后再使用 AI 取名', icon: 'none' })
        return
      }
      if (mode === 'interpret') {
        setGenerated(false)
        Taro.showToast({ title: '解读服务暂时不可用，请稍后再试', icon: 'none' })
      } else {
        const style = mode === 'inspire' ? inspireStyle : keywords.trim() || '不限风格'
        setNames(generateFallbackNames(style).slice(0, 5))
        setExpandedIndex(0)
      }
    } finally {
      generatingRef.current = false
      setLoading(false)
    }
  }, [mode, breed, birthDate, gender, species, coatColor, keywords, interpretInput, inspireStyle, pairName])

  /**
   * 就用这个名字：把候选名字写入当前宠物档案（重命名）
   *
   * 2026-09-10 新增（结果闭环）：此前取名页只能"看"，用户想用还得去宠物编辑页重敲一遍。
   * @param name - 选中的名字
   */
  const handleApplyName = useCallback(async (name: string) => {
    if (!currentPet) {
      Taro.showToast({ title: '请先添加宠物', icon: 'none' })
      return
    }
    if (currentPet.name === name) {
      Taro.showToast({ title: '宝贝已经叫这个名字啦', icon: 'none' })
      return
    }
    try {
      await usePetStore.getState().updatePet(currentPet.id, { name })
      Taro.showToast({ title: `已改名为「${name}」`, icon: 'success' })
    } catch {
      Taro.showToast({ title: '改名失败，请稍后再试', icon: 'none' })
    }
  }, [currentPet])

  const switchMode = useCallback((m: NamingMode) => {
    setMode(m)
    setNames([])
    setInterpretText('')
    setExpandedIndex(null)
    setGenerated(false)
  }, [])

  return (
    <View className={`naming ${themeClass}`}>
      <PageBackground />
      {/* 页面标题区 */}
      <View className='naming__head'>
        <View className='naming__title-row'>
          <Text className='naming__title'>取名引擎</Text>
          <View className='naming__badge'>
            <Text className='naming__badge-text'>文化解码 · 故事讲述</Text>
          </View>
        </View>
        <Text className='naming__subtitle'>输入宠物信息，让 AI 从诗词、星象与山川草木里，为毛孩子挑一个念念不忘的名字。</Text>
      </View>

      {/* 模式选择 2x2 */}
      <View className='naming__section'>
        <Text className='naming__section-title'>选择取名方式</Text>
        <View className='naming__mode-grid'>
          {MODES.map(m => (
            <View
              key={m.key}
              className={`naming__mode-card ${mode === m.key ? 'naming__mode-card--active' : ''}`}
              onClick={() => switchMode(m.key)}
            >
              <View className='naming__mode-icon'>{m.icon}</View>
              <Text className='naming__mode-title'>{m.title}</Text>
              <Text className='naming__mode-desc'>{m.desc}</Text>
            </View>
          ))}
        </View>
      </View>

      {/* 宠物信息输入卡 */}
      <View className='xhh-card naming__form'>
        <View className='naming__form-title'>
          <Icon name='paw-print' size={18} tone='primary' className='naming__form-title-icon' />
          <Text className='naming__form-title-text'>宠物信息</Text>
        </View>

        {/* 解读模式：名字输入 */}
        {mode === 'interpret' ? (
          <View className='naming__field'>
            <Text className='naming__label'>名字</Text>
            <Input
              className='naming__input'
              value={interpretInput}
              onInput={e => setInterpretInput(e.detail.value)}
              placeholder='输入想解读的名字'
              placeholderClass='naming__placeholder'
              maxlength={12}
            />
          </View>
        ) : (
          <>
            <View className='naming__field'>
              <Text className='naming__label'>物种</Text>
              <View className='naming__chips'>
                {SPECIES_OPTIONS.map(opt => (
                  <View
                    key={opt.value}
                    className={`naming__chip ${species === opt.value ? 'naming__chip--active' : ''}`}
                    onClick={() => setSpecies(opt.value)}
                  >
                    {/* 物种属功能性图标位：emoji 换面性 Icon，可随主题换色（与全站图标体系一致） */}
                    <Icon name={opt.value === 'cat' ? 'cat' : 'dog'} size={14} tone={species === opt.value ? 'primary' : 'muted'} />
                    <Text className='naming__chip-text'>{opt.value === 'cat' ? '猫' : '狗'}</Text>
                  </View>
                ))}
              </View>
            </View>

            <View className='naming__field-row'>
              <View className='naming__field naming__field--half'>
                <Text className='naming__label'>品种</Text>
                <Input
                  className='naming__input'
                  value={breed}
                  onInput={e => setBreed(e.detail.value)}
                  placeholder='如 布偶 / 柯基'
                  placeholderClass='naming__placeholder'
                  maxlength={20}
                />
              </View>
              <View className='naming__field naming__field--half'>
                <Text className='naming__label'>出生日期</Text>
                <Input
                  className='naming__input'
                  value={birthDate}
                  onInput={e => setBirthDate(e.detail.value)}
                  placeholder='如 2026-03-12'
                  placeholderClass='naming__placeholder'
                  maxlength={10}
                />
              </View>
            </View>

            <View className='naming__field'>
              <Text className='naming__label'>性别</Text>
              <View className='naming__chips'>
                {GENDER_OPTIONS.map(opt => (
                  <View
                    key={opt.value}
                    className={`naming__chip ${gender === opt.value ? 'naming__chip--active' : ''}`}
                    onClick={() => setGender(opt.value as 'male' | 'female')}
                  >
                    <Text className='naming__chip-text'>{opt.label}</Text>
                  </View>
                ))}
              </View>
            </View>

            <View className='naming__field-row'>
              <View className='naming__field naming__field--half'>
                <Text className='naming__label'>毛色</Text>
                <Input
                  className='naming__input'
                  value={coatColor}
                  onInput={e => setCoatColor(e.detail.value)}
                  placeholder='如 橘白 / 三花'
                  placeholderClass='naming__placeholder'
                  maxlength={10}
                />
              </View>
              <View className='naming__field naming__field--half'>
                <Text className='naming__label'>偏好关键词（选填）</Text>
                <Input
                  className='naming__input'
                  value={keywords}
                  onInput={e => setKeywords(e.detail.value)}
                  placeholder='如 文雅 / 霸气 / 可爱'
                  placeholderClass='naming__placeholder'
                  maxlength={10}
                />
              </View>
            </View>
          </>
        )}

        {/* 灵感探索：风格选择 */}
        {mode === 'inspire' && (
          <View className='naming__field'>
            <Text className='naming__label'>取名方向</Text>
            <View className='naming__chips'>
              {INSPIRE_STYLES.map(style => (
                <View
                  key={style}
                  className={`naming__chip naming__chip--wide ${inspireStyle === style ? 'naming__chip--active' : ''}`}
                  onClick={() => setInspireStyle(style)}
                >
                  <Text className='naming__chip-text'>{style}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* 配对取名：现有名字 */}
        {mode === 'pair' && (
          <View className='naming__field'>
            <Text className='naming__label'>现有宠物名字</Text>
            <Input
              className='naming__input'
              value={pairName}
              onInput={e => setPairName(e.detail.value)}
              placeholder='如 年糕 → 帮你搭配「麻薯」'
              placeholderClass='naming__placeholder'
              maxlength={12}
            />
          </View>
        )}
      </View>

      {/* 生成按钮 */}
      <View
        className={`naming__generate ${loading ? 'naming__generate--loading' : ''}`}
        onClick={handleGenerate}
      >
        <Text className='naming__generate-icon'>🪄</Text>
        <Text className='naming__generate-text'>{loading ? 'AI 正在推敲中...' : '开始取名'}</Text>
      </View>

      {/* 解读结果 */}
      {mode === 'interpret' && interpretText && (
        <View className='xhh-card naming__interpret-result'>
          <View className='naming__interpret-head'>
            <Text className='naming__interpret-title'>🔍 「{interpretInput}」名字解读</Text>
          </View>
          <Text className='naming__interpret-text'>{interpretText}</Text>
        </View>
      )}

      {/* 候选名字 */}
      {generated && isRecommendMode && names.length > 0 && (
        <View className='naming__results'>
          <View className='naming__results-head'>
            <View className='naming__results-title'>
              <Text className='naming__results-title-icon'>✨</Text>
              <Text className='naming__results-title-text'>候选名字</Text>
            </View>
            <Text className='naming__results-hint'>点击卡片查看完整文化解读</Text>
          </View>

          {names.map((item, index) => {
            const expanded = expandedIndex === index
            const tone = sourceTone(item.source)
            return (
              <View
                key={`${item.name}-${index}`}
                className={`xhh-card naming__name-card ${expanded ? 'naming__name-card--expanded' : ''}`}
                onClick={() => setExpandedIndex(expanded ? null : index)}
              >
                <View className='naming__name-top'>
                  <View className='naming__name-left'>
                    <Text className='naming__name'>{item.name}</Text>
                  </View>
                  <View className='naming__name-right'>
                    <Text className='naming__stars'>{renderStars(item.score)}</Text>
                    <View className={`naming__source-chip naming__source-chip--${tone}`}>
                      <Text className='naming__source-chip-text'>{item.source ? sourceLabel(item.source) : 'AI推荐'}</Text>
                    </View>
                  </View>
                </View>

                <Text className='naming__meaning'>{item.meaning}</Text>

                <View className='naming__expand-btn'>
                  <Text className='naming__expand-btn-text'>{expanded ? '收起解读' : '查看完整解读'}</Text>
                  <Text className={`naming__expand-arrow ${expanded ? 'naming__expand-arrow--up' : ''}`}>▾</Text>
                </View>

                {expanded && (
                  <View className='naming__insight'>
                    <View className='naming__insight-item'>
                      <View className='naming__insight-ic naming__insight-ic--success'>🌿</View>
                      <View className='naming__insight-body'>
                        <Text className='naming__insight-title'>五行分析</Text>
                        <Text className='naming__insight-text'>{item.wuxing ? `「${item.name}」五行属${item.wuxing}。` : '暂无五行数据，以 AI 深度解读为准。'}</Text>
                      </View>
                    </View>
                    <View className='naming__insight-item'>
                      <View className='naming__insight-ic naming__insight-ic--gold'>⭐</View>
                      <View className='naming__insight-body'>
                        <Text className='naming__insight-title'>星象关联</Text>
                        <Text className='naming__insight-text'>{item.starMansion ? `应${item.starMansion}守护。` : '暂无星象数据，以 AI 深度解读为准。'}</Text>
                      </View>
                    </View>
                    {item.source && (
                      <View className='naming__insight-item'>
                        <View className='naming__insight-ic naming__insight-ic--info'>📜</View>
                        <View className='naming__insight-body'>
                          <Text className='naming__insight-title'>诗词出处</Text>
                          <Text className='naming__insight-text'>{item.source}</Text>
                        </View>
                      </View>
                    )}
                    <View className='naming__insight-item'>
                      <View className='naming__insight-ic naming__insight-ic--coral'>💬</View>
                      <View className='naming__insight-body'>
                        <Text className='naming__insight-title'>寓意详解</Text>
                        <Text className='naming__insight-text'>{item.meaning}</Text>
                      </View>
                    </View>

                    {/* 结果闭环：一键用这个名字重命名当前宠物（2026-09-10） */}
                    <View
                      className='naming__apply-btn'
                      hoverClass='naming__apply-btn--hover'
                      onClick={(e) => { e.stopPropagation(); handleApplyName(item.name) }}
                    >
                      <Text className='naming__apply-btn-text'>就用这个名字 ✨</Text>
                    </View>
                  </View>
                )}
              </View>
            )
          })}
        </View>
      )}

      {/* 免责提示 */}
      <Text className='naming__disclaimer'>AI 取名仅供娱乐参考，愿每个名字都藏着主人对宝贝的爱。</Text>
    </View>
  )
}

/** 出处标签 */
function sourceLabel(source: string): string {
  if (!source) return 'AI推荐'
  if (source.includes('《') || source.includes('诗')) return '诗词'
  if (source.includes('色彩') || source.includes('食物') || source.includes('萌')) return '趣味'
  if (source.includes('星')) return '星象'
  return '典故'
}
