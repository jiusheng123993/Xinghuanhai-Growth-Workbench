/**
 * 宠物家庭服务
 *
 * 宠物家庭的创建/成员管理/血缘追踪/合照管理，含本地缓存与云同步
 */
import { getStorage, setStorage } from '../utils/storage'
import { api } from './api'
import { mockApi } from './mock'
import { CONFIG } from '../config'
import type { PetFamily, PetFamilyMember, FamilyUser, FamilyUserRelation, FamilyUserRelationType, PetLineage, LineageResponse, LineageChild, LineageMate, FamilyPhoto, FamilyOverviewResponse } from '../types/familyTypes'

// useMock 以 use 开头会被 react-hooks 规则误判为 Hook，改名 isMockMode（2026-08-24 修复既有 lint error）
const isMockMode = () => CONFIG.USE_MOCK

/** 将 snake_case 键名转换为 camelCase（兼容后端未部署 toCamelCase 的情况） */
function snakeToCamel(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const key of Object.keys(obj)) {
    const camelKey = key.replace(/_([a-z])/g, (_: string, c: string) => c.toUpperCase())
    result[camelKey] = obj[key]
  }
  return result
}

/** 将后端返回的成员数据转为前端 camelCase */
function transformMember(raw: Record<string, unknown>): PetFamilyMember {
  const m = snakeToCamel(raw)
  return {
    id: String(m.id || ''),
    familyId: String(m.familyId || ''),
    petId: String(m.petId || ''),
    role: (m.role as string) || undefined,
    joinedAt: String(m.joinedAt || ''),
  }
}

/** 将后端 snake_case 血亲行转为前端 LineageChild */
function toLineageChild(item: Record<string, unknown>): LineageChild {
  return {
    id: String(item.id),
    familyId: (item.family_id as string | null) ?? null,
    parentId: item.parent_id ? String(item.parent_id) : '',
    childId: String(item.child_id),
    litterDate: (item.litter_date as string) || undefined,
    createdAt: (item.created_at as string) || undefined,
    petId: (item.pet_id as string) || undefined,
    petName: (item.pet_name as string | null) ?? null,
    petAvatarUrl: (item.pet_avatar_url as string | null) ?? null,
    petSpecies: (item.pet_species as string | null) ?? null,
    source: (item.source as 'blood' | 'sibling_rel') || undefined,
  }
}

/** 将后端 snake_case 配偶行转为前端 LineageMate */
function toLineageMate(raw: Record<string, unknown>): LineageMate {
  return {
    id: String(raw.id),
    familyId: (raw.family_id as string) || '',
    petIdA: String(raw.pet_id_a || ''),
    petIdB: String(raw.pet_id_b || ''),
    relationType: String(raw.relation_type || 'mate'),
    labelA: (raw.label_a as string) || undefined,
    labelB: (raw.label_b as string) || undefined,
    petAName: (raw.pet_a_name as string | null) ?? null,
    petBName: (raw.pet_b_name as string | null) ?? null,
  }
}

/** 将后端 snake_case 响应转换为前端 camelCase */
function transformLineageResponse(raw: Record<string, unknown>): LineageResponse {
  const toPetLineage = (item: Record<string, unknown>): PetLineage => ({
    id: String(item.id),
    familyId: (item.family_id as string | null) ?? null,
    parentId: String(item.parent_id),
    childId: String(item.child_id),
    litterDate: (item.litter_date as string) || undefined,
    createdAt: (item.created_at as string) || undefined,
    petId: (item.pet_id as string) || undefined,
    petName: (item.pet_name as string | null) ?? null,
    petAvatarUrl: (item.pet_avatar_url as string | null) ?? null,
    petSpecies: (item.pet_species as string | null) ?? null,
  })

  const petRaw = raw.pet as Record<string, unknown>

  // 多代分组（祖先/后代）：保持按代顺序，逐层转换
  const mapLevels = (rawLevels: unknown): LineageChild[][] => {
    if (!Array.isArray(rawLevels)) return []
    return (rawLevels as Array<Record<string, unknown>[]>).map(level =>
      (level || []).map(item => toLineageChild(item as Record<string, unknown>)),
    )
  }

  return {
    pet: {
      id: String(petRaw.id),
      name: (petRaw.name as string | null) ?? null,
      avatarUrl: (petRaw.avatar_url as string | null) ?? null,
      species: (petRaw.species as string | null) ?? null,
    },
    ancestorsLevels: mapLevels(raw.ancestors_levels),
    descendantsLevels: mapLevels(raw.descendants_levels),
    parents: ((raw.parents as Array<Record<string, unknown>>) || []).map(toPetLineage),
    children: ((raw.children as Array<Record<string, unknown>>) || []).map(toPetLineage),
    siblings: ((raw.siblings as Array<Record<string, unknown>>) || []).map(toLineageChild),
    mates: ((raw.mates as Array<Record<string, unknown>>) || []).map(toLineageMate),
  }
}

/** 家庭照片本地存储 key（后端 API 不可用时本地兜底） */
const FAMILY_PHOTOS_KEY = 'family_photos_all'

function generatePhotoId(): string {
  return `photo_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
}

function getLocalPhotos(): FamilyPhoto[] {
  return getStorage<FamilyPhoto[]>(FAMILY_PHOTOS_KEY) || []
}

function saveLocalPhotos(photos: FamilyPhoto[]): void {
  setStorage(FAMILY_PHOTOS_KEY, photos)
}

export const familyService = {
  async getFamilies(): Promise<PetFamily[]> {
    if (isMockMode()) return mockApi.getFamilies()
    const data = await api.get<Record<string, unknown>[]>('/api/families')
    return (data || []).map((raw) => {
      const f = snakeToCamel(raw)
      return {
        id: String(f.id || ''),
        userId: String(f.userId || f.user_id || ''),
        name: String(f.name || ''),
        avatarUrl: (f.avatarUrl as string) || undefined,
        memberCount: (f.memberCount as number) || 0,
        createdAt: String(f.createdAt || ''),
        updatedAt: String(f.updatedAt || f.updated_at || f.createdAt || ''),
      } as PetFamily
    })
  },

  async createFamily(name: string): Promise<PetFamily> {
    if (isMockMode()) return mockApi.createFamily(name)
    const raw = await api.post<Record<string, unknown>>('/api/families', { name })
    const f = snakeToCamel(raw)
    return {
      id: String(f.id || ''),
      userId: String(f.userId || f.user_id || ''),
      name: String(f.name || ''),
      avatarUrl: (f.avatarUrl as string) || undefined,
      memberCount: 0,
      createdAt: String(f.createdAt || ''),
      updatedAt: String(f.updatedAt || f.updated_at || f.createdAt || ''),
    } as PetFamily
  },

  async getMembers(familyId: string): Promise<PetFamilyMember[]> {
    if (isMockMode()) return mockApi.getMembers(familyId)
    // 后端成员通过 GET /api/families/:id 详情响应返回（含 members 字段）
    // 服务端可能返回 snake_case，前端统一转为 camelCase
    const data = await api.get<{ members?: Record<string, unknown>[] }>(`/api/families/${familyId}`)
    return (data?.members || []).map(transformMember)
  },

  async addMember(familyId: string, petId: string, role?: string): Promise<void> {
    if (isMockMode()) return mockApi.addMember(familyId, petId, role)
    // 后端 addFamilyMemberSchema 字段为 camelCase petId
    await api.post(`/api/families/${familyId}/members`, { petId, role })
  },

  async removeMember(familyId: string, memberId: string): Promise<void> {
    if (isMockMode()) return mockApi.removeMember(familyId, memberId)
    await api.delete(`/api/families/${familyId}/members/by-id/${memberId}`)
  },

  async updateMemberRole(familyId: string, memberId: string, role: string): Promise<void> {
    if (isMockMode()) return mockApi.updateMemberRole(familyId, memberId, role)
    await api.patch(`/api/families/${familyId}/members/${memberId}/role`, { role })
  },

  // ============ 多成员共同养宠：家庭成员（人）接口（2026-08-24） ============

  /** 家庭成员（人）列表（owner/member） */
  async getUsers(familyId: string): Promise<FamilyUser[]> {
    if (isMockMode()) return []
    const data = await api.get<Record<string, unknown>[]>(`/api/families/${familyId}/users`)
    return (data || []).map((raw) => {
      const u = snakeToCamel(raw)
      return {
        id: String(u.id || ''),
        familyId: String(u.familyId || ''),
        userId: String(u.userId || ''),
        role: (u.role as 'owner' | 'member') || 'member',
        nickname: (u.nickname as string) || '',
        avatarUrl: (u.avatarUrl as string) || '',
        joinedAt: (u.joinedAt as string) || '',
      } as FamilyUser
    })
  },

  /** 生成家庭邀请码（仅 owner） */
  async createInvite(familyId: string): Promise<{ code: string }> {
    if (isMockMode()) return { code: 'MOCK66' }
    const data = await api.post<{ code: string }>(`/api/families/${familyId}/invites`)
    return data
  },

  /** 凭邀请码加入家庭 */
  async joinFamily(code: string): Promise<{ familyId: string }> {
    if (isMockMode()) return { familyId: 'mock-family' }
    const data = await api.post<{ familyId: string }>('/api/families/join', { code })
    return data
  },

  /** 移除家庭成员（仅 owner） */
  async removeUser(familyId: string, userId: string): Promise<void> {
    if (isMockMode()) return
    await api.delete(`/api/families/${familyId}/users/${userId}`)
  },

  // ============ 多成员共同养宠：家庭成员（人）关系接口（2026-08-24） ============

  /** 家庭成员（人）关系列表（情侣/父女/兄弟姐妹等任意两人之间） */
  async getUserRelations(familyId: string): Promise<FamilyUserRelation[]> {
    if (isMockMode()) return []
    const data = await api.get<Record<string, unknown>[]>(`/api/families/${familyId}/user-relations`)
    return (data || []).map((raw) => {
      const r = snakeToCamel(raw)
      return {
        id: String(r.id || ''),
        familyId: String(r.familyId || ''),
        userIdA: String(r.userIdA || ''),
        userIdB: String(r.userIdB || ''),
        relationType: (r.relationType as FamilyUserRelationType) || 'other',
        createdAt: String(r.createdAt || ''),
        nicknameA: (r.nicknameA as string) || '',
        avatarUrlA: (r.avatarUrlA as string) || '',
        nicknameB: (r.nicknameB as string) || '',
        avatarUrlB: (r.avatarUrlB as string) || '',
      } as FamilyUserRelation
    })
  },

  /** 创建家庭成员（人）关系（仅 owner；两人之间最多一条） */
  async createUserRelation(
    familyId: string,
    userIdA: string,
    userIdB: string,
    relationType: FamilyUserRelationType,
  ): Promise<FamilyUserRelation> {
    if (isMockMode()) {
      return { id: 'mock-rel', familyId, userIdA, userIdB, relationType, createdAt: new Date().toISOString() }
    }
    const data = await api.post<Record<string, unknown>>(`/api/families/${familyId}/user-relations`, {
      userIdA,
      userIdB,
      relationType,
    })
    const r = snakeToCamel(data || {})
    return {
      id: String(r.id || ''),
      familyId: String(r.familyId || ''),
      userIdA: String(r.userIdA || ''),
      userIdB: String(r.userIdB || ''),
      relationType: (r.relationType as FamilyUserRelationType) || relationType,
      createdAt: String(r.createdAt || ''),
    } as FamilyUserRelation
  },

  /** 删除家庭成员（人）关系（仅 owner） */
  async removeUserRelation(familyId: string, relationId: string): Promise<void> {
    if (isMockMode()) return
    await api.delete(`/api/families/${familyId}/user-relations/${relationId}`)
  },

  /** 获取家庭关系总览（所有成员 + 所有关系） */
  async getOverview(familyId: string): Promise<FamilyOverviewResponse> {
    if (isMockMode()) {
      return { members: [], lineages: [], relationships: [] }
    }
    const raw = await api.get<Record<string, unknown>>(`/api/families/${familyId}/overview`)
    if (!raw) return { members: [], lineages: [], relationships: [] }

    const members = ((raw.members as Array<Record<string, unknown>>) || []).map((m) => ({
      petId: String(m.pet_id || ''),
      name: (m.name as string | null) ?? null,
      avatarUrl: (m.avatar_url as string | null) ?? null,
      species: (m.species as string | null) ?? null,
      gender: (m.gender as string | null) ?? null,
      role: (m.role as string | null) ?? null,
    }))

    const lineages = ((raw.lineages as Array<Record<string, unknown>>) || []).map((l) => ({
      id: String(l.id || ''),
      parentId: String(l.parent_id || ''),
      parentName: (l.parent_name as string | null) ?? null,
      parentAvatarUrl: (l.parent_avatar_url as string | null) ?? null,
      parentGender: (l.parent_gender as string | null) ?? null,
      parentSpecies: (l.parent_species as string | null) ?? null,
      childId: String(l.child_id || ''),
      childName: (l.child_name as string | null) ?? null,
      childAvatarUrl: (l.child_avatar_url as string | null) ?? null,
      childGender: (l.child_gender as string | null) ?? null,
      childSpecies: (l.child_species as string | null) ?? null,
      litterDate: (l.litter_date as string | null) ?? null,
    }))

    const relationships = ((raw.relationships as Array<Record<string, unknown>>) || []).map((r) => ({
      id: String(r.id || ''),
      petIdA: String(r.pet_id_a || ''),
      petAName: (r.pet_a_name as string | null) ?? null,
      petAAvatarUrl: (r.pet_a_avatar_url as string | null) ?? null,
      petAGender: (r.pet_a_gender as string | null) ?? null,
      petIdB: String(r.pet_id_b || ''),
      petBName: (r.pet_b_name as string | null) ?? null,
      petBAvatarUrl: (r.pet_b_avatar_url as string | null) ?? null,
      petBGender: (r.pet_b_gender as string | null) ?? null,
      relationType: String(r.relation_type || ''),
      labelA: (r.label_a as string | null) ?? null,
      labelB: (r.label_b as string | null) ?? null,
    }))

    return { members, lineages, relationships }
  },

  async getLineage(
    petId: string,
    familyId: string,
  ): Promise<LineageResponse> {
    if (isMockMode()) return mockApi.getLineage(petId)
    const raw = await api.get<Record<string, unknown>>(
      `/api/families/${familyId}/lineage/${petId}`
    )
    if (!raw) {
      return {
        pet: { id: petId, name: null, avatarUrl: null, species: null },
        ancestorsLevels: [],
        descendantsLevels: [],
        parents: [],
        children: [],
        siblings: [],
        mates: [],
      }
    }
    return transformLineageResponse(raw)
  },

  async addLineage(
    parentId: string,
    childId: string,
    familyId: string,
    litterDate?: string,
  ): Promise<void> {
    if (isMockMode()) return mockApi.addLineage(parentId, childId, litterDate)
    await api.post(`/api/families/${familyId}/lineage`, {
      parent_id: parentId,
      child_id: childId,
      litter_date: litterDate,
    })
  },

  async removeLineage(lineageId: string, familyId: string): Promise<void> {
    if (isMockMode()) return mockApi.removeLineage(lineageId)
    await api.delete(`/api/families/${familyId}/lineage/${lineageId}`)
  },

  /** 添加配偶关系（relation_type=mate） */
  async addMate(familyId: string, petIdA: string, petIdB: string, labelA?: string, labelB?: string): Promise<void> {
    if (isMockMode()) return mockApi.createRelationship()
    await api.post(`/api/families/${familyId}/relationships`, {
      pet_id_a: petIdA,
      pet_id_b: petIdB,
      relation_type: 'mate',
      label_a: labelA,
      label_b: labelB,
    })
  },

  /** 删除配偶关系 */
  async removeMate(familyId: string, relationshipId: string): Promise<void> {
    if (isMockMode()) return mockApi.deleteRelationship(relationshipId)
    await api.delete(`/api/families/${familyId}/relationships/${relationshipId}`)
  },

  /** 添加兄弟姐妹关系（relation_type=sibling） */
  async addSibling(familyId: string, petIdA: string, petIdB: string): Promise<void> {
    if (isMockMode()) return mockApi.createRelationship()
    await api.post(`/api/families/${familyId}/relationships`, {
      pet_id_a: petIdA,
      pet_id_b: petIdB,
      relation_type: 'sibling',
    })
  },

  /** 删除兄弟姐妹关系 */
  async removeSibling(familyId: string, relationshipId: string): Promise<void> {
    if (isMockMode()) return mockApi.deleteRelationship(relationshipId)
    await api.delete(`/api/families/${familyId}/relationships/${relationshipId}`)
  },

  async getFamilyPhotos(familyId: string): Promise<FamilyPhoto[]> {
    if (isMockMode()) return mockApi.getFamilyPhotos(familyId)
    try {
      const data = await api.get<FamilyPhoto[]>(`/api/families/${familyId}/photos`)
      if (data && data.length > 0) return data
    } catch {
      // 后端不可用，使用本地存储兜底
    }
    return getLocalPhotos().filter((p) => p.familyId === familyId)
  },

  /**
   * 发起 AI 全家福生成
   * @param scene 预设场景 key（不传时后端用默认温馨客厅）
   * @param customScene 用户自定义场景描述（与 scene 可同时传，后端清洗截断 60 字）
   * @param memberOrder 成员排位（petId 有序数组，顺序=画面从左到右；后端按此写"从左到右依次是"）
   */
  async generateFamilyPhoto(
    familyId: string,
    style: string,
    scene?: string,
    customScene?: string,
    memberOrder?: string[],
  ): Promise<{ id: string; photoUrl: string }> {
    if (isMockMode()) {
      const mockPhoto = await mockApi.saveFamilyPhoto(familyId, '', 0, [])
      return { id: mockPhoto.id, photoUrl: mockPhoto.photoUrl }
    }
    // 场景/排位参数按需携带；⚠️ 键名与后端 schema 对齐用驼峰 memberOrder
    // （zod 默认剥离未知键，发 snake_case 会被静默丢弃导致排位失效）
    const data = await api.post<{ id: string; photoUrl: string }>(`/api/families/${familyId}/photos`, {
      style,
      ...(scene ? { scene } : {}),
      ...(customScene ? { customScene } : {}),
      ...(memberOrder && memberOrder.length > 1 ? { memberOrder } : {}),
    })
    return data
  },

  async deleteFamilyPhoto(familyId: string, photoId: string): Promise<void> {
    if (isMockMode()) return mockApi.deleteFamilyPhoto(photoId)
    try {
      await api.delete(`/api/families/${familyId}/photos/${photoId}`)
      return
    } catch {
      // 后端不可用，使用本地存储兜底
    }
    const photos = getLocalPhotos().filter((p) => p.id !== photoId)
    saveLocalPhotos(photos)
  },

  /** 保存用户上传或 Canvas 降级生成的全家福（不触发 AI 生成） */
  async uploadFamilyPhoto(
    familyId: string,
    data: {
      photoUrl: string
      // 后端 uploadFamilyPhotoSchema 仅允许 canvas_fallback | uploaded（'generated' 会 400）
      photoType?: 'canvas_fallback' | 'uploaded'
      memberCount: number
      memberNames: string[]
      description?: string
    },
  ): Promise<{ id: string }> {
    if (isMockMode()) {
      const mockPhoto = await mockApi.saveFamilyPhoto(familyId, data.photoUrl, data.memberCount, data.memberNames, data.photoType || 'canvas_fallback')
      return { id: mockPhoto.id }
    }
    // ⚠️【2026-09-11 修复】后端成功时返回 `{ success: true, data: { id } }`，
    // 而 api 层已把 data 解包出来（返回的就是 `{ id }`）。这里原来读 `result.data`
    // → 恒 undefined → **上传全家福即使成功，调用方也拿到 undefined 的 id**。
    const { id } = await api.post<{ id: string }>(
      `/api/families/${familyId}/photos/upload`,
      data,
    )
    return { id }
  },
}
