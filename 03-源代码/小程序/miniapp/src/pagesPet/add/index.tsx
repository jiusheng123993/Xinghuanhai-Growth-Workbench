/**
 * 添加宠物页面
 * 宠物信息表单输入，支持品种搜索选择、头像上传
 */
import { View, Text, Input, Picker, Switch, Textarea, Image, ScrollView } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { useState, useMemo, useEffect, useCallback, useRef } from 'react'
import { useThemeClass } from '../../hooks/useThemeClass'
import { usePet } from '../../hooks/usePet'
import { useVaccine } from '../../hooks/useVaccine'
import { useAuthStore } from '../../stores/authStore'
import { getActiveBreeds, UNKNOWN_BREED_ID, UNKNOWN_BREED_NAME, isUnknownBreedKeyword } from '../../data/petKnowledge/breeds'
import { useAnalytics } from '../../hooks/useAnalytics'
import { AnalyticsEventName } from '../../types/analyticsTypes'
import { safeNavigateBack } from '../../utils/navigation'
import { chooseImageWithPrivacy } from '../../utils/privacy'
import { uploadPetPhoto } from '../../services/avatarService'
import { recognizeBreed, matchBreedInData, syncBreedKnowledge, type BreedRecognizeResult } from '../../services/breedService'
import type { BreedItem } from '../../data/petKnowledge/breeds'
import './index.scss'
import { PageBackground, Icon  } from '../../components'

/** 草稿存储 key */
const DRAFT_KEY = 'xhh_add_pet_draft'

interface FormData {
  name: string
  species: 'dog' | 'cat' | ''
  breedId: string
  breedName: string
  gender: 'male' | 'female' | ''
  birthDate: string
  weight: string
  coatColor: string
  isNeutered: boolean
  microchipId: string
  allergies: string
  medications: string
  chronicConditions: string
  notes: string
  avatarUrl: string
}

const INITIAL_FORM: FormData = {
  name: '',
  species: '',
  breedId: '',
  breedName: '',
  gender: '',
  birthDate: '',
  weight: '',
  coatColor: '',
  isNeutered: false,
  microchipId: '',
  allergies: '',
  medications: '',
  chronicConditions: '',
  notes: '',
  avatarUrl: '',
}

/** 从 storage 恢复草稿 */
function loadDraft(): Partial<FormData> | null {
  try {
    const raw = Taro.getStorageSync(DRAFT_KEY)
    if (raw) {
      Taro.removeStorageSync(DRAFT_KEY) // 消费后清除
      return JSON.parse(raw)
    }
  } catch {}
  return null
}

/** 保存草稿到 storage */
function saveDraft(data: FormData) {
  try {
    Taro.setStorageSync(DRAFT_KEY, JSON.stringify(data))
  } catch {}
}

export default function AddPet() {
  const themeClass = useThemeClass()
  const { addPet, updatePet } = usePet()
  const { initPlan } = useVaccine()
  const { trackPageView, trackEvent } = useAnalytics()
  const isAuthenticated = useAuthStore(s => s.isAuthenticated)
  const userId = useAuthStore(s => s.user?.id) || ''
  const [formData, setFormData] = useState<FormData>(() => {
    // 尝试恢复草稿
    const draft = loadDraft()
    if (draft) {
      // 草稿里的头像可能是上次会话的微信临时路径（wxfile:// / http://tmp），跨会话已失效——
      // 直接置空，避免恢复后提交时上传必失败
      const safeDraft = { ...draft }
      if (safeDraft.avatarUrl && /^(wxfile:\/\/|http:\/\/tmp)/.test(safeDraft.avatarUrl)) {
        safeDraft.avatarUrl = ''
      }
      return { ...INITIAL_FORM, ...safeDraft }
    }
    return { ...INITIAL_FORM }
  })
  const [submitting, setSubmitting] = useState(false)
  const [selectedBreed, setSelectedBreed] = useState<BreedItem | null>(null)
  const [showBreedPanel, setShowBreedPanel] = useState(false)
  const [breedSearch, setBreedSearch] = useState('')
  // 键盘高度（px）：品种面板是底部弹层，搜索框聚焦拉起键盘后若不做偏移，
  // 结果列表会被键盘盖住，用户必须收起键盘才能看到——用 onKeyboardHeightChange 实时抬升面板
  const [keyboardHeight, setKeyboardHeight] = useState(0)
  // 拍照识别品种状态：isRecognizing=识别中（防连点+遮罩）；recognizeResult=识别结果；matchedBreed=库内匹配到的品种（可能为 null）
  const [isRecognizing, setIsRecognizing] = useState(false)
  const [recognizeResult, setRecognizeResult] = useState<BreedRecognizeResult | null>(null)
  const [matchedBreed, setMatchedBreed] = useState<BreedItem | null>(null)
  // 同步防连点标志：state 更新是异步的，连点两次在 state 生效前都读到 false；
  // ref 同步赋值才能真正拦住「选图阶段」的第二次点击（第二次拉起选图依赖平台失败不可靠）
  const recognizingRef = useRef(false)

  useEffect(() => {
    trackPageView('add_pet')
  }, [trackPageView])

  // 品种库热更新：挂载时拉一次服务端最新版本（失败不阻塞；用户可能不进品种百科页直接添加宠物）
  const [breedDataVersion, setBreedDataVersion] = useState(0)
  useEffect(() => {
    syncBreedKnowledge().then((synced) => {
      if (synced) setBreedDataVersion((v) => v + 1)
    })
  }, [])

  // 品种面板打开期间监听键盘高度变化；关闭/卸载时取消监听并复位偏移
  useEffect(() => {
    if (!showBreedPanel) return
    const handler = (res: { height: number }) => setKeyboardHeight(res.height)
    Taro.onKeyboardHeightChange(handler)
    return () => {
      Taro.offKeyboardHeightChange(handler)
      setKeyboardHeight(0)
    }
  }, [showBreedPanel])

  const filteredBreeds = useMemo(() => {
    void breedDataVersion // 仅作刷新信号：热更新切换成功后递增触发本 memo 重算
    if (!formData.species) return []
    return getActiveBreeds().filter((b) => b.species === formData.species)
  }, [formData.species, breedDataVersion])

  const searchedBreeds = useMemo(() => {
    if (!breedSearch.trim()) return filteredBreeds
    const keyword = breedSearch.trim().toLowerCase()
    return filteredBreeds.filter((b) =>
      b.name.toLowerCase().includes(keyword) ||
      b.aliases.some((a) => a.toLowerCase().includes(keyword))
    )
  }, [filteredBreeds, breedSearch])

  // 「不确定品种」固定行显隐：初始态（未搜索）常显；搜索时仅当关键词命中才展示
  const showUnknownBreed = useMemo(() => {
    return !breedSearch.trim() || isUnknownBreedKeyword(breedSearch)
  }, [breedSearch])

  // 用 useCallback 包裹：表单字段更新只依赖稳定的 setFormData，可空依赖；
  // 否则每次渲染都新建引用，会让依赖它的品种选择回调频繁重建（react-hooks/exhaustive-deps 告警）
  const updateField = useCallback(<K extends keyof FormData>(key: K, value: FormData[K]) => {
    setFormData((prev) => ({ ...prev, [key]: value }))
  }, [])

  const handleSpeciesChange = (species: 'dog' | 'cat') => {
    trackEvent('select_species', { species })
    updateField('species', species)
    updateField('breedId', '')
    updateField('breedName', '')
    setSelectedBreed(null)
  }

  const handleOpenBreedPanel = useCallback(() => {
    if (!formData.species) return
    setBreedSearch('')
    // 重新打开面板时清掉上次的识别结果，避免残留
    setRecognizeResult(null)
    setMatchedBreed(null)
    setShowBreedPanel(true)
  }, [formData.species])

  /**
   * 拍照识别品种：调起相机/相册 → 上传 AI 识别 → 在品种库匹配
   * 识别成功后面板内展示结果卡，用户一键选用；识别失败/取消不打扰流程
   */
  const handleRecognizeBreed = async () => {
    // 同步 ref 防连点：识别全程（含选图阶段）只允许一次
    if (recognizingRef.current) return
    // 识别接口需要登录态（服务端 authMiddleware），未登录先走引导（草稿已由 ensureLoggedIn 保存）
    if (!ensureLoggedIn()) return
    recognizingRef.current = true
    setIsRecognizing(true)
    try {
      const res = await chooseImageWithPrivacy({
        count: 1,
        sizeType: ['compressed'],
        sourceType: ['camera', 'album'],
      })
      if (!res.tempFilePaths || res.tempFilePaths.length === 0) return
      trackEvent('breed_recognize_start', { source: 'add_pet' })
      const result = await recognizeBreed(res.tempFilePaths[0])
      if (result) {
        // 名称/别名/包含三级匹配库内品种；匹配不到（可能识别出库外品种）则为 null
        const matchedId = matchBreedInData(result.breedName, result.species, getActiveBreeds())
        const matched = matchedId ? (getActiveBreeds().find(b => b.id === matchedId) ?? null) : null
        setRecognizeResult(result)
        setMatchedBreed(matched)
        trackEvent('breed_recognize_success', {
          breedName: result.breedName,
          confidence: result.confidence,
          matched: !!matched,
          source: 'add_pet',
        })
      }
    } catch (err: any) {
      // 用户取消选图不提示；其余失败 recognizeBreed 内部已 toast
      if (err?.errMsg?.includes('cancel')) return
      console.warn('[AddPet] breed recognize failed:', err)
    } finally {
      recognizingRef.current = false
      setIsRecognizing(false)
    }
  }

  /** 关闭识别结果卡（保留面板，可继续手动搜索/重拍） */
  const closeRecognizeResult = () => {
    setRecognizeResult(null)
    setMatchedBreed(null)
  }

  /**
   * 采用识别结果：
   * - 匹配到库内品种 → 直接复用 handleSelectBreed 选中（含品种特征卡）；
   * - 未收录 → 按识别名填写（breedId 走 unknown_mix 默认健康逻辑，breed 显示识别出的名字）
   * 物种以照片识别结果为准：与表单不符时自动切换并清空旧品种
   */
  const applyRecognizeResult = () => {
    const r = recognizeResult
    if (!r) return
    // 物种联动：照片是权威，识别物种与已选不符时先切换物种（会清空旧品种）
    if (formData.species !== r.species) {
      updateField('species', r.species)
      updateField('breedId', '')
      updateField('breedName', '')
      setSelectedBreed(null)
    }
    if (matchedBreed) {
      handleSelectBreed(matchedBreed)
    } else {
      updateField('breedId', UNKNOWN_BREED_ID)
      updateField('breedName', r.breedName)
      setSelectedBreed(null)
      setShowBreedPanel(false)
      Taro.hideKeyboard()
      trackEvent('select_breed_recognized_unmatched', { breedName: r.breedName })
    }
    setRecognizeResult(null)
    setMatchedBreed(null)
  }

  /**
   * 关闭品种面板：卸载搜索框同时收起键盘（不收起键盘的话键盘会残留遮挡页面）
   * 识别期间禁止关闭：付费识别请求已发出，关掉会把结果静默丢弃还白花一次 AI 调用
   */
  const handleCloseBreedPanel = useCallback(() => {
    if (isRecognizing) return
    setShowBreedPanel(false)
    Taro.hideKeyboard()
  }, [isRecognizing])

  const handleSelectBreed = useCallback((breed: BreedItem) => {
    updateField('breedId', breed.id)
    updateField('breedName', breed.name)
    setSelectedBreed(breed)
    setShowBreedPanel(false)
    Taro.hideKeyboard()
  }, [updateField])

  /** 选择「不确定品种」：混血/串串/不知道品种的用户兜底，不展示品种特征卡 */
  const handleSelectUnknownBreed = useCallback(() => {
    trackEvent('select_breed_unknown')
    updateField('breedId', UNKNOWN_BREED_ID)
    updateField('breedName', UNKNOWN_BREED_NAME)
    setSelectedBreed(null)
    setShowBreedPanel(false)
    Taro.hideKeyboard()
  }, [updateField, trackEvent])

  const handleBirthDateChange = (e: { detail: { value: string } }) => {
    updateField('birthDate', e.detail.value)
  }

  const handleChooseAvatar = () => {
    trackEvent('choose_avatar')
    chooseImageWithPrivacy({
      count: 1,
      sizeType: ['compressed'],
      sourceType: ['album', 'camera'],
    }).then((res) => {
      // 极端情况下微信可能返回空数组，此时不更新表单，避免写入 undefined 临时路径
      if (!res.tempFilePaths || res.tempFilePaths.length === 0) return
      updateField('avatarUrl', res.tempFilePaths[0])
    }).catch((err) => {
      // 失败反馈（errno 112 / 拒绝隐私授权 / 其他失败）已由
      // chooseImageWithPrivacy 内部统一 toast/modal 提示（用户取消除外），
      // 这里仅保留日志便于排查，不再重复弹提示
      console.warn('[AddPet] chooseImage failed:', err)
    })
  }

  const validate = (): boolean => {
    if (!formData.name.trim()) {
      Taro.showToast({ title: '请输入宠物名字', icon: 'none' })
      return false
    }
    if (!formData.species) {
      Taro.showToast({ title: '请选择物种', icon: 'none' })
      return false
    }
    if (!formData.breedId) {
      Taro.showToast({ title: '请选择品种', icon: 'none' })
      return false
    }
    if (!formData.gender) {
      Taro.showToast({ title: '请选择性别', icon: 'none' })
      return false
    }
    if (!formData.birthDate) {
      Taro.showToast({ title: '请选择出生日期', icon: 'none' })
      return false
    }
    return true
  }

  /** 检查登录状态，未登录则保存草稿并引导登录 */
  const ensureLoggedIn = (): boolean => {
    if (isAuthenticated) return true
    // 保存草稿到 storage
    saveDraft(formData)
    // 弹窗引导登录
    Taro.showModal({
      title: '需要登录',
      content: '保存宠物信息需要登录账号。\n当前填写的内容不会丢失，登录后会自动恢复。',
      confirmText: '去登录',
      cancelText: '暂不',
      success: (res) => {
        if (res.confirm) {
          Taro.navigateTo({ url: '/pagesUser/login/index' })
        }
      },
    })
    return false
  }

  const handleSubmit = async () => {
    if (!validate()) return
    // 未登录则弹窗引导登录，不继续提交
    if (!ensureLoggedIn()) return

    setSubmitting(true)
    // 头像上传失败标志（作用域需覆盖下方 toast 分支；失败不阻塞"添加成功"）
    let avatarFailed = false
    try {
      // 创建时不带微信临时路径头像（wxfile:// 无效，落库即坏）：
      // 创建成功后拿到 petId 再上传照片，回填真实 URL
      const newPet = await addPet({
        name: formData.name.trim(),
        species: formData.species as 'dog' | 'cat',
        breed: formData.breedName,
        breedId: formData.breedId,
        gender: formData.gender as 'male' | 'female',
        birthDate: formData.birthDate,
        weight: formData.weight ? parseFloat(formData.weight) : 0,
        coatColor: formData.coatColor.trim(),
        photos: [], // 头像照片在创建成功后上传再回填，避免微信临时路径落库
        isNeutered: formData.isNeutered,
        microchipId: formData.microchipId.trim(),
        allergies: formData.allergies ? formData.allergies.split(/[,，]/).map(s => s.trim()).filter(Boolean) : [],
        medications: formData.medications ? formData.medications.split(/[,，]/).map(s => s.trim()).filter(Boolean) : [],
        chronicConditions: formData.chronicConditions ? formData.chronicConditions.split(/[,，]/).map(s => s.trim()).filter(Boolean) : [],
        notes: formData.notes.trim(),
        isDeceased: false,
        userId,
      })

      if (newPet?.id) {
        trackEvent(AnalyticsEventName.PetCreate, { species: formData.species, breed: formData.breedName, source: 'add_pet' })
        initPlan(newPet.id, {
          species: formData.species as 'dog' | 'cat',
          breed: formData.breedName,
          birthDate: formData.birthDate,
        }).catch(() => {
        })

        // 用户选择了头像照片：创建成功后上传并回填（上传失败不影响"添加成功"，头像可稍后在档案中修改）
        // 注意：photos 是"相册"集合，与"头像"语义分离——这里只回填 avatarPhotoUrl，不整体覆盖 photos
        if (formData.avatarUrl) {
          try {
            const up = await uploadPetPhoto(newPet.id, formData.avatarUrl)
            if (up.success && up.data?.url) {
              await updatePet(newPet.id, { avatarPhotoUrl: up.data.url })
            } else {
              avatarFailed = true
            }
          } catch {
            // uploadPetPhoto 内部已 try/catch 返回失败，一般不抛；
            // 此处防御 updatePet 的网络异常
            avatarFailed = true
          }
        }
      }

      Taro.showToast({ title: '添加成功', icon: 'success' })
      if (avatarFailed) {
        // 失败提示延后弹出，避免被"添加成功"toast 单槽覆盖
        setTimeout(() => {
          Taro.showToast({ title: '头像上传失败，可稍后在档案中修改', icon: 'none', duration: 2000 })
        }, 1200)
        setTimeout(() => {
          safeNavigateBack()
        }, 3400)
      } else {
        setTimeout(() => {
          safeNavigateBack()
        }, 1500)
      }
    } catch (err) {
      trackEvent('add_pet_failure')
      const message = err instanceof Error ? err.message : '添加失败，请重试'
      Taro.showToast({ title: message, icon: 'none' })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <View className={`add-pet ${themeClass}`}>
      <PageBackground />
      <View className='add-pet__form'>
        <View className='add-pet__form-item'>
          <Text className='add-pet__label add-pet__label--required'>名字</Text>
          <Input
            className='add-pet__input'
            placeholder='请输入宠物名字'
            placeholderClass='add-pet__input-placeholder'
            value={formData.name}
            onInput={(e) => updateField('name', e.detail.value)}
            maxlength={20}
          />
        </View>

        <View className='add-pet__form-item'>
          <Text className='add-pet__label add-pet__label--required'>物种</Text>
          <View className='add-pet__species-group'>
            <View
              className={`add-pet__species-btn ${formData.species === 'dog' ? 'add-pet__species-btn--active' : ''}`}
              onClick={() => handleSpeciesChange('dog')}
            >
              <Icon name='dog' size={20} tone='primary' className='add-pet__species-icon' />
              <Text>狗狗</Text>
            </View>
            <View
              className={`add-pet__species-btn ${formData.species === 'cat' ? 'add-pet__species-btn--active' : ''}`}
              onClick={() => handleSpeciesChange('cat')}
            >
              <Icon name='cat' size={20} tone='primary' className='add-pet__species-icon' />
              <Text>猫猫</Text>
            </View>
          </View>
        </View>

        <View className='add-pet__form-item'>
          <Text className='add-pet__label add-pet__label--required'>品种</Text>
          <View
            className={`add-pet__picker ${!formData.species ? 'add-pet__picker--disabled' : ''}`}
            onClick={handleOpenBreedPanel}
          >
            <Text className={formData.breedName ? '' : 'add-pet__picker-placeholder'}>
              {formData.breedName || '请先选择物种，再搜索品种'}
            </Text>
            <Icon name='magnifying-glass' size={18} tone='muted' className='add-pet__picker-arrow' />
          </View>
        </View>

        {showBreedPanel && (
          <View
            className='add-pet__breed-panel-overlay'
            onClick={handleCloseBreedPanel}
            style={{ paddingBottom: keyboardHeight }}
          >
            <View className='add-pet__breed-panel' onClick={(e: any) => e.stopPropagation()}>
              <View className='add-pet__breed-panel-header'>
                <Text className='add-pet__breed-panel-title'>选择品种</Text>
                <View className='add-pet__breed-panel-close' onClick={handleCloseBreedPanel}>
                  <Text>✕</Text>
                </View>
              </View>

              {/* 拍照识别品种入口：不知道品种时的首选方案，AI 识别后一键选用 */}
              <View
                className={`add-pet__breed-panel-recognize ${isRecognizing ? 'add-pet__breed-panel-recognize--loading' : ''}`}
                onClick={handleRecognizeBreed}
              >
                <Text className='add-pet__breed-panel-recognize-icon'>{isRecognizing ? '⏳' : '📷'}</Text>
                <View className='add-pet__breed-panel-recognize-text'>
                  <Text className='add-pet__breed-panel-recognize-title'>
                    {isRecognizing ? 'AI 正在识别品种...' : '拍照识别品种'}
                  </Text>
                  <Text className='add-pet__breed-panel-recognize-sub'>
                    {isRecognizing ? '请稍候，正在分析照片中的宠物' : '不知道品种？拍张照片，AI 帮你认'}
                  </Text>
                </View>
                <Text className='add-pet__breed-panel-recognize-arrow'>›</Text>
              </View>

              <View className='add-pet__breed-panel-search'>
                <Icon name='magnifying-glass' size={18} tone='primary' className='add-pet__breed-panel-search-icon' />
                <Input
                  className='add-pet__breed-panel-search-input'
                  placeholder='搜索品种名称或别名'
                  placeholderClass='add-pet__input-placeholder'
                  value={breedSearch}
                  onInput={(e) => setBreedSearch(e.detail.value)}
                  focus
                  confirmType='search'
                  // 关闭微信自动上推页面，改为用键盘高度手动抬升面板，避免双偏移/不生效
                  adjustPosition={false}
                />
                {breedSearch && (
                  <View className='add-pet__breed-panel-clear' onClick={() => setBreedSearch('')}>
                    <Text>✕</Text>
                  </View>
                )}
              </View>
              <ScrollView className='add-pet__breed-panel-list' scrollY enhanced showScrollbar={false}>
                {/* 识别结果卡：匹配到库内品种 → 一键选用；未收录 → 按识别名填写或退到不确定品种 */}
                {recognizeResult && !isRecognizing && (
                  <View className='add-pet__breed-panel-recognize-result'>
                    <View className='add-pet__breed-panel-recognize-result-head'>
                      <Text className='add-pet__breed-panel-recognize-result-icon'>
                        {recognizeResult.species === 'dog' ? '🐶' : '🐱'}
                      </Text>
                      <View className='add-pet__breed-panel-recognize-result-info'>
                        <Text className='add-pet__breed-panel-recognize-result-name'>
                          识别为：{recognizeResult.breedName}
                        </Text>
                        <Text className='add-pet__breed-panel-recognize-result-conf'>
                          置信度 {recognizeResult.confidence}%
                          {matchedBreed ? ' · 已在品种库中找到' : ' · 品种库未收录，可按识别名填写'}
                        </Text>
                      </View>
                    </View>
                    <View className='add-pet__breed-panel-recognize-result-actions'>
                      {matchedBreed ? (
                        <View className='add-pet__breed-panel-recognize-btn add-pet__breed-panel-recognize-btn--primary' onClick={applyRecognizeResult}>
                          <Icon name='check-circle' size={18} tone='white' />
                          <Text>就用这个</Text>
                        </View>
                      ) : (
                        <>
                          <View className='add-pet__breed-panel-recognize-btn add-pet__breed-panel-recognize-btn--primary' onClick={applyRecognizeResult}>
                            <Text>按识别名填写</Text>
                          </View>
                          <View className='add-pet__breed-panel-recognize-btn' onClick={handleSelectUnknownBreed}>
                            <Text>选不确定品种</Text>
                          </View>
                        </>
                      )}
                      <View className='add-pet__breed-panel-recognize-btn add-pet__breed-panel-recognize-btn--ghost' onClick={closeRecognizeResult}>
                        <Text>重拍/关闭</Text>
                      </View>
                    </View>
                  </View>
                )}
                {showUnknownBreed && (
                  <View
                    className={`add-pet__breed-panel-item add-pet__breed-panel-item--unknown ${formData.breedId === UNKNOWN_BREED_ID ? 'add-pet__breed-panel-item--active' : ''}`}
                    onClick={handleSelectUnknownBreed}
                  >
                    <View className='add-pet__breed-panel-item-info'>
                      <Text className='add-pet__breed-panel-item-name'>{UNKNOWN_BREED_NAME}</Text>
                      <Text className='add-pet__breed-panel-item-unknown-hint'>混血/串串/不清楚品种？选这里，之后可随时修改</Text>
                    </View>
                    <Text className='add-pet__breed-panel-item-origin'>常见于流浪猫狗</Text>
                  </View>
                )}
                {searchedBreeds.length === 0 ? (
                  <View className='add-pet__breed-panel-empty'>
                    <Text>{showUnknownBreed ? '未找到具体品种' : '未找到匹配的品种'}</Text>
                    <Text className='add-pet__breed-panel-empty-hint'>
                      {showUnknownBreed ? '可尝试上方「不确定品种」选项' : '试试其他关键词吧'}
                    </Text>
                  </View>
                ) : (
                  searchedBreeds.map((breed) => (
                    <View
                      key={breed.id}
                      className={`add-pet__breed-panel-item ${formData.breedId === breed.id ? 'add-pet__breed-panel-item--active' : ''}`}
                      onClick={() => handleSelectBreed(breed)}
                    >
                      <View className='add-pet__breed-panel-item-info'>
                        <Text className='add-pet__breed-panel-item-name'>{breed.name}</Text>
                        {breed.aliases.length > 0 && (
                          <Text className='add-pet__breed-panel-item-alias'>{breed.aliases.join('、')}</Text>
                        )}
                      </View>
                      <Text className='add-pet__breed-panel-item-origin'>{breed.origin}</Text>
                    </View>
                  ))
                )}
              </ScrollView>

              {/* 识别中遮罩：覆盖整个面板，防止识别期间误触列表/搜索 */}
              {isRecognizing && (
                <View className='add-pet__breed-panel-mask'>
                  <View className='add-pet__breed-panel-mask-spinner' />
                  <Text className='add-pet__breed-panel-mask-text'>AI 正在识别品种...</Text>
                </View>
              )}
            </View>
          </View>
        )}

        {selectedBreed && (
          <View className='add-pet__breed-info'>
            <View className='add-pet__breed-info-header'>
              <Text className='add-pet__breed-info-title'>📋 {selectedBreed.name}品种特征</Text>
            </View>
            {selectedBreed.commonDiseases.length > 0 && (
              <View className='add-pet__breed-info-row'>
                <Text className='add-pet__breed-info-label'>🏥 常见疾病</Text>
                <View className='add-pet__breed-info-tags'>
                  {selectedBreed.commonDiseases.map((d) => (
                    <Text key={d} className='add-pet__breed-info-tag add-pet__breed-info-tag--warn'>{d}</Text>
                  ))}
                </View>
              </View>
            )}
            <View className='add-pet__breed-info-row'>
              <View className='add-pet__breed-info-label'>
                <Icon name='scales' size={18} tone='primary' />
                <Text>标准体重</Text>
              </View>
              <Text className='add-pet__breed-info-value'>{selectedBreed.weightRange.min} ~ {selectedBreed.weightRange.max} kg</Text>
            </View>
            {selectedBreed.dietRestrictions.length > 0 && (
              <View className='add-pet__breed-info-row'>
                <View className='add-pet__breed-info-label'>
                  <Icon name='prohibit' size={18} tone='danger' />
                  <Text>饮食禁忌</Text>
                </View>
                <View className='add-pet__breed-info-tags'>
                  {selectedBreed.dietRestrictions.map((d) => (
                    <Text key={d} className='add-pet__breed-info-tag add-pet__breed-info-tag--danger'>{d}</Text>
                  ))}
                </View>
              </View>
            )}
          </View>
        )}

        <View className='add-pet__form-item'>
          <Text className='add-pet__label add-pet__label--required'>性别</Text>
          <View className='add-pet__gender-group'>
            <View
              className={`add-pet__gender-btn ${formData.gender === 'male' ? 'add-pet__gender-btn--active' : ''}`}
              onClick={() => updateField('gender', 'male')}
            >
              <Text>♂️</Text>
              <Text>公</Text>
            </View>
            <View
              className={`add-pet__gender-btn ${formData.gender === 'female' ? 'add-pet__gender-btn--active' : ''}`}
              onClick={() => updateField('gender', 'female')}
            >
              <Text>♀️</Text>
              <Text>母</Text>
            </View>
          </View>
        </View>

        <View className='add-pet__form-item'>
          <Text className='add-pet__label add-pet__label--required'>出生日期</Text>
          <Picker
            mode='date'
            value={formData.birthDate}
            onChange={handleBirthDateChange}
            end={new Date().toISOString().split('T')[0]}
          >
            <View className='add-pet__picker'>
              <Text className={formData.birthDate ? '' : 'add-pet__picker-placeholder'}>
                {formData.birthDate || '请选择出生日期'}
              </Text>
              <Text className='add-pet__picker-arrow'>▼</Text>
            </View>
          </Picker>
        </View>

        <View className='add-pet__form-item'>
          <Text className='add-pet__label'>体重（kg）</Text>
          <Input
            className='add-pet__input'
            placeholder='请输入体重'
            placeholderClass='add-pet__input-placeholder'
            type='digit'
            value={formData.weight}
            onInput={(e) => updateField('weight', e.detail.value)}
          />
        </View>

        <View className='add-pet__form-item'>
          <Text className='add-pet__label'>毛色</Text>
          <Input
            className='add-pet__input'
            placeholder='如：橘色、黑白、三花'
            placeholderClass='add-pet__input-placeholder'
            value={formData.coatColor}
            onInput={(e) => updateField('coatColor', e.detail.value)}
          />
        </View>

        <View className='add-pet__form-item'>
          <Text className='add-pet__label'>是否绝育</Text>
          <View className='add-pet__switch-row'>
            <Text className='add-pet__switch-label'>
              {formData.isNeutered ? '已绝育' : '未绝育'}
            </Text>
            <Switch
              checked={formData.isNeutered}
              onChange={(e) => updateField('isNeutered', e.detail.value)}
              color='#FF8C42'
            />
          </View>
        </View>

        <View className='add-pet__form-item'>
          <Text className='add-pet__label'>芯片号</Text>
          <Input
            className='add-pet__input'
            placeholder='请输入芯片号'
            placeholderClass='add-pet__input-placeholder'
            value={formData.microchipId}
            onInput={(e) => updateField('microchipId', e.detail.value)}
            maxlength={30}
          />
        </View>

        <View className='add-pet__form-item'>
          <Text className='add-pet__label'>过敏史</Text>
          <Input
            className='add-pet__input'
            placeholder='如：鸡肉、花粉（逗号分隔）'
            placeholderClass='add-pet__input-placeholder'
            value={formData.allergies}
            onInput={(e) => updateField('allergies', e.detail.value)}
          />
        </View>

        <View className='add-pet__form-item'>
          <Text className='add-pet__label'>用药史</Text>
          <Input
            className='add-pet__input'
            placeholder='如：心脏药、关节保健品（逗号分隔）'
            placeholderClass='add-pet__input-placeholder'
            value={formData.medications}
            onInput={(e) => updateField('medications', e.detail.value)}
          />
        </View>

        <View className='add-pet__form-item'>
          <Text className='add-pet__label'>慢性病</Text>
          <Input
            className='add-pet__input'
            placeholder='如：糖尿病、关节炎（逗号分隔）'
            placeholderClass='add-pet__input-placeholder'
            value={formData.chronicConditions}
            onInput={(e) => updateField('chronicConditions', e.detail.value)}
          />
        </View>

        <View className='add-pet__form-item'>
          <Text className='add-pet__label'>备注</Text>
          <Textarea
            className='add-pet__textarea'
            placeholder='备注信息（选填）'
            placeholderClass='add-pet__textarea-placeholder'
            value={formData.notes}
            onInput={(e) => updateField('notes', e.detail.value)}
            maxlength={200}
          />
        </View>

        <View className='add-pet__form-item'>
          <Text className='add-pet__label'>头像</Text>
          <View className='add-pet__photo-area' onClick={handleChooseAvatar}>
            {formData.avatarUrl ? (
              <Image className='add-pet__photo-preview' src={formData.avatarUrl} mode='aspectFill' lazyLoad />
            ) : (
              <View className='add-pet__photo-placeholder'>
                <Icon name='camera' size={24} tone='primary' className='add-pet__photo-icon' />
                <Text>点击选择照片</Text>
              </View>
            )}
          </View>
        </View>
      </View>

      <View className='add-pet__submit-wrap'>
        <View
          className={`add-pet__submit-btn ${submitting ? 'add-pet__submit-btn--disabled' : ''}`}
          onClick={submitting ? undefined : handleSubmit}
        >
          <Text>{submitting ? '提交中...' : '提交'}</Text>
        </View>
      </View>

    </View>
  )
}
