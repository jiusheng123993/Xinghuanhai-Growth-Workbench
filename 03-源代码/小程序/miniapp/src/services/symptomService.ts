/**
 * 症状查询服务
 *
 * 宠物症状分类浏览、搜索与 AI 辅助分析
 */
import { api } from './api'
import { getStorage, setStorage } from '../utils/storage'
import type { PetHealthEntry } from './checkinService'
import type { PetProfile } from './petService'
import type { PetFoodQuery } from '../memory-body/types/memoryBodyTypes'
// 主包体积优化：本服务仅用品种的常见病/遗传病/平均寿命字段做风险分析，
// 引用精简版 breedsLight 而非全量 breeds（148KB），避免品种全量数据被打进主包
import { BREED_LIGHT } from '../data/petKnowledge/breedsLight'
// 医学知识图谱：规则/疾病数据已外置，风险等级评估与置信度推导统一走图谱（见 设计方案-2026-08-22）
import { evaluateRiskLevel, enrichResultWithConfidence, getPossibleConditions } from '../data/petKnowledge/medicalGraph'
import type { Confidence, AnalysisConclusion } from '../data/petKnowledge/medicalGraph'
import { localDateString } from '../utils/date'

/**
 * 记录所属的「本地日历日」（YYYY-MM-DD）
 *
 * 2026-09-11 全站口径收口：原实现用 toISOString().slice(0,10) / slice(0,10) 取的是 **UTC 日期** ——
 * 东八区 00:00-08:00 的记录会被算成前一天，于是「打卡天数 / 连续天数 / 去重天数」
 * 在早上齐齐差一天，并与已改用本地日的 checkinService、reportService 口径不一致。
 */
function entryDateStr(entry: PetHealthEntry): string {
  return localDateString(entry.createdAt) ?? ''
}

export interface HistoricalMemoryInsight {
  type: 'similar_past_event' | 'seasonal_pattern' | 'recovery_reference'
  icon: string
  title: string
  message: string
  pastDate: string
  recoveryDays?: number
}

export interface PersonalizedInsight {
  type: 'consecutive_anomaly' | 'food_query_warning' | 'breed_disease_risk' | 'similar_past_event' | 'seasonal_pattern' | 'recovery_reference' | 'allergy_warning' | 'medication_side_effect' | 'chronic_condition_alert' | 'breed_age_risk' | 'weight_trend' | 'vaccine_status' | 'medication_history'
  icon: string
  message: string
  title?: string
  pastDate?: string
  recoveryDays?: number
}

export interface SymptomCheckResult {
  id: string
  petId: string
  symptoms: string[]
  additionalInfo?: {
    duration?: string
    frequency?: string
    severity?: string
    appetite?: string
    energy?: string
    otherNotes?: string
  }
  riskLevel: 'normal' | 'caution' | 'warning' | 'emergency'
  possibleConditions: string[]
  aiAdvice: string
  recommendedActions: string[]
  personalizedInsights?: PersonalizedInsight[]
  /** 整体置信度（Phase 1：代码按依据推导，历史记录可能缺失该字段） */
  confidence?: Confidence
  /** 分析结论列表（每条带依据类型与置信度；历史记录可能缺失） */
  conclusions?: AnalysisConclusion[]
  createdAt: string
}

export interface SymptomCategory {
  id: string
  name: string
  icon: string
  symptoms: SymptomItem[]
}

export interface SymptomItem {
  id: string
  name: string
  description: string
  species: ('cat' | 'dog')[]
}

const BUILTIN_CATEGORIES: SymptomCategory[] = [
  {
    id: 'digestive',
    name: '消化系统',
    icon: 'digestive',
    symptoms: [
      { id: 'vomiting', name: '呕吐', description: '宠物出现呕吐现象', species: ['cat', 'dog'] },
      { id: 'diarrhea', name: '腹泻', description: '大便稀溏或水样', species: ['cat', 'dog'] },
      { id: 'constipation', name: '便秘', description: '排便困难或排便次数减少', species: ['cat', 'dog'] },
      { id: 'appetite_loss', name: '食欲不振', description: '对食物缺乏兴趣', species: ['cat', 'dog'] },
      { id: 'drooling', name: '流口水', description: '口腔分泌物增多', species: ['cat', 'dog'] },
      { id: 'dysphagia', name: '吞咽困难', description: '进食或饮水时吞咽费力', species: ['cat', 'dog'] },
    ],
  },
  {
    id: 'respiratory',
    name: '呼吸系统',
    icon: 'respiratory',
    symptoms: [
      { id: 'cough', name: '咳嗽', description: '阵发性或持续性咳嗽', species: ['cat', 'dog'] },
      { id: 'sneeze', name: '打喷嚏', description: '频繁打喷嚏', species: ['cat', 'dog'] },
      { id: 'runny_nose', name: '流鼻涕', description: '鼻腔分泌物增多', species: ['cat', 'dog'] },
      { id: 'dyspnea', name: '呼吸困难', description: '呼吸急促或费力', species: ['cat', 'dog'] },
      { id: 'wheezing', name: '喘息', description: '呼吸时有喘息声', species: ['cat', 'dog'] },
    ],
  },
  {
    id: 'skin',
    name: '皮肤系统',
    icon: 'skin',
    symptoms: [
      { id: 'itching', name: '瘙痒', description: '频繁抓挠身体', species: ['cat', 'dog'] },
      { id: 'hair_loss', name: '脱毛', description: '异常掉毛或斑秃', species: ['cat', 'dog'] },
      { id: 'rash', name: '红疹', description: '皮肤出现红色斑点或斑块', species: ['cat', 'dog'] },
      { id: 'dander', name: '皮屑', description: '皮肤表面出现大量皮屑', species: ['cat', 'dog'] },
      { id: 'lump', name: '肿块', description: '身体出现异常肿块', species: ['cat', 'dog'] },
      { id: 'wound', name: '伤口', description: '皮肤破损或有伤口', species: ['cat', 'dog'] },
    ],
  },
  {
    id: 'urinary',
    name: '泌尿系统',
    icon: 'urinary',
    symptoms: [
      { id: 'frequent_urination', name: '尿频', description: '排尿次数明显增多', species: ['cat', 'dog'] },
      { id: 'hematuria', name: '尿血', description: '尿液中有血液', species: ['cat', 'dog'] },
      { id: 'dysuria', name: '排尿困难', description: '排尿费力或疼痛', species: ['cat', 'dog'] },
      { id: 'incontinence', name: '尿失禁', description: '无法控制排尿', species: ['cat', 'dog'] },
    ],
  },
  {
    id: 'nervous',
    name: '神经系统',
    icon: 'nervous',
    symptoms: [
      { id: 'seizure', name: '抽搐', description: '身体不自主抽动或痉挛', species: ['cat', 'dog'] },
      { id: 'head_tilt', name: '歪头', description: '头部持续偏向一侧', species: ['cat', 'dog'] },
      { id: 'ataxia', name: '走路不稳', description: '行走时摇晃或失去平衡', species: ['cat', 'dog'] },
      { id: 'nystagmus', name: '眼球震颤', description: '眼球不自主快速运动', species: ['cat', 'dog'] },
    ],
  },
  {
    id: 'behavior',
    name: '行为异常',
    icon: 'behavior',
    symptoms: [
      { id: 'lethargy', name: '嗜睡', description: '精神萎靡、活动减少', species: ['cat', 'dog'] },
      { id: 'anxiety', name: '焦躁', description: '表现出不安或烦躁', species: ['cat', 'dog'] },
      { id: 'aggression', name: '攻击性', description: '出现异常攻击行为', species: ['cat', 'dog'] },
      { id: 'hiding', name: '躲藏', description: '频繁躲藏不愿出来', species: ['cat', 'dog'] },
      { id: 'excessive_licking', name: '过度舔舐', description: '反复舔舐身体某部位', species: ['cat', 'dog'] },
    ],
  },
  {
    id: 'eye_ear_mouth',
    name: '眼耳口鼻',
    icon: 'eye_ear_mouth',
    symptoms: [
      { id: 'eye_discharge', name: '眼屎增多', description: '眼睛分泌物异常增多', species: ['cat', 'dog'] },
      { id: 'tearing', name: '流泪', description: '眼睛流泪增多', species: ['cat', 'dog'] },
      { id: 'ear_odor', name: '耳臭', description: '耳朵有异味', species: ['cat', 'dog'] },
      { id: 'bad_breath', name: '口臭', description: '口腔有异味', species: ['cat', 'dog'] },
      { id: 'gum_swelling', name: '牙龈红肿', description: '牙龈发红肿胀', species: ['cat', 'dog'] },
    ],
  },
]

// ===== 规则引擎数据已外置到医学知识图谱（data/petKnowledge/medicalGraph.ts） =====
// 原 EMERGENCY_SYMPTOMS / WARNING_SYMPTOM_COMBOS / CAUTION_SYMPTOMS / CONDITION_MAP
// 已迁移为 MEDICAL_GRAPH.riskRules / diseases（带来源与审核状态），本文件不再重复维护。
// 评估入口统一走 evaluateRiskLevel，行为与原实现完全一致（纯重构）。

const SYMPTOM_DISEASE_ASSOCIATION: Record<string, string[]> = {
  vomiting: ['肠胃', '肾', '肝'],
  diarrhea: ['肠胃', '吸收不良'],
  appetite_loss: ['肾', '肝', '肠胃', '牙'],
  cough: ['心脏', '气管', '呼吸道', '瓣', '血管'],
  dyspnea: ['心脏', '气管', '呼吸道', '肺', '瓣', '血管'],
  wheezing: ['哮喘', '气管'],
  itching: ['皮肤', '过敏', '异位性'],
  hair_loss: ['皮肤', '内分泌', '甲状腺'],
  rash: ['皮肤', '过敏', '异位性'],
  frequent_urination: ['肾', '糖尿病', '尿路'],
  hematuria: ['肾', '膀胱', '尿路'],
  dysuria: ['尿路', '膀胱', '结石'],
  seizure: ['癫痫', '神经'],
  head_tilt: ['前庭', '中耳', '神经'],
  ataxia: ['神经', '前庭'],
  lethargy: ['心脏', '肾', '肝', '内分泌', '瓣', '血管'],
  excessive_licking: ['皮肤', '过敏', '焦虑'],
  eye_discharge: ['眼', '结膜'],
  tearing: ['眼', '结膜', '泪管'],
  ear_odor: ['耳', '外耳'],
  bad_breath: ['牙', '口腔', '肾'],
  gum_swelling: ['牙', '口腔', '牙周'],
}

const ALLERGY_SYMPTOM_ASSOCIATION: Record<string, string[]> = {
  skin: ['itching', 'rash', 'hair_loss', 'excessive_licking', 'dander'],
  food: ['vomiting', 'diarrhea', 'appetite_loss', 'itching', 'rash'],
  environmental: ['itching', 'sneeze', 'runny_nose', 'wheezing', 'tearing'],
  drug: ['vomiting', 'diarrhea', 'lethargy', 'rash', 'itching'],
}

const ALLERGY_CATEGORY_ALIASES: Record<string, string[]> = {
  skin: ['皮肤', '皮屑', '接触性'],
  food: ['食物', '饮食', '食入'],
  environmental: ['环境', '花粉', '尘螨', '季节性'],
  drug: ['药物', '药'],
}

const MEDICATION_SIDE_EFFECT_MAP: Record<string, string[]> = {
  '抗生素': ['vomiting', 'diarrhea', 'appetite_loss', 'lethargy'],
  '抗炎药': ['vomiting', 'diarrhea', 'appetite_loss', 'lethargy'],
  '类固醇': ['appetite_loss', 'lethargy', 'excessive_licking', 'frequent_urination'],
  '驱虫': ['vomiting', 'diarrhea', 'lethargy', 'appetite_loss'],
  '止痛': ['vomiting', 'lethargy', 'appetite_loss', 'constipation'],
  '心脏': ['lethargy', 'appetite_loss', 'cough', 'dyspnea'],
  '胰岛素': ['lethargy', 'ataxia', 'seizure'],
  '甲状腺': ['appetite_loss', 'lethargy', 'hair_loss', 'frequent_urination'],
}

function getStorageKey(petId: string): string {
  return `symptom_checks_${petId}`
}

function generateId(): string {
  return `sym_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
}

function getLocalResults(petId: string): SymptomCheckResult[] {
  return getStorage<SymptomCheckResult[]>(getStorageKey(petId)) || []
}

function saveLocalResults(petId: string, results: SymptomCheckResult[]): void {
  setStorage(getStorageKey(petId), results)
}

function calculateRiskLevel(
  symptomIds: string[],
  additionalInfo?: SymptomCheckResult['additionalInfo']
): SymptomCheckResult['riskLevel'] {
  // 规则引擎已外置到医学知识图谱：evaluateRiskLevel 与原逻辑逐条等价（紧急 > 组合 > 条件 > 关注 > 正常）
  return evaluateRiskLevel(symptomIds, additionalInfo)
}

function generateAiAdvice(
  symptomIds: string[],
  riskLevel: SymptomCheckResult['riskLevel'],
  additionalInfo?: SymptomCheckResult['additionalInfo']
): string {
  const symptomNames = symptomIds
    .map((id) => {
      for (const cat of BUILTIN_CATEGORIES) {
        const found = cat.symptoms.find((s) => s.id === id)
        if (found) return found.name
      }
      return id
    })
    .filter(Boolean)

  const symptomText = symptomNames.length > 0 ? `检测到以下症状：${symptomNames.join('、')}。` : ''

  switch (riskLevel) {
    case 'emergency':
      return `🚨 紧急！${symptomText}这些症状可能表明严重健康问题，请立即带宠物前往最近的宠物医院就诊。途中保持宠物安静，避免剧烈晃动。`
    case 'warning':
      return `⚠️ 需要关注！${symptomText}建议在24小时内带宠物就医检查。期间密切观察症状变化，如出现恶化请立即就医。`
    case 'caution':
      return `💡 注意观察。${symptomText}建议持续观察宠物状态，如症状持续超过24小时或出现新的异常，请及时就医。`
    case 'normal':
      return `✅ 目前未检测到明显异常症状。${additionalInfo?.otherNotes ? '已记录您的补充信息。' : ''}请继续保持良好的日常护理，定期体检。`
  }
}

function generatePossibleConditions(symptomIds: string[]): string[] {
  // 委托图谱模块：保持原"症状→疾病"顺序（审查项：避免按全局疾病实体序打乱 top-5）
  return getPossibleConditions(symptomIds)
}

function generateRecommendedActions(riskLevel: SymptomCheckResult['riskLevel']): string[] {
  switch (riskLevel) {
    case 'emergency':
      return [
        '立即前往最近的24小时宠物医院',
        '途中保持宠物安静平躺',
        '准备好宠物病历和基本信息',
        '如呼吸困难，保持通风',
      ]
    case 'warning':
      return [
        '预约24小时内的兽医门诊',
        '记录症状出现的时间和频率',
        '暂时禁食观察（如涉及消化症状）',
        '准备宠物近期饮食和活动记录',
      ]
    case 'caution':
      return [
        '持续观察宠物状态24小时',
        '记录症状变化情况',
        '保持正常饮食和饮水',
        '如症状加重请及时就医',
      ]
    case 'normal':
      return [
        '保持日常护理习惯',
        '定期进行健康检查',
        '注意饮食均衡和适量运动',
        '关注宠物日常行为变化',
      ]
  }
}

export function getSymptomCategories(species?: 'cat' | 'dog'): SymptomCategory[] {
  if (!species) {
    return BUILTIN_CATEGORIES
  }
  return BUILTIN_CATEGORIES.map((cat) => ({
    ...cat,
    symptoms: cat.symptoms.filter((s) => s.species.includes(species)),
  })).filter((cat) => cat.symptoms.length > 0)
}

export function getSymptomsByCategory(categoryId: string): SymptomItem[] {
  const category = BUILTIN_CATEGORIES.find((c) => c.id === categoryId)
  return category ? category.symptoms : []
}

export function searchSymptoms(keyword: string, species?: 'cat' | 'dog'): SymptomItem[] {
  const lowerKeyword = keyword.toLowerCase()
  const results: SymptomItem[] = []

  for (const cat of BUILTIN_CATEGORIES) {
    for (const symptom of cat.symptoms) {
      const nameMatch = symptom.name.includes(keyword)
      const descMatch = symptom.description.includes(keyword)
      const idMatch = symptom.id.toLowerCase().includes(lowerKeyword)

      if (nameMatch || descMatch || idMatch) {
        if (!species || symptom.species.includes(species)) {
          if (!results.find((r) => r.id === symptom.id)) {
            results.push(symptom)
          }
        }
      }
    }
  }

  return results
}

function getRecentCheckins(petId: string, days: number = 7): PetHealthEntry[] {
  const key = `xhh_checkins_${petId}`
  const all = getStorage<PetHealthEntry[]>(key.replace('xhh_', '')) || []
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - days)
  const cutoffStr = cutoff.toISOString().slice(0, 10)
  return all.filter((e) => entryDateStr(e) >= cutoffStr)
}

function applyPersonalizedAdjustments(
  riskLevel: SymptomCheckResult['riskLevel'],
  symptomIds: string[],
  petProfile?: PetProfile,
  recentCheckins?: PetHealthEntry[]
): SymptomCheckResult['riskLevel'] {
  if (!petProfile && (!recentCheckins || recentCheckins.length === 0)) {
    return riskLevel
  }

  let adjusted = riskLevel

  if (recentCheckins && recentCheckins.length > 0) {
    const abnormalCount = recentCheckins.filter(
      (e) => e.riskLevel === 'high' || e.riskLevel === 'emergency'
    ).length
    const vomitingDays = recentCheckins.filter((e) => e.anomalyItems.includes('other')).length
    const appetiteDownDays = recentCheckins.filter(
      (e) => e.appetiteLevel <= 2
    ).length
    const stoolAbnormalDays = recentCheckins.filter(
      (e) => e.poopLevel <= 2 || e.poopLevel >= 4
    ).length

    if (abnormalCount >= 3 && adjusted === 'caution') {
      adjusted = 'warning'
    }

    if (vomitingDays >= 2 && symptomIds.includes('vomiting') && adjusted === 'caution') {
      adjusted = 'warning'
    }

    if (appetiteDownDays >= 3 && symptomIds.includes('appetite_loss') && adjusted === 'caution') {
      adjusted = 'warning'
    }

    if (stoolAbnormalDays >= 3 && (symptomIds.includes('diarrhea') || symptomIds.includes('constipation')) && adjusted === 'caution') {
      adjusted = 'warning'
    }
  }

  if (petProfile) {
    const birth = new Date(petProfile.birthDate + 'T00:00:00.000Z')
    const now = new Date()
    const ageInMonths =
      (now.getUTCFullYear() - birth.getUTCFullYear()) * 12 +
      (now.getUTCMonth() - birth.getUTCMonth())

    if (ageInMonths < 6 && adjusted === 'caution') {
      adjusted = 'warning'
    }

    if (ageInMonths >= 120 && adjusted === 'caution') {
      adjusted = 'warning'
    }
  }

  return adjusted
}

function generatePersonalizedAdvice(
  baseAdvice: string,
  petProfile?: PetProfile,
  recentCheckins?: PetHealthEntry[],
  symptomIds?: string[]
): string {
  const extras: string[] = []

  if (petProfile) {
    const birth = new Date(petProfile.birthDate + 'T00:00:00.000Z')
    const now = new Date()
    const ageInMonths =
      (now.getUTCFullYear() - birth.getUTCFullYear()) * 12 +
      (now.getUTCMonth() - birth.getUTCMonth())

    if (ageInMonths < 6) {
      extras.push(`${petProfile.name}还是幼年（约${ageInMonths}个月），幼年宠物免疫力较低，建议格外注意。`)
    } else if (ageInMonths >= 120) {
      extras.push(`${petProfile.name}已是老年宠物（约${Math.floor(ageInMonths / 12)}岁），老年宠物恢复能力较弱，建议及时就医。`)
    }

    if (petProfile.species === 'cat') {
      extras.push('猫咪善于隐藏不适，表面症状可能比实际病情轻，请密切观察。')
    }

    if (symptomIds && symptomIds.length > 0) {
      const skinDigestiveSymptoms = ['itching', 'rash', 'hair_loss', 'excessive_licking', 'dander', 'vomiting', 'diarrhea']
      if (petProfile.allergies && petProfile.allergies.length > 0 && symptomIds.some((s) => skinDigestiveSymptoms.includes(s))) {
        extras.push(`${petProfile.name}有过敏记录，当前出现的皮肤或消化症状可能与过敏有关，建议排查近期是否接触过敏原。`)
      }

      if (petProfile.chronicConditions && petProfile.chronicConditions.length > 0) {
        const hasRelatedSymptom = symptomIds.some((symptomId) => {
          const keywords = SYMPTOM_DISEASE_ASSOCIATION[symptomId]
          return keywords && petProfile.chronicConditions!.some((c) => keywords.some((kw) => c.includes(kw)))
        })
        if (hasRelatedSymptom) {
          extras.push(`${petProfile.name}有慢性病史，当前症状可能与慢性病波动有关，建议关注是否加重。`)
        }
      }

      if (petProfile.medications && petProfile.medications.length > 0) {
        const hasMedicationSideEffect = petProfile.medications.some((med) => {
          for (const [keyword, sideEffects] of Object.entries(MEDICATION_SIDE_EFFECT_MAP)) {
            if (med.includes(keyword) && symptomIds.some((s) => sideEffects.includes(s))) {
              return true
            }
          }
          return false
        })
        if (hasMedicationSideEffect) {
          extras.push(`${petProfile.name}正在用药，当前症状可能是药物副作用，建议咨询兽医是否需要调整。`)
        }
      }
    }
  }

  if (recentCheckins && recentCheckins.length > 0) {
    const abnormalDays = recentCheckins.filter(
      (e) => e.riskLevel !== 'low'
    ).length
    if (abnormalDays >= 3) {
      extras.push(`近${recentCheckins.length}天打卡中有${abnormalDays}天异常，建议尽快就医排查。`)
    }
  }

  if (extras.length === 0) {
    return baseAdvice
  }

  return `${baseAdvice}\n\n📋 个性化提示：${extras.join('')}`
}

function getRecentFoodQueries(petId: string, days: number = 7): PetFoodQuery[] {
  const all: PetFoodQuery[] = getStorage(`food_queries_${petId}`) || []
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000
  return all.filter((q) => {
    const ts = q.createdAt instanceof Date ? q.createdAt.getTime() : new Date(q.createdAt).getTime()
    return ts >= cutoff
  })
}

function findBreedDiseases(breed: string, species: 'dog' | 'cat'): string[] {
  if (!breed) return []
  const matched = BREED_LIGHT.find(
    (b) => b.species === species && (b.name === breed || b.aliases.includes(breed) || b.id === breed)
  )
  return matched ? matched.commonDiseases.slice(0, 3) : []
}

function findGeneticDiseaseInsights(
  petProfile: PetProfile,
  symptomIds: string[]
): PersonalizedInsight[] {
  if (!petProfile.breed) return []

  const matched = BREED_LIGHT.find(
    (b) => b.species === petProfile.species && (b.name === petProfile.breed || b.aliases.includes(petProfile.breed) || b.id === petProfile.breed)
  )
  if (!matched || matched.geneticDiseases.length === 0) return []

  const insights: PersonalizedInsight[] = []
  const relatedDiseases: string[] = []

  for (const disease of matched.geneticDiseases) {
    for (const symptomId of symptomIds) {
      const keywords = SYMPTOM_DISEASE_ASSOCIATION[symptomId]
      if (keywords && keywords.some((kw) => disease.includes(kw))) {
        relatedDiseases.push(disease)
        break
      }
    }
  }

  if (relatedDiseases.length > 0) {
    const uniqueDiseases = [...new Set(relatedDiseases)].slice(0, 3)
    insights.push({
      type: 'breed_disease_risk',
      icon: '🧬',
      title: '品种遗传疾病关联',
      message: `${petProfile.name}（${petProfile.breed}）的遗传疾病中，${uniqueDiseases.join('、')}与当前症状可能相关，建议重点排查`,
    })
  }

  return insights
}

function findAllergyInsights(
  petProfile: PetProfile,
  symptomIds: string[]
): PersonalizedInsight[] {
  if (!petProfile.allergies || petProfile.allergies.length === 0) return []

  const insights: PersonalizedInsight[] = []
  const matchedAllergies: string[] = []

  for (const allergy of petProfile.allergies) {
    for (const [category, associatedSymptoms] of Object.entries(ALLERGY_SYMPTOM_ASSOCIATION)) {
      const aliases = ALLERGY_CATEGORY_ALIASES[category] || []
      const isMatch = allergy.toLowerCase().includes(category) ||
        category.includes(allergy.toLowerCase()) ||
        aliases.some((alias) => allergy.includes(alias))
      if (isMatch) {
        const overlap = symptomIds.filter((s) => associatedSymptoms.includes(s))
        if (overlap.length > 0) {
          matchedAllergies.push(allergy)
          break
        }
      }
    }
  }

  if (matchedAllergies.length > 0) {
    insights.push({
      type: 'allergy_warning',
      icon: '⚠️',
      title: '过敏关联提示',
      message: `${petProfile.name}有过敏记录（${matchedAllergies.join('、')}），当前症状可能与过敏反应有关，建议观察是否接触了过敏原`,
    })
  }

  return insights
}

function findMedicationInsights(
  petProfile: PetProfile,
  symptomIds: string[]
): PersonalizedInsight[] {
  if (!petProfile.medications || petProfile.medications.length === 0) return []

  const insights: PersonalizedInsight[] = []
  const matchedMedications: string[] = []

  for (const medication of petProfile.medications) {
    for (const [keyword, sideEffects] of Object.entries(MEDICATION_SIDE_EFFECT_MAP)) {
      if (medication.includes(keyword)) {
        const overlap = symptomIds.filter((s) => sideEffects.includes(s))
        if (overlap.length > 0) {
          matchedMedications.push(medication)
          break
        }
      }
    }
  }

  if (matchedMedications.length > 0) {
    insights.push({
      type: 'medication_side_effect',
      icon: '💊',
      title: '药物副作用提示',
      message: `${petProfile.name}正在使用${matchedMedications.join('、')}，当前症状可能是药物副作用，建议咨询兽医是否需要调整用药`,
    })
  }

  return insights
}

function findChronicConditionInsights(
  petProfile: PetProfile,
  symptomIds: string[]
): PersonalizedInsight[] {
  if (!petProfile.chronicConditions || petProfile.chronicConditions.length === 0) return []

  const insights: PersonalizedInsight[] = []
  const matchedConditions: string[] = []

  for (const condition of petProfile.chronicConditions) {
    for (const symptomId of symptomIds) {
      const keywords = SYMPTOM_DISEASE_ASSOCIATION[symptomId]
      if (keywords && keywords.some((kw) => condition.includes(kw))) {
        matchedConditions.push(condition)
        break
      }
    }
  }

  if (matchedConditions.length > 0) {
    const uniqueConditions = [...new Set(matchedConditions)]
    insights.push({
      type: 'chronic_condition_alert',
      icon: '📋',
      title: '慢性病关联提示',
      message: `${petProfile.name}的慢性病（${uniqueConditions.join('、')}）与当前症状相关，可能是慢性病加重或波动，建议尽快复查`,
    })
  }

  return insights
}

const SYMPTOM_TO_CHECKIN_MAP: Record<string, (entry: PetHealthEntry) => boolean> = {
  vomiting: (e) => e.appetiteLevel === 6,
  appetite_loss: (e) => e.appetiteLevel <= 2,
  diarrhea: (e) => e.poopLevel <= 2,
  constipation: (e) => e.poopLevel >= 4,
  lethargy: (e) => e.spiritLevel <= 2,
}

interface HistoricalEvent {
  symptomId: string
  startDate: string
  endDate: string
  recoveryDays: number
  source: 'checkin' | 'symptom_check'
  relatedSymptoms?: string[]
  riskLevel?: string
}

function getCheckinsForDays(petId: string, days: number): PetHealthEntry[] {
  const key = `xhh_checkins_${petId}`
  const all = getStorage<PetHealthEntry[]>(key.replace('xhh_', '')) || []
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - days)
  const cutoffStr = cutoff.toISOString().slice(0, 10)
  return all.filter((e) => entryDateStr(e) >= cutoffStr)
}

function calculateRecoveryDays(
  entries: PetHealthEntry[],
  matchFn: (entry: PetHealthEntry) => boolean,
  anomalyStartDate: string
): number {
  const sorted = entries
    .filter((e) => entryDateStr(e) >= anomalyStartDate)
    .sort((a, b) => entryDateStr(a).localeCompare(entryDateStr(b)))

  let consecutiveNormal = 0
  let lastAnomalyDate = anomalyStartDate

  for (const entry of sorted) {
    const dateStr = entryDateStr(entry)
    if (dateStr < anomalyStartDate) continue

    if (matchFn(entry)) {
      consecutiveNormal = 0
      lastAnomalyDate = dateStr
    } else {
      consecutiveNormal++
      if (consecutiveNormal >= 2) {
        const start = new Date(anomalyStartDate + 'T00:00:00.000Z')
        const end = new Date(lastAnomalyDate + 'T00:00:00.000Z')
        const diffDays = Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1
        return Math.max(diffDays, 1)
      }
    }
  }

  const start = new Date(anomalyStartDate + 'T00:00:00.000Z')
  const now = new Date()
  return Math.round((now.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1
}

function findHistoricalSimilarEvents(
  petId: string,
  currentSymptomIds: string[],
  _petProfile?: PetProfile // 暂未使用（后续记忆引擎接入后用于过滤），保留签名
): HistoricalEvent[] {
  const events: HistoricalEvent[] = []
  const now = new Date()

  const checkins30 = getCheckinsForDays(petId, 30)
  const checkins365 = getCheckinsForDays(petId, 365)
  const symptomChecks: SymptomCheckResult[] = getStorage<SymptomCheckResult[]>(`symptom_checks_${petId}`) || []

  for (const symptomId of currentSymptomIds) {
    const matchFn = SYMPTOM_TO_CHECKIN_MAP[symptomId]
    if (matchFn) {
      const anomalyEntries = checkins30
        .filter(matchFn)
        .sort((a, b) => entryDateStr(a).localeCompare(entryDateStr(b)))

      if (anomalyEntries.length > 0) {
        let groupStart = entryDateStr(anomalyEntries[0])
        let groupEnd = entryDateStr(anomalyEntries[0])
        const groupEntries: PetHealthEntry[] = [anomalyEntries[0]]

        for (let i = 1; i < anomalyEntries.length; i++) {
          const currentDate = entryDateStr(anomalyEntries[i])
          const prevDate = new Date(groupEnd + 'T00:00:00.000Z')
          const currDate = new Date(currentDate + 'T00:00:00.000Z')
          const gapDays = Math.round((currDate.getTime() - prevDate.getTime()) / (1000 * 60 * 60 * 24))

          if (gapDays <= 2) {
            groupEnd = currentDate
            groupEntries.push(anomalyEntries[i])
          } else {
            const recoveryDays = calculateRecoveryDays(checkins30, matchFn, groupStart)
            events.push({
              symptomId,
              startDate: groupStart,
              endDate: groupEnd,
              recoveryDays,
              source: 'checkin',
            })
            groupStart = currentDate
            groupEnd = currentDate
            groupEntries.length = 0
            groupEntries.push(anomalyEntries[i])
          }
        }

        const recoveryDays = calculateRecoveryDays(checkins30, matchFn, groupStart)
        events.push({
          symptomId,
          startDate: groupStart,
          endDate: groupEnd,
          recoveryDays,
          source: 'checkin',
        })
      }

      const seasonalEntries = checkins365.filter(matchFn)
      const currentMonth = now.getMonth()
      const sameMonthLastYear = seasonalEntries.filter((e) => {
        const entryDate = new Date(entryDateStr(e) + 'T00:00:00.000Z')
        return entryDate.getMonth() === currentMonth &&
          entryDate.getFullYear() === now.getFullYear() - 1
      })

      if (sameMonthLastYear.length >= 2) {
        const dates = sameMonthLastYear.map((e) => entryDateStr(e)).sort()
        events.push({
          symptomId,
          startDate: dates[0],
          endDate: dates[dates.length - 1],
          recoveryDays: 0,
          source: 'checkin',
        })
      }
    }

    const matchingChecks = symptomChecks.filter((check) =>
      check.symptoms.includes(symptomId) &&
      new Date(check.createdAt) < now
    )

    for (const check of matchingChecks) {
      const checkDate = new Date(check.createdAt)
      const daysSinceCheck = Math.round((now.getTime() - checkDate.getTime()) / (1000 * 60 * 60 * 24))

      if (daysSinceCheck <= 365) {
        events.push({
          symptomId,
          startDate: check.createdAt.slice(0, 10),
          endDate: check.createdAt.slice(0, 10),
          recoveryDays: 0,
          source: 'symptom_check',
          relatedSymptoms: check.symptoms,
          riskLevel: check.riskLevel,
        })
      }
    }
  }

  const seen = new Set<string>()
  return events.filter((e) => {
    const key = `${e.symptomId}_${e.startDate}_${e.source}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

const SEASON_NAMES: Record<number, string> = {
  0: '冬天', 1: '冬天', 2: '春天',
  3: '春天', 4: '春天', 5: '夏天',
  6: '夏天', 7: '夏天', 8: '秋天',
  9: '秋天', 10: '秋天', 11: '冬天',
}

function getSymptomName(symptomId: string): string {
  for (const cat of BUILTIN_CATEGORIES) {
    const found = cat.symptoms.find((s) => s.id === symptomId)
    if (found) return found.name
  }
  return symptomId
}

function generateHistoricalMemoryInsights(
  petId: string,
  currentSymptomIds: string[],
  petProfile?: PetProfile
): PersonalizedInsight[] {
  const events = findHistoricalSimilarEvents(petId, currentSymptomIds, petProfile)
  const insights: PersonalizedInsight[] = []
  const petName = petProfile?.name || '宠物'
  const now = new Date()

  const pastEvents = events.filter((e) => {
    const eventDate = new Date(e.startDate + 'T00:00:00.000Z')
    const daysDiff = Math.round((now.getTime() - eventDate.getTime()) / (1000 * 60 * 60 * 24))
    return daysDiff > 3 && e.source === 'checkin'
  })

  if (pastEvents.length > 0) {
    const latestPast = pastEvents.sort((a, b) => b.startDate.localeCompare(a.startDate))[0]
    const symptomName = getSymptomName(latestPast.symptomId)
    const eventDate = new Date(latestPast.startDate + 'T00:00:00.000Z')
    const monthDay = `${eventDate.getMonth() + 1}月${eventDate.getDate()}日`

    if (latestPast.recoveryDays > 0) {
      insights.push({
        type: 'similar_past_event',
        icon: '💭',
        title: '历史相似症状',
        message: `${petName}上次出现${symptomName}是在${monthDay}，${latestPast.recoveryDays}天后恢复了`,
        pastDate: latestPast.startDate,
        recoveryDays: latestPast.recoveryDays,
      })

      if (latestPast.recoveryDays <= 3) {
        insights.push({
          type: 'recovery_reference',
          icon: '💡',
          title: '恢复参考',
          message: `上次类似情况，${latestPast.recoveryDays}天就好了。如果这次原因相同，可能也会很快恢复`,
          pastDate: latestPast.startDate,
          recoveryDays: latestPast.recoveryDays,
        })
      }
    } else {
      insights.push({
        type: 'similar_past_event',
        icon: '💭',
        title: '历史相似症状',
        message: `${petName}在${monthDay}也出现过${symptomName}`,
        pastDate: latestPast.startDate,
      })
    }
  }

  const currentMonth = now.getMonth()
  const seasonalEvents = events.filter((e) => {
    const eventDate = new Date(e.startDate + 'T00:00:00.000Z')
    return eventDate.getMonth() === currentMonth &&
      eventDate.getFullYear() === now.getFullYear() - 1
  })

  if (seasonalEvents.length > 0) {
    const symptomIds = [...new Set(seasonalEvents.map((e) => e.symptomId))]
    const symptomNames = symptomIds.map(getSymptomName).join('、')
    const seasonName = SEASON_NAMES[currentMonth] || ''

    insights.push({
      type: 'seasonal_pattern',
      icon: '🔄',
      title: '季节性规律',
      message: `去年${seasonName}（这个时期）${petName}也出现过${symptomNames}，可能是季节性问题`,
      pastDate: seasonalEvents[0].startDate,
    })
  }

  const pastSymptomChecks = events.filter((e) => e.source === 'symptom_check')
  if (pastSymptomChecks.length > 0) {
    const latestCheck = pastSymptomChecks.sort((a, b) => b.startDate.localeCompare(a.startDate))[0]
    const symptomName = getSymptomName(latestCheck.symptomId)
    const checkDate = new Date(latestCheck.startDate + 'T00:00:00.000Z')
    const monthDay = `${checkDate.getMonth() + 1}月${checkDate.getDate()}日`

    if (latestCheck.relatedSymptoms && latestCheck.relatedSymptoms.length > 1) {
      const otherSymptoms = latestCheck.relatedSymptoms
        .filter((s) => s !== latestCheck.symptomId && !currentSymptomIds.includes(s))
        .map(getSymptomName)

      if (otherSymptoms.length > 0) {
        insights.push({
          type: 'similar_past_event',
          icon: '💭',
          title: '历史相似症状',
          message: `${petName}在${monthDay}检查${symptomName}时，还伴随${otherSymptoms.join('、')}，请留意是否也有类似表现`,
          pastDate: latestCheck.startDate,
        })
      }
    }

    if (latestCheck.riskLevel === 'warning' || latestCheck.riskLevel === 'emergency') {
      const checkDate2 = new Date(latestCheck.startDate + 'T00:00:00.000Z')
      const monthDay2 = `${checkDate2.getMonth() + 1}月${checkDate2.getDate()}日`
      const existingSimilar = insights.find(
        (i) => i.type === 'similar_past_event' && i.pastDate === latestCheck.startDate
      )
      if (!existingSimilar) {
        insights.push({
          type: 'similar_past_event',
          icon: '💭',
          title: '历史相似症状',
          message: `${petName}在${monthDay2}也检查过${symptomName}，当时评估为${latestCheck.riskLevel === 'emergency' ? '紧急' : '需关注'}级别`,
          pastDate: latestCheck.startDate,
        })
      }
    }
  }

  return insights.slice(0, 4)
}

function generatePersonalizedInsights(
  petProfile?: PetProfile,
  recentCheckins?: PetHealthEntry[],
  recentFoodQueries?: PetFoodQuery[],
  symptomIds?: string[]
): PersonalizedInsight[] {
  const insights: PersonalizedInsight[] = []

  if (recentCheckins && recentCheckins.length > 0) {
    const sorted = [...recentCheckins].sort((a, b) => {
      const aStr = entryDateStr(a)
      const bStr = entryDateStr(b)
      return bStr.localeCompare(aStr)
    })
    const seenDates = new Set<string>()
    let consecutiveAnomaly = 0
    for (const entry of sorted) {
      const dateStr = entryDateStr(entry)
      if (seenDates.has(dateStr)) continue
      seenDates.add(dateStr)
      if (entry.hasAnomaly || entry.riskLevel === 'high' || entry.riskLevel === 'emergency') {
        consecutiveAnomaly++
      } else {
        break
      }
    }
    if (consecutiveAnomaly >= 3) {
      insights.push({
        type: 'consecutive_anomaly',
        icon: '⚠️',
        message: `您的宠物最近${consecutiveAnomaly}天持续出现异常指标，建议尽快就医`,
      })
    }
  }

  if (recentFoodQueries && recentFoodQueries.length > 0) {
    const cautionFoods = recentFoodQueries.filter(
      (q) => q.safetyLevel === 'caution' || q.safetyLevel === 'dangerous'
    )
    if (cautionFoods.length > 0) {
      const foodNames = [...new Set(cautionFoods.map((q) => q.foodName))].slice(0, 3)
      insights.push({
        type: 'food_query_warning',
        icon: '',
        message: `根据近期食物查询记录，请注意${foodNames.join('、')}的摄入`,
      })
    }
  }

  if (petProfile && petProfile.breed) {
    const diseases = findBreedDiseases(petProfile.breed, petProfile.species)
    if (diseases.length > 0) {
      insights.push({
        type: 'breed_disease_risk',
        icon: '',
        message: `${petProfile.breed}易患${diseases.slice(0, 2).join('、')}，请关注相关症状`,
      })
    }
  }

  // 增强：品种年龄风险分析
  if (petProfile) {
    insights.push(...findBreedAgeRiskInsights(petProfile, symptomIds))
    insights.push(...findWeightTrendInsights(petProfile, recentCheckins))
    insights.push(...findVaccineStatusInsights(petProfile))
    insights.push(...findMedicationHistoryInsights(petProfile, symptomIds))
  }

  if (petProfile && symptomIds && symptomIds.length > 0) {
    insights.push(...findGeneticDiseaseInsights(petProfile, symptomIds))
    insights.push(...findAllergyInsights(petProfile, symptomIds))
    insights.push(...findMedicationInsights(petProfile, symptomIds))
    insights.push(...findChronicConditionInsights(petProfile, symptomIds))
  }

  return insights
}

/**
 * 品种年龄风险分析
 * 基于品种平均寿命和当前年龄计算风险
 */
function findBreedAgeRiskInsights(
  petProfile: PetProfile,
  _symptomIds?: string[] // 暂未使用（后续按症状细化风险时接入），保留签名
): PersonalizedInsight[] {
  const insights: PersonalizedInsight[] = []
  if (!petProfile.breed || !petProfile.birthDate) return insights

  const breed = BREED_LIGHT.find(
    (b) => b.species === petProfile.species && (b.name === petProfile.breed || b.aliases.includes(petProfile.breed) || b.id === petProfile.breed)
  )
  if (!breed) return insights

  const birth = new Date(petProfile.birthDate + 'T00:00:00.000Z')
  const now = new Date()
  const ageInMonths =
    (now.getUTCFullYear() - birth.getUTCFullYear()) * 12 +
    (now.getUTCMonth() - birth.getUTCMonth())
  const ageInYears = ageInMonths / 12

  // 品种平均寿命
  const avgLifespan = Number(breed.avgLifespan) || (petProfile.species === 'dog' ? 12 : 14)
  const lifespanPercent = (ageInYears / avgLifespan) * 100

  // 老年风险
  if (lifespanPercent >= 75) {
    insights.push({
      type: 'breed_age_risk',
      icon: '👴',
      title: '老年宠物注意',
      message: `${petProfile.name}已相当于${petProfile.breed}的老年阶段（平均寿命${avgLifespan}岁），老年宠物症状可能不典型，建议更积极的检查`,
    })
  }

  // 幼犬/幼猫风险
  if (ageInMonths < 6) {
    insights.push({
      type: 'breed_age_risk',
      icon: '👶',
      title: '幼年宠物注意',
      message: `${petProfile.name}还是幼${petProfile.species === 'dog' ? '犬' : '猫'}（约${ageInMonths}个月），免疫系统尚未发育完全，症状可能进展迅速`,
    })
  }

  return insights
}

/**
 * 体重趋势分析
 * 基于打卡记录分析体重变化趋势
 */
function findWeightTrendInsights(
  petProfile: PetProfile,
  recentCheckins?: PetHealthEntry[]
): PersonalizedInsight[] {
  const insights: PersonalizedInsight[] = []
  if (!recentCheckins || recentCheckins.length < 3) return insights

  // 提取有体重记录的打卡
  const weightEntries = recentCheckins
    .filter((e) => e.weight && e.weight > 0)
    .sort((a, b) => entryDateStr(a).localeCompare(entryDateStr(b)))

  if (weightEntries.length < 3) return insights

  // 计算体重变化趋势
  const firstWeight = weightEntries[0].weight!
  const lastWeight = weightEntries[weightEntries.length - 1].weight!
  const weightChange = lastWeight - firstWeight
  const weightChangePercent = (weightChange / firstWeight) * 100

  // 体重显著下降（>5%）
  if (weightChangePercent < -5) {
    insights.push({
      type: 'weight_trend',
      icon: '⚖️',
      title: '体重下降趋势',
      message: `${petProfile.name}近期体重下降了${Math.abs(weightChangePercent).toFixed(1)}%，从${firstWeight}kg降至${lastWeight}kg，需关注是否存在潜在健康问题`,
    })
  }

  // 体重显著上升（>10%）
  if (weightChangePercent > 10) {
    insights.push({
      type: 'weight_trend',
      icon: '️',
      title: '体重上升趋势',
      message: `${petProfile.name}近期体重上升了${weightChangePercent.toFixed(1)}%，从${firstWeight}kg升至${lastWeight}kg，需注意肥胖相关风险`,
    })
  }

  return insights
}

/**
 * 疫苗状态分析
 * 检查疫苗是否到期
 */
function findVaccineStatusInsights(petProfile: PetProfile): PersonalizedInsight[] {
  const insights: PersonalizedInsight[] = []
  
  // 从本地存储获取疫苗记录
  const vaccineRecords = getStorage<{ category: string; nextDate: string; status: string }[]>(`vaccines_${petProfile.id}`) || []
  
  if (vaccineRecords.length === 0) return insights

  const now = new Date()
  const overdueVaccines = vaccineRecords.filter((r) => {
    if (r.status === 'completed') return false
    const nextDate = new Date(r.nextDate + 'T00:00:00.000Z')
    return nextDate < now
  })

  if (overdueVaccines.length > 0) {
    const vaccineNames = overdueVaccines.map((v) => v.category).join('、')
    insights.push({
      type: 'vaccine_status',
      icon: '💉',
      title: '疫苗到期提醒',
      message: `${petProfile.name}的${vaccineNames}疫苗已逾期，免疫力可能下降，建议尽快补种`,
    })
  }

  return insights
}

/**
 * 用药历史分析
 * 分析近期用药与当前症状的关联
 */
function findMedicationHistoryInsights(
  petProfile: PetProfile,
  symptomIds?: string[]
): PersonalizedInsight[] {
  const insights: PersonalizedInsight[] = []
  if (!petProfile.medications || petProfile.medications.length === 0) return insights
  if (!symptomIds || symptomIds.length === 0) return insights

  // 检查是否有长期用药
  const longTermMeds = petProfile.medications.filter((med) =>
    ['胰岛素', '甲状腺', '心脏', '类固醇'].some((keyword) => med.includes(keyword))
  )

  if (longTermMeds.length > 0) {
    // 检查症状是否与长期用药相关
    const relatedSymptoms = symptomIds.filter((s) => {
      if (s === 'lethargy' || s === 'appetite_loss') {
        return longTermMeds.some((med) =>
          ['胰岛素', '甲状腺', '心脏'].some((keyword) => med.includes(keyword))
        )
      }
      return false
    })

    if (relatedSymptoms.length > 0) {
      insights.push({
        type: 'medication_history',
        icon: '💊',
        title: '长期用药关联',
        message: `${petProfile.name}正在使用${longTermMeds.join('、')}等长期药物，当前症状可能与药物剂量或病情变化有关，建议复查`,
      })
    }
  }

  return insights
}

export async function analyzeSymptoms(
  petId: string,
  symptoms: string[],
  additionalInfo?: SymptomCheckResult['additionalInfo'],
  petProfile?: PetProfile
): Promise<SymptomCheckResult> {
  const recentCheckins = getRecentCheckins(petId)
  const recentFoodQueries = getRecentFoodQueries(petId)
  const baseRiskLevel = calculateRiskLevel(symptoms, additionalInfo)
  const riskLevel = applyPersonalizedAdjustments(baseRiskLevel, symptoms, petProfile, recentCheckins)
  const possibleConditions = generatePossibleConditions(symptoms)
  const baseAdvice = generateAiAdvice(symptoms, riskLevel, additionalInfo)
  const aiAdvice = generatePersonalizedAdvice(baseAdvice, petProfile, recentCheckins, symptoms)
  const recommendedActions = generateRecommendedActions(riskLevel)
  const personalizedInsights = generatePersonalizedInsights(petProfile, recentCheckins, recentFoodQueries, symptoms)
  const historicalInsights = generateHistoricalMemoryInsights(petId, symptoms, petProfile)
  const allInsights = [...historicalInsights, ...personalizedInsights]

  const result: SymptomCheckResult = {
    id: generateId(),
    petId,
    symptoms,
    additionalInfo,
    riskLevel,
    possibleConditions,
    aiAdvice,
    recommendedActions,
    personalizedInsights: allInsights,
    createdAt: new Date().toISOString(),
  }

  // 附加置信度与结论（Phase 1：规则+图谱依据，置信度由代码推导，见 medicalGraph）
  const enriched = enrichResultWithConfidence(result)

  try {
    // 后端 symptomCheckSchema 使用 snake_case，路径为单数 symptom-check
    const apiResult = await api.post<SymptomCheckResult>(
      `/api/pets/${petId}/symptom-check`,
      {
        symptoms: result.symptoms,
        duration: result.additionalInfo?.duration,
        severity: result.additionalInfo?.severity,
        additional_info: result.additionalInfo,
        risk_level: result.riskLevel,
        possible_conditions: result.possibleConditions,
        ai_advice: result.aiAdvice,
        recommended_actions: result.recommendedActions,
      }
    )
    // 服务端暂不存储置信度字段，返回时与本地计算结果合并，避免前端展示丢失
    const merged: SymptomCheckResult = {
      ...apiResult,
      confidence: enriched.confidence,
      conclusions: enriched.conclusions,
    }
    const local = getLocalResults(petId)
    local.unshift(merged)
    saveLocalResults(petId, local)
    return merged
  } catch (error) {
    const local = getLocalResults(petId)
    local.unshift(enriched)
    saveLocalResults(petId, local)
    return enriched
  }
}

export async function getCheckHistory(petId: string): Promise<SymptomCheckResult[]> {
  try {
    // 后端返回分页对象 { list, total, page, pageSize }
    const result = await api.get<{ list: SymptomCheckResult[] }>(
      `/api/pets/${petId}/symptom-check/history`,
      { page: '1', page_size: '50' }
    )
    saveLocalResults(petId, result.list)
    return result.list
  } catch (error) {
    return getLocalResults(petId)
  }
}

export async function getCheckResult(id: string): Promise<SymptomCheckResult | null> {
  try {
    const result = await api.get<SymptomCheckResult>(`/api/symptom-checks/${id}`)
    return result
  } catch (error) {
    return null
  }
}

export async function deleteCheckResult(id: string): Promise<void> {
  try {
    await api.delete(`/api/symptom-checks/${id}`)
  } catch (error) {
  }
}

// ===== AI 深度分析（Phase 2，会员专属） =====

/** 记忆召回条目（服务端返回，basis='record' 只作背景展示） */
export interface AiRecalledMemory {
  content: string
  importance: number
  category: string
}

/** AI 深度分析结果 */
export interface AiDeepAnalysisResult {
  aiAdvice: string               // AI 组织后的建议（含免责声明）
  memoriesUsed: AiRecalledMemory[] // 记忆召回（历史健康/医疗背景）
  unsafe: boolean                // 输出安全检测是否拦截（true 时 aiAdvice 为兜底文案）
  degraded?: boolean             // LLM 调用失败降级（true 时 aiAdvice 为"稍后再试"文案，可选）
}

/**
 * 请求会员 AI 深度分析
 * 入参 = 本地初筛结论（规则+图谱依据），服务端注入宠物档案/打卡/记忆闸门召回后调 LLM
 * @param petId - 宠物 ID
 * @param payload - 本地初筛上下文
 * @returns AI 建议 + 记忆召回（非会员由服务端 403 拒绝）
 */
export async function aiDeepAnalyze(
  petId: string,
  payload: {
    symptoms: string[]
    symptomNames: string[]
    riskLevel: SymptomCheckResult['riskLevel']
    possibleConditions: string[]
    conclusions: AnalysisConclusion[]
    duration?: string
    severity?: string
  }
): Promise<AiDeepAnalysisResult> {
  return api.post<AiDeepAnalysisResult>(`/api/pets/${petId}/symptom-check/ai-analysis`, {
    symptoms: payload.symptoms,
    symptom_names: payload.symptomNames,
    risk_level: payload.riskLevel,
    possible_conditions: payload.possibleConditions,
    conclusions: payload.conclusions,
    duration: payload.duration,
    severity: payload.severity,
  })
}