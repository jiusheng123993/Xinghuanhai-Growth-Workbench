export interface PetFamily {
  id: string
  userId: string
  name: string
  avatarUrl?: string
  memberCount?: number
  createdAt: string
  updatedAt: string
}

export interface PetFamilyMember {
  id: string
  familyId: string
  petId: string
  petName?: string
  role?: string
  joinedAt: string
}

/**
 * 家庭成员（人） - 多成员共同养宠（2026-08-24）
 * 对应后端 pet_family_users：家庭 ←→ 用户 关联（owner/member）
 */
export interface FamilyUser {
  id: string
  familyId: string
  userId: string
  role: 'owner' | 'member'
  nickname?: string
  avatarUrl?: string
  joinedAt?: string
}

/** 8 种标准家庭人关系（2026-08-24）：与后端 schema FAMILY_USER_RELATION_TYPES 保持一致 */
export const FAMILY_USER_RELATION_TYPES = [
  'couple',            // 情侣
  'father_daughter',   // 父女
  'father_son',        // 父子
  'mother_daughter',   // 母女
  'mother_son',        // 母子
  'siblings',          // 兄弟姐妹
  'friends',           // 朋友
  'other',             // 其他
] as const

export type FamilyUserRelationType = typeof FAMILY_USER_RELATION_TYPES[number]

/**
 * 家庭成员（人）关系 - family_user_relations 表（2026-08-24）
 * 任意两名成员之间的一种家庭角色关系（有向：userIdA 是关系主体，userIdB 是被关系对象）
 */
export interface FamilyUserRelation {
  id: string
  familyId: string
  userIdA: string
  userIdB: string
  relationType: FamilyUserRelationType
  createdAt: string
  nicknameA?: string
  avatarUrlA?: string
  nicknameB?: string
  avatarUrlB?: string
}

export interface PetLineage {
  id: string
  familyId: string | null
  parentId: string
  childId: string
  litterDate?: string
  createdAt?: string
  /** 关联宠物的名称（后端 JOIN pet_profiles 返回） */
  petId?: string
  petName?: string | null
  petAvatarUrl?: string | null
  petSpecies?: string | null
}

/** 血亲树单层结构 */
export interface LineageChild {
  id: string
  familyId: string | null
  parentId: string
  childId: string
  litterDate?: string
  createdAt?: string
  petId?: string
  petName?: string | null
  petAvatarUrl?: string | null
  petSpecies?: string | null
  /** 来源：blood=血缘关系（共同父母），sibling_rel=手动添加的兄弟姐妹关系 */
  source?: 'blood' | 'sibling_rel'
}

/** 配偶关系 */
export interface LineageMate {
  id: string
  familyId: string
  petIdA: string
  petIdB: string
  relationType: string
  labelA?: string
  labelB?: string
  petAName?: string | null
  petBName?: string | null
}

/** 后端 GET /api/families/:id/lineage/:petId 完整响应 */
export interface LineageResponse {
  pet: {
    id: string
    name: string | null
    avatarUrl: string | null
    species: string | null
  }
  /** 按代分组祖先：index 0=父母，1=祖辈，2=曾祖 */
  ancestorsLevels: LineageChild[][]
  /** 按代分组后代：index 0=子女，1=孙辈，2=曾孙 */
  descendantsLevels: LineageChild[][]
  /** 直接父母（兼容旧字段） */
  parents: LineageChild[]
  /** 直接子女（兼容旧字段） */
  children: LineageChild[]
  siblings: LineageChild[]
  mates: LineageMate[]
}

/** 家庭关系总览中的成员 */
export interface OverviewMember {
  petId: string
  name: string | null
  avatarUrl: string | null
  species: string | null
  gender: string | null
  role: string | null
}

/** 家庭关系总览中的亲子关系 */
export interface OverviewLineage {
  id: string
  parentId: string
  parentName: string | null
  parentAvatarUrl: string | null
  parentGender: string | null
  parentSpecies: string | null
  childId: string
  childName: string | null
  childAvatarUrl: string | null
  childGender: string | null
  childSpecies: string | null
  litterDate: string | null
}

/** 家庭关系总览中的自定义关系 */
export interface OverviewRelationship {
  id: string
  petIdA: string
  petAName: string | null
  petAAvatarUrl: string | null
  petAGender: string | null
  petIdB: string
  petBName: string | null
  petBAvatarUrl: string | null
  petBGender: string | null
  relationType: string
  labelA: string | null
  labelB: string | null
}

/** 后端 GET /api/families/:id/overview 完整响应 */
export interface FamilyOverviewResponse {
  members: OverviewMember[]
  lineages: OverviewLineage[]
  relationships: OverviewRelationship[]
}

/** 家庭动态类型 */
export type MomentType = 'photo' | 'milestone' | 'memory' | 'ai_summary' | 'checkin'

export interface CheckinMomentContent {
  petName: string
  petEmoji: string
  action: string
  appetite: string
  mood: string
  score: number
}

export interface MilestoneMomentContent {
  petName: string
  petEmoji: string
  title: string
  description: string
}

/** 照片动态内容 */
export interface PhotoMomentContent {
  petName: string
  petEmoji: string
  description: string
}

/** 记忆动态内容 */
export interface MemoryMomentContent {
  petName: string
  petEmoji: string
  description: string
  /**
   * 这条回忆关联的**全部宠物**（多宠共同回忆，2026-09-11 新增）
   *
   * 【存哪】写在 content（JSONB）里 —— pet_moments 表结构零变更；
   *   pet_id 仍是"主宠物"（= pets[0]），所有旧读取路径（家庭动态、按宠物查询）不受影响。
   * 【谁写】服务端用库里的权威名字/物种生成（不信任客户端），见 routes/timeline.ts。
   * 【谁读】时光页卡片用它渲染多枚宠物标签；缺失时回退到 petName/petEmoji（老数据）。
   */
  pets?: { id: string; name: string; emoji: string }[]
}

export interface AiSummaryMomentContent {
  summary: string
  period: string
}

/** 动态内容联合类型 */
export type MomentContent =
  | CheckinMomentContent
  | MilestoneMomentContent
  | PhotoMomentContent
  | MemoryMomentContent
  | AiSummaryMomentContent
  | Record<string, unknown>

export interface PetMoment {
  id: string
  userId: string
  familyId?: string
  petId?: string
  type: MomentType
  content: MomentContent
  photos?: string[]
  aiSummary?: string
  createdAt: string
  /** 回忆发生日期（补记支撑），未补记时等于 createdAt */
  happenedAt?: string
}

/** 宠物里程碑 */
export interface PetMilestone {
  id: string
  userId: string
  petId: string
  title: string
  date: string
  type: string
  createdAt: string
}

/**
 * 全家福照片类型
 * - generated：AI 生成的本地乐观插入态（保存到后端时改用 canvas_fallback）
 * - ai_generated：后端 family_photos 表 AI 生成记录的真实 photo_type 值
 * - canvas_fallback：Canvas 降级绘制 / 保存到后端时的默认类型（后端 schema 仅允许 canvas_fallback|uploaded）
 * - uploaded：用户手动上传
 */
export type PhotoType = 'generated' | 'ai_generated' | 'canvas_fallback' | 'uploaded'

/** 家庭照片 */
export interface FamilyPhoto {
  id: string
  familyId: string
  userId: string
  photoUrl: string
  photoType: PhotoType
  description?: string
  /** AI 生成所用场景 key（livingroom/seaside 等）；上传/手绘照片无此字段，相册据此展示场景标签 */
  scene?: string | null
  memberCount: number
  memberNames: string[]
  createdAt: string
}

/** 宠物名字记录 */
export interface PetName {
  id: string
  userId: string
  petId: string
  name: string
  chosen: boolean
  analysis?: Record<string, unknown>
  createdAt: string
}