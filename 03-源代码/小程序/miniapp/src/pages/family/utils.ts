/** 家庭页面工具函数和类型定义 */
import type { PetProfile } from '../../services/petService'
import type { PetMoment, FamilyUser, FamilyUserRelation, FamilyUserRelationType } from '../../types/familyTypes'
import { formatPetAge } from '../../utils/date'

export interface WeeklyReportWithPet {
  petName: string
  score: number
  overallMood: 'excellent' | 'good' | 'fair' | 'concerning'
  summary: string
}

export interface RankedPet {
  pet: PetProfile
  score: number
  rank: number
  role: string
  roleIcon: string
}

export interface QuickEntry {
  icon: string
  label: string
  url: string
}

export const RANK_MEDALS = ['🥇', '🥈', '🥉']

export const ROLE_CONFIG: { role: string; icon: string; check: (index: number, score: number, age: string) => boolean }[] = [
  { role: '老大', icon: '👑', check: (index) => index === 0 },
  { role: '团宠', icon: '💖', check: (index, score) => index >= 1 && score >= 85 },
  { role: '活力之星', icon: '⚡', check: (index, score) => score >= 90 },
  { role: '守护者', icon: '🛡️', check: (index, score) => score >= 80 && score < 90 },
  { role: '乖宝宝', icon: '🌟', check: () => true },
]

/**
 * 年龄文案 —— 统一走 utils/date 的 formatPetAge（2026-09-11 收敛）
 *
 * 原实现按月相减但**不减「日」**（生日 20 号、今天 5 号会多算一个月），
 * 且用 `new Date('YYYY-MM-DD')`（UTC 解析）。这里保留函数名与「未知」兜底，
 * 供 FamilyPetList 等处继续按 calcAge 引用。
 */
export function calcAge(birthDate: string): string {
  return formatPetAge(birthDate, { fallback: '未知' })
}

export function getScoreLevel(score: number): string {
  if (score >= 90) return 'high'
  if (score >= 75) return 'mid'
  return 'low'
}

export function calculateHealthScore(stats: { totalCheckins: number; totalAnomalyDays: number; streak: number }): number {
  if (stats.totalCheckins === 0) return 50
  const anomalyRatio = stats.totalAnomalyDays / Math.max(stats.totalCheckins, 1)
  let score = 100
  score -= anomalyRatio * 60
  score += Math.min(stats.streak * 3, 15)
  score += Math.min(stats.totalCheckins, 10)
  return Math.max(0, Math.min(100, Math.round(score)))
}

export function assignRole(index: number, score: number, age: string): { role: string; icon: string } {
  for (const config of ROLE_CONFIG) {
    if (config.check(index, score, age)) {
      return { role: config.role, icon: config.icon }
    }
  }
  return { role: '乖宝宝', icon: '🌟' }
}

export function buildRankedPets(pets: PetProfile[], petScores: Record<string, number>): RankedPet[] {
  const ranked = pets
    .map((pet, index) => {
      const score = petScores[pet.id] ?? 50
      const age = calcAge(pet.birthDate)
      const { role, icon } = assignRole(index, score, age)
      return { pet, score, rank: 0, role, roleIcon: icon }
    })
    .sort((a, b) => b.score - a.score)

  return ranked.map((item, index) => ({
    ...item,
    rank: index + 1,
  }))
}

// ============================================================
// 以下三项由「家庭看板（pagesPet/family/dashboard）」并入本页时搬来
// （2026-09-12 · IA 第 3 批：dashboard 整页并入 pages/family）。
// 之所以拆成纯函数放这里：并入的是**真实能力**（角色徽标 / 相册按月分组 / 合影座次），
// 混在 1000 行的页面组件里没法单测，而这三处都出现过"顺序/分组错一位"这类静默缺陷。
// ============================================================

/** 宠物在家庭里的角色徽标（与 dashboard 的 ROLE_ICONS 逐字一致，键=后端存的角色名） */
export const FAMILY_ROLE_ICONS: Record<string, string> = {
  老大: '👑',
  团宠: '💖',
  活力之星: '⚡',
  守护者: '🛡️',
  乖宝宝: '🌟',
  新成员: '🌱',
}

/**
 * 取角色徽标 emoji（角色为空或不在预置表里时返回空串，由调用方决定是否回退文案）
 * @param role 后端存的角色名（如「团宠」）
 */
export function roleIcon(role?: string): string {
  if (!role) return ''
  return FAMILY_ROLE_ICONS[role] || ''
}

/** 合影记录的最小字段集（只列本页要用的，避免整份 FamilyPhoto 类型耦合进来） */
export interface FamilyPhotoLike {
  id: string
  photoUrl?: string
  photoType?: string
  scene?: string | null
  description?: string
  memberCount: number
  createdAt: string
}

/** 相册分组（label 形如「2026年9月」） */
export interface FamilyPhotoGroup<T extends FamilyPhotoLike> {
  label: string
  photos: T[]
}

/**
 * 把本地 Date 转成 `YYYY年M月`（**不能用 toISOString**：东八区晚上会退到前一个月）
 * @param date 本地时间对象
 */
function photoMonthLabel(date: Date): string {
  return `${date.getFullYear()}年${date.getMonth() + 1}月`
}

/**
 * 相册按月分组：先按拍摄/生成时间**新的在前**排序，再切月，且**保证同月连续**
 * （后端返回顺序不保证，若不排序会出现"9月 / 8月 / 9月"三个月块来回跳）
 * @param photos 合影记录（后端字段顺序不限）
 * @returns 分组数组，每组内仍是新的在前
 */
export function groupPhotosByMonth<T extends FamilyPhotoLike>(photos: T[]): FamilyPhotoGroup<T>[] {
  const sorted = [...photos].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  )
  const groups: FamilyPhotoGroup<T>[] = []
  for (const photo of sorted) {
    const label = photoMonthLabel(new Date(photo.createdAt))
    const last = groups[groups.length - 1]
    if (!last || last.label !== label) {
      groups.push({ label, photos: [photo] })
    } else {
      last.photos.push(photo)
    }
  }
  return groups
}

/**
 * 对齐「合影座次」列表与当前家庭成员
 *
 * 语义：`memberOrder` 是 petId 有序数组，**排在前面 = 合影里靠左边**（后端据此写"从左到右依次是…"）。
 * 为什么不能直接 `setMemberOrder(familyPets.map(...))`（dashboard 原写法）：
 * 那样每次 members 引用变化（进页面、加/移成员后刷新）都会**把用户刚排好的座次清掉**，
 * 用户会看到"排完座次一点生成，顺序又变回默认"。
 * 这里改成**保持既有顺序**：丢掉已不在家庭的宠物、保留用户排过的相对次序、新成员追加到末尾。
 *
 * @param prevOrder 上一次的座次（用户可能已手动调整过）
 * @param currentPetIds 当前家庭成员对应的 petId（顺序=后端返回顺序）
 */
export function syncMemberOrder(prevOrder: string[], currentPetIds: string[]): string[] {
  const valid = new Set(currentPetIds)
  // 边过滤边去重：prev 里若真有重复 id（历史遗留的坏状态），同一个头像会在座次条里出现两次
  const seen = new Set<string>()
  const kept: string[] = []
  for (const id of prevOrder) {
    if (!valid.has(id) || seen.has(id)) continue
    seen.add(id)
    kept.push(id)
  }
  const appended = currentPetIds.filter((id) => !seen.has(id))
  return [...kept, ...appended]
}

/**
 * 座次左移/右移一位（返回新数组；越界时原样返回，调用方无需再判边界）
 * @param order 当前座次
 * @param petId 要移动的宠物
 * @param dir -1 左移一位 / +1 右移一位
 */
export function moveInOrder(order: string[], petId: string, dir: -1 | 1): string[] {
  const next = [...order]
  const i = next.indexOf(petId)
  const j = i + dir
  if (i < 0 || j < 0 || j >= next.length) return order
  ;[next[i], next[j]] = [next[j], next[i]]
  return next
}

/**
 * 两个座次数组内容是否完全一致（含顺序）
 *
 * 【为什么必须单独判等】页面里是 `useEffect(() => setMemberOrder(prev => syncMemberOrder(prev, ids)), [familyPets])`。
 * syncMemberOrder 每次都返回**新数组**，若不加判等，React 每次都会认为 state 变了而重渲染 ——
 * 白白多一轮渲染，且让"座次是否真的变过"无从判断。内容一致时直接返回原引用，state 就不更新。
 * @param a 旧座次
 * @param b 新座次
 */
export function isSameOrder(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i])
}

// ============================================================
// 家庭成员（人）关系 —— 由 pagesPet/family-tree 搬来（2026-09-12 舰长裁决方案②）
//
// 【为什么搬到这里而不是留在页面里】family-tree 页要下线，而它带的这份「人关系」能力
// （8 种关系，情侣/父女/母子…，对应后端 family_user_relations 表）全仓**只有它一处承载**。
// 舰长裁定归口到家庭页（IA「家庭 = 家庭相关一切的归处」）。三处纯逻辑下沉到 utils，
// 是为了能脱开 1500 行的页面组件单独单测（展示文案的方向箭头、owner 权限判定都是易错点）。
// ============================================================

/**
 * 8 种标准家庭人关系元数据（emoji + 中文名）
 * ⚠️ 必须与后端 schema 的 FAMILY_USER_RELATION_TYPES 保持一致（键即 FamilyUserRelationType）
 */
export const USER_REL_META: Record<FamilyUserRelationType, { label: string; emoji: string }> = {
  couple: { label: '情侣', emoji: '👫' },
  father_daughter: { label: '父女', emoji: '👨‍👧' },
  father_son: { label: '父子', emoji: '👨‍👦' },
  mother_daughter: { label: '母女', emoji: '👩‍👧' },
  mother_son: { label: '母子', emoji: '👩‍👦' },
  siblings: { label: '兄弟姐妹', emoji: '👯' },
  friends: { label: '朋友', emoji: '🤝' },
  other: { label: '其他', emoji: '💞' },
}

/** 有向关系（A 是 B 的父母）：展示用箭头区分方向；其余为对等关系 */
export const DIRECTED_USER_RELS: FamilyUserRelationType[] = [
  'father_daughter',
  'father_son',
  'mother_daughter',
  'mother_son',
]

/**
 * 生成「人关系」的展示文案（有向关系用 →、对等关系用 ↔）
 * 例：小明 → 小红 · 父女 ／ 小明 ↔ 小红 · 情侣
 * 昵称缺失时退化为「成员 A / 成员 B」，不能让箭头两侧出现空白
 * @param r 后端返回的关系记录
 */
export function describeUserRelation(r: FamilyUserRelation): string {
  const meta = USER_REL_META[r.relationType] || USER_REL_META.other
  const nameA = r.nicknameA || '成员 A'
  const nameB = r.nicknameB || '成员 B'
  const arrow = DIRECTED_USER_RELS.includes(r.relationType) ? '→' : '↔'
  return `${nameA} ${arrow} ${nameB} · ${meta.label}`
}

/**
 * 当前用户是否有权管理「人关系」（仅家庭创建者可增删）
 * ⚠️ 权限语义照搬 family-tree，**没有放宽**：非 owner 只读，页面上不渲染任何增删按钮
 * （后端另有校验，这里只是不把按钮摆出来）
 * @param users 家庭成员（人）列表
 * @param userId 当前登录用户 id
 */
export function isFamilyOwnerUser(users: FamilyUser[], userId: string | undefined): boolean {
  if (!userId) return false
  return users.some((u) => u.userId === userId && u.role === 'owner')
}