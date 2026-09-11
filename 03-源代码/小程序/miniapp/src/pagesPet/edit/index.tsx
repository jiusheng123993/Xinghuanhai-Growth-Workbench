/**
 * 编辑宠物页面
 * 修改宠物信息表单，预填已有数据
 */
import { View, Text, Input, Picker, Switch, Textarea, Image } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { useState, useMemo, useEffect } from 'react'
import { useThemeClass } from '../../hooks/useThemeClass'
import { usePet } from '../../hooks/usePet'
import { useAuthStore } from '../../stores/authStore'
import { getActiveBreeds, UNKNOWN_BREED_ID, UNKNOWN_BREED_NAME } from '../../data/petKnowledge/breeds'
import { useAnalytics } from '../../hooks/useAnalytics'
import { safeNavigateBack } from '../../utils/navigation'
import { chooseImageWithPrivacy } from '../../utils/privacy'
import { uploadPetPhoto } from '../../services/avatarService'
import type { PetProfile } from '../../services/petService'
import type { BreedItem } from '../../data/petKnowledge/breeds'
import '../add/index.scss'
import { PageBackground, Icon  } from '../../components'

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

/**
 * 防御性解码 URL 参数：Taro 路由一般已 decode 过一次；
 * 若参数仍含 %（未解码），补一次 decode（失败原样返回，防畸形编码抛错）
 */
const safeDecodeParam = (v?: string): string => {
  if (!v || !v.includes('%')) return v || ''
  try {
    return decodeURIComponent(v)
  } catch {
    return v
  }
}

export default function EditPet() {
  const themeClass = useThemeClass()
  const { pets, updatePet } = usePet()
  const { trackPageView, trackEvent } = useAnalytics()
  const userId = useAuthStore(s => s.user?.id) || ''
  const [formData, setFormData] = useState<FormData>({ ...INITIAL_FORM })
  const [submitting, setSubmitting] = useState(false)
  const [petId, setPetId] = useState('')
  const [selectedBreed, setSelectedBreed] = useState<BreedItem | null>(null)
  // 新选头像的本地预览路径（上传成功前展示；上传完成后 formData.avatarUrl 存服务端真实 URL）
  const [avatarDraft, setAvatarDraft] = useState<string | null>(null)
  const [uploadingAvatar, setUploadingAvatar] = useState(false)
  // 本次会话中新上传的照片 URL（仅当有值时提交 avatarPhotoUrl，避免卡通 URL 污染照片字段）
  const [avatarUploadedUrl, setAvatarUploadedUrl] = useState<string | null>(null)

  useEffect(() => {
    trackPageView('edit_pet')
  }, [trackPageView])

  useEffect(() => {
    const instance = Taro.getCurrentInstance()
    const params = instance.router?.params || {}
    const id = params.id
    if (!id) {
      Taro.showToast({ title: '参数错误', icon: 'none' })
      setTimeout(() => {
        safeNavigateBack()
      }, 1500)
      return
    }
    setPetId(id)

    // 品种百科「我的宠物是这个品种」快捷入口：URL 预填品种（breedId/breedName/species）。
    // 以 breedId 反查品种库取权威名称与物种；反查不到（如热更新移除）再退回 URL 直传值
    const prefill = params.breedId ? getActiveBreeds().find(b => b.id === params.breedId) : undefined
    const prefillSpeciesRaw = prefill?.species || params.species
    const prefillSpecies = prefillSpeciesRaw === 'dog' || prefillSpeciesRaw === 'cat' ? prefillSpeciesRaw : ''
    const prefillBreedId = prefill?.id || params.breedId || ''
    const prefillBreedName = prefill?.name || safeDecodeParam(params.breedName)

    const pet = pets.find(p => p.id === id)
    if (pet) {
      setFormData({
        name: pet.name,
        // 用户明确说「我的宠物是这个品种」：URL 带品种预填时物种跟随品种，覆盖档案旧物种
        species: prefillSpecies || pet.species,
        breedId: prefillBreedId || pet.breedId || '',
        breedName: prefillBreedName || pet.breed || '',
        gender: pet.gender === 'male' || pet.gender === 'female' ? pet.gender : '',
        birthDate: pet.birthDate,
        weight: pet.weight ? String(pet.weight) : '',
        coatColor: pet.coatColor || '',
        isNeutered: pet.isNeutered,
        microchipId: pet.microchipId || '',
        allergies: (pet.allergies || []).join('、'),
        medications: (pet.medications || []).join('、'),
        chronicConditions: (pet.chronicConditions || []).join('、'),
        notes: pet.notes || '',
        // 展示优先真实照片，其次卡通/AI 形象（与全局展示优先级一致，避免纯卡通宠物显示占位符）
        avatarUrl: pet.avatarPhotoUrl || pet.avatarCartoonUrl || '',
      })
      // 选中品种卡：优先 URL 预填品种，无预填时维持原行为（按档案旧品种回显）
      const breed = getActiveBreeds().find(b => b.id === (prefillBreedId || pet.breedId || ''))
      if (breed) setSelectedBreed(breed)
    }
  }, [pets])

  const filteredBreeds = useMemo(() => {
    if (!formData.species) return []
    return getActiveBreeds().filter((b) => b.species === formData.species)
  }, [formData.species])

  // 品种选择器选项：真实品种 + 追加「不确定品种」兜底（与添加页一致，保证已存宠物可回改）
  const breedOptions = useMemo(() => {
    const options = filteredBreeds.map((b) => ({
      value: b.id,
      label: b.aliases.length > 0 ? `${b.name}（${b.aliases[0]}）` : b.name,
    }))
    if (formData.species) {
      options.push({ value: UNKNOWN_BREED_ID, label: `${UNKNOWN_BREED_NAME}（混血/串串）` })
    }
    return options
  }, [filteredBreeds, formData.species])

  const selectedBreedIndex = useMemo(() => {
    return breedOptions.findIndex((b) => b.value === formData.breedId)
  }, [breedOptions, formData.breedId])

  const updateField = <K extends keyof FormData>(key: K, value: FormData[K]) => {
    setFormData((prev) => ({ ...prev, [key]: value }))
  }

  const handleSpeciesChange = (species: 'dog' | 'cat') => {
    trackEvent('select_species', { species })
    updateField('species', species)
    updateField('breedId', '')
    updateField('breedName', '')
    setSelectedBreed(null)
  }

  const handleBreedChange = (e: { detail: { value: number } }) => {
    const index = e.detail.value
    // 超出真实品种列表的最后一个选项即「不确定品种」（无品种特征卡）；
    // 埋点与添加页 handleSelectUnknownBreed 口径一致，便于统计不知道品种的用户占比
    if (index >= filteredBreeds.length) {
      trackEvent('select_breed_unknown')
      updateField('breedId', UNKNOWN_BREED_ID)
      updateField('breedName', UNKNOWN_BREED_NAME)
      setSelectedBreed(null)
      return
    }
    const breed = filteredBreeds[index]
    if (breed) {
      updateField('breedId', breed.id)
      updateField('breedName', breed.name)
      setSelectedBreed(breed)
    }
  }

  const handleBirthDateChange = (e: { detail: { value: string } }) => {
    updateField('birthDate', e.detail.value)
  }

  /**
   * 选择宠物头像（相册/拍照）
   * 坑点：微信返回的是 wxfile:// 临时路径，不能直接存进档案（图片无法加载）。
   * 这里选择后立即调用服务端上传接口，拿到真实 URL 再写回表单。
   */
  const handleChooseAvatar = async () => {
    trackEvent('choose_avatar')
    try {
      const res = await chooseImageWithPrivacy({
        count: 1,
        sizeType: ['compressed'],
        sourceType: ['album', 'camera'],
      })
      if (!res.tempFilePaths.length) return

      const tempPath = res.tempFilePaths[0]
      if (!petId) {
        // 理论上编辑页必有 petId（无 id 时已提示返回）；兜底：不上传也不改表单，避免把临时路径写进档案
        Taro.showToast({ title: '宠物信息缺失，无法上传头像', icon: 'none' })
        return
      }
      // 先展示本地预览，提升交互反馈速度
      setAvatarDraft(tempPath)

      setUploadingAvatar(true)
      try {
        const result = await uploadPetPhoto(petId, tempPath)
        if (result.success && result.data?.url) {
          // avatarService 已把相对路径补全为绝对地址
          updateField('avatarUrl', result.data.url)
          setAvatarUploadedUrl(result.data.url)
          Taro.showToast({ title: '头像已上传', icon: 'success' })
        } else {
          // 上传失败：保留原头像，不把临时路径写进档案
          Taro.showToast({ title: result.message || '头像上传失败', icon: 'none' })
        }
      } catch {
        Taro.showToast({ title: '头像上传失败，请重试', icon: 'none' })
      } finally {
        setUploadingAvatar(false)
        setAvatarDraft(null)
      }
    } catch (err) {
      console.warn('[EditPet] chooseImage failed:', err)
    }
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

  const handleSubmit = async () => {
    if (!validate()) return
    if (!petId) return

    setSubmitting(true)
    try {
      // 头像/照片字段只在"本次新上传了照片"时才提交；
      // formData.avatarUrl 可能回退自 avatarCartoonUrl（纯卡通宠物），
      // 直接提交会把卡通 URL 污染进 avatarPhotoUrl（数据语义错误，展示优先级也会错乱）
      const payload: Record<string, unknown> = {
        name: formData.name.trim(),
        species: formData.species as 'dog' | 'cat',
        breed: formData.breedName,
        breedId: formData.breedId,
        gender: formData.gender as 'male' | 'female',
        birthDate: formData.birthDate,
        weight: formData.weight ? parseFloat(formData.weight) : 0,
        coatColor: formData.coatColor.trim(),
        isNeutered: formData.isNeutered,
        microchipId: formData.microchipId.trim(),
        allergies: formData.allergies ? formData.allergies.split(/[,，]/).map(s => s.trim()).filter(Boolean) : [],
        medications: formData.medications ? formData.medications.split(/[,，]/).map(s => s.trim()).filter(Boolean) : [],
        chronicConditions: formData.chronicConditions ? formData.chronicConditions.split(/[,，]/).map(s => s.trim()).filter(Boolean) : [],
        notes: formData.notes.trim(),
        userId,
      }
      if (avatarUploadedUrl) {
        payload.avatarPhotoUrl = avatarUploadedUrl
        payload.photos = [avatarUploadedUrl]
      }
      await updatePet(petId, payload as Partial<PetProfile>)

      trackEvent('edit_pet_success', { petId })
      Taro.showToast({ title: '保存成功', icon: 'success' })
      setTimeout(() => {
        safeNavigateBack()
      }, 1500)
    } catch (err) {
      trackEvent('edit_pet_failure')
      const message = err instanceof Error ? err.message : '保存失败，请重试'
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
              <Icon name='dog' size={18} tone='primary' className='add-pet__species-icon' />
              <Text>狗狗</Text>
            </View>
            <View
              className={`add-pet__species-btn ${formData.species === 'cat' ? 'add-pet__species-btn--active' : ''}`}
              onClick={() => handleSpeciesChange('cat')}
            >
              <Icon name='cat' size={18} tone='primary' className='add-pet__species-icon' />
              <Text>猫猫</Text>
            </View>
          </View>
        </View>

        <View className='add-pet__form-item'>
          <Text className='add-pet__label add-pet__label--required'>品种</Text>
          <Picker
            mode='selector'
            range={breedOptions}
            rangeKey='label'
            value={selectedBreedIndex >= 0 ? selectedBreedIndex : 0}
            onChange={handleBreedChange as (e: unknown) => void}
            disabled={!formData.species}
          >
            <View className='add-pet__picker'>
              <Text className={formData.breedName ? '' : 'add-pet__picker-placeholder'}>
                {formData.breedName || '请选择品种'}
              </Text>
              <Text className='add-pet__picker-arrow'>▼</Text>
            </View>
          </Picker>
        </View>

        {selectedBreed && (selectedBreed.geneticDiseases.length > 0 || selectedBreed.dietRestrictions.length > 0) && (
          <View className='add-pet__breed-info'>
            {selectedBreed.geneticDiseases.length > 0 && (
              <View className='add-pet__breed-info-row'>
                <Text className='add-pet__breed-info-label'>遗传病易感</Text>
                <View className='add-pet__breed-info-tags'>
                  {selectedBreed.geneticDiseases.map((d) => (
                    <Text key={d} className='add-pet__breed-info-tag add-pet__breed-info-tag--warn'>⚠️{d}</Text>
                  ))}
                </View>
              </View>
            )}
            {selectedBreed.dietRestrictions.length > 0 && (
              <View className='add-pet__breed-info-row'>
                <Text className='add-pet__breed-info-label'>饮食禁忌</Text>
                <View className='add-pet__breed-info-tags'>
                  {selectedBreed.dietRestrictions.map((d) => (
                    <Text key={d} className='add-pet__breed-info-tag add-pet__breed-info-tag--danger'>🚫{d}</Text>
                  ))}
                </View>
              </View>
            )}
            <View className='add-pet__breed-info-row'>
              <Text className='add-pet__breed-info-label'>建议体重</Text>
              <Text className='add-pet__breed-info-value'>{selectedBreed.weightRange.min}-{selectedBreed.weightRange.max}kg</Text>
            </View>
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
          <View className='add-pet__photo-area' onClick={uploadingAvatar ? undefined : handleChooseAvatar}>
            {avatarDraft || formData.avatarUrl ? (
              <Image className='add-pet__photo-preview' src={avatarDraft || formData.avatarUrl} mode='aspectFill' lazyLoad />
            ) : (
              <View className='add-pet__photo-placeholder'>
                <Icon name='camera' size={18} tone='primary' className='add-pet__photo-icon' />
                <Text>{uploadingAvatar ? '上传中...' : '点击选择照片'}</Text>
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
          <Text>{submitting ? '保存中...' : '保存'}</Text>
        </View>
      </View>

    </View>
  )
}
