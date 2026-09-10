import { HealthIndexAdapter } from '../adapters/healthIndexAdapter'
import { DietMemoryAdapter } from '../adapters/dietMemoryAdapter'
import { BehaviorAdapter } from '../adapters/behaviorAdapter'
import { MilestoneAdapter } from '../adapters/milestoneAdapter'
import type {
  UnifiedPetMemory,
  DietProfile,
  BehavioralBaseline,
  PetMilestone,
  MemoryFragment,
} from '../types/memoryBodyTypes'
import { formatPetAge } from '../../utils/date'

interface PetBasicInfo {
  id: string
  name: string
  species: string
  breed: string
  gender: string
  birthDate?: string
}

const cache = new Map<string, { data: UnifiedPetMemory; expiresAt: number }>()
const CACHE_TTL = 5 * 60 * 1000

export class MemoryAggregator {
  private healthAdapter: HealthIndexAdapter
  private dietAdapter: DietMemoryAdapter
  private behaviorAdapter: BehaviorAdapter
  private milestoneAdapter: MilestoneAdapter

  constructor(userId: string) {
    this.healthAdapter = new HealthIndexAdapter(userId)
    this.dietAdapter = new DietMemoryAdapter(userId)
    this.behaviorAdapter = new BehaviorAdapter(userId)
    this.milestoneAdapter = new MilestoneAdapter(userId)
  }

  getPetMemory(pet: PetBasicInfo): UnifiedPetMemory {
    const cacheKey = `memory_${pet.id}`
    const cached = cache.get(cacheKey)
    if (cached && cached.expiresAt > Date.now()) {
      return cached.data
    }

    const health = this.healthAdapter.buildHealthProfile(pet.id, 30)
    const diet: DietProfile | null = this.dietAdapter.getDietProfile(pet.id)
    const behavior: BehavioralBaseline | null = this.behaviorAdapter.buildBaseline(pet.id)
    const milestones: PetMilestone[] = this.milestoneAdapter.getTimeline(pet.id)

    const age = pet.birthDate
      ? this.calcAge(pet.birthDate)
      : '未知'

    const summary = this.buildSummary(pet, health, diet, behavior, milestones)

    const result: UnifiedPetMemory = {
      petId: pet.id,
      profile: {
        name: pet.name,
        species: pet.species,
        breed: pet.breed,
        age,
        gender: pet.gender,
      },
      health,
      diet,
      behavior,
      milestones,
      summary,
    }

    cache.set(cacheKey, { data: result, expiresAt: Date.now() + CACHE_TTL })
    return result
  }

  getCompactContext(pet: PetBasicInfo): { systemPrompt: string; fragments: MemoryFragment[] } {
    const memory = this.getPetMemory(pet)
    const fragments: MemoryFragment[] = []
    const lines: string[] = [`【关于 ${pet.name}】`]

    lines.push(`${pet.species === 'dog' ? '狗狗' : '猫咪'}，${pet.breed}，${memory.profile.age}`)

    if (memory.health && memory.health.totalEntries > 0) {
      const s = memory.health.summary
      lines.push(`健康：打卡${memory.health.totalEntries}天，异常${s.totalAnomalies}次`)
      fragments.push({ type: 'health', date: memory.health.dateRange.end || '', content: s.totalAnomalies > 0 ? '近期有异常记录' : '近期健康稳定', relevance: 0.8 })
    }

    if (memory.diet && memory.diet.safeFoods.length > 0) {
      lines.push(memory.diet.preferenceSummary)
      fragments.push({ type: 'diet', date: '', content: memory.diet.preferenceSummary, relevance: 0.6 })
    }

    if (memory.behavior && memory.behavior.personalityTraits.length > 0) {
      lines.push(`性格：${memory.behavior.personalityTraits.join('、')}`)
    }

    if (memory.milestones.length > 0) {
      const recent = memory.milestones.slice(0, 2)
      lines.push(`重要时刻：${recent.map(m => `${m.title}(${m.date})`).join('、')}`)
    }

    return {
      systemPrompt: lines.join('\n'),
      fragments,
    }
  }

  getRelevantMemories(pet: PetBasicInfo, query: string): MemoryFragment[] {
    const memory = this.getPetMemory(pet)
    const fragments: MemoryFragment[] = []
    const q = query.toLowerCase()

    if (/吃|食|食物|喂|餐/.test(q) && memory.diet) {
      fragments.push({
        type: 'diet',
        date: '',
        content: memory.diet.preferenceSummary,
        relevance: 0.9,
      })
    }

    if (/健康|精神|食欲|便便|体重/.test(q) && memory.health) {
      const s = memory.health.summary
      fragments.push({
        type: 'health',
        date: memory.health.dateRange.end || '',
        content: `近30天打卡${memory.health.totalEntries}次，异常${s.totalAnomalies}次`,
        relevance: 0.85,
      })
    }

    if (/性格|行为|活泼|安静|乖/.test(q) && memory.behavior) {
      fragments.push({
        type: 'behavior',
        date: '',
        content: memory.behavior.behaviorSummary,
        relevance: 0.85,
      })
    }

    return fragments
  }

  private buildSummary(
    pet: PetBasicInfo,
    health: any,
    diet: DietProfile | null,
    behavior: BehavioralBaseline | null,
    milestones: PetMilestone[],
  ): string {
    const parts: string[] = [`${pet.name}是一只${pet.breed}`]
    if (health?.totalEntries > 0) {
      parts.push(health.summary.totalAnomalies > 0 ? '近期健康状况需要关注' : '近期健康状况良好')
    }
    if (behavior?.personalityTraits.length) {
      parts.push(`性格${behavior.personalityTraits.join('、')}`)
    }
    return parts.join('，')
  }

  /**
   * 年龄文案 —— 统一走 utils/date 的 formatPetAge（2026-09-11 收敛）
   *
   * 这是全站第 11 处、也是最后一处各写各的年龄实现：原来"按月相减不减「日」"
   * 且按 UTC 解析出生日期，不足一个月时还用 Math.ceil 算天数（会多算一天）。
   * 这份文案会进 AI 记忆上下文，口径与页面不一致时模型也会跟着说错年龄。
   */
  private calcAge(birthDate: string): string {
    return formatPetAge(birthDate)
  }
}
