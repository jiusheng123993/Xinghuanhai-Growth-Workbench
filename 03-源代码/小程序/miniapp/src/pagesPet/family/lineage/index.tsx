/**
 * 血缘图谱页面
 * 展示宠物家族血缘关系树，支持添加/删除父母/子女关系
 *
 * 命名口径（2026-09-12）：本页统一叫「血缘图谱」（导航标题、页内大标题、我的页入口三处一致）。
 * 它只管**宠物之间**的血缘（父母/祖辈/配偶/兄弟姐妹）；「家庭成员（人）之间的关系」
 * （情侣/父女/母子… 8 种）不在这里 —— 那份能力归 pages/family/index 的「共同养宠 → 设置关系」。
 *
 * 数据流：
 *   1. 从 currentFamily(useFamilyStore) 获取 familyId
 *   2. 从 familyPets(usePetStore + members) 获取家庭宠物列表
 *   3. 调用 familyService.getLineage(petId, familyId) 获取选中宠物的血缘数据
 *   4. 后端返回完整数据：{ pet, parents, children, siblings, mates }
 *   5. 父母/子女/兄弟姐妹直接渲染为卡片，带连线可视化
 */
import { useEffect, useState, useMemo, useCallback } from 'react'
import { View, Text, ScrollView } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { usePetStore } from '../../../stores/petStore'
import { useAuthStore } from '../../../stores/authStore'
import { useFamilyStore } from '../../../stores/familyStore'
import { familyService } from '../../../services/familyService'
import { useThemeClass } from '../../../hooks/useThemeClass'
import { formatPetAge } from '../../../utils/date'
import type { PetProfile } from '../../../services/petService'
import type { LineageResponse, LineageChild, LineageMate, FamilyOverviewResponse, OverviewMember, OverviewRelationship } from '../../../types/familyTypes'
import SpeciesAvatar from './SpeciesAvatar'
import './index.scss'

const RELATION_LABELS: Record<string, string> = {
  self: '我',
  owner: '铲屎官',
  parent: '父母',
  grandparent: '祖辈',
  greatGrandparent: '曾祖',
  child: '子女',
  grandchild: '孙辈',
  greatGrandchild: '曾孙',
  sibling: '兄弟姐妹',
  mate: '配偶',
}

/** 根据选中宠物和兄弟姐妹的性别，返回对应的称谓 */
function getSiblingLabel(selfGender: string | undefined, siblingGender: string | undefined): string {
  if (selfGender === 'male' && siblingGender === 'male') return '兄弟'
  if (selfGender === 'female' && siblingGender === 'female') return '姐妹'
  if (selfGender === 'male' && siblingGender === 'female') return '兄妹'
  if (selfGender === 'female' && siblingGender === 'male') return '姐弟'
  return '兄弟姐妹'
}

/**
 * 年龄文案已收敛到 utils/date 的 formatPetAge（2026-09-11）
 * 原实现按月相减但**不减「日」**（生日 20 号、今天 5 号会多算一个月）且按 UTC 解析。
 */

function getGenderIcon(gender?: string): string {
  switch (gender) {
    case 'male': return '♂️'
    case 'female': return '♀️'
    default: return ''
  }
}

function getGenderClass(gender?: string): string {
  switch (gender) {
    case 'male': return 'lineage-gender--male'
    case 'female': return 'lineage-gender--female'
    default: return ''
  }
}

export default function LineagePage() {
  const { pets, fetchPets } = usePetStore()
  const user = useAuthStore(s => s.user)
  const { currentFamily, members, fetchFamilies } = useFamilyStore()
  const [selectedPetId, setSelectedPetId] = useState<string | null>(null)
  const [lineage, setLineage] = useState<LineageResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [dataReady, setDataReady] = useState(false)
  const [petSelectorOpen, setPetSelectorOpen] = useState(false)
  const [addingRelation, setAddingRelation] = useState<{
    childId: string
    mode: 'parent' | 'child' | 'mate' | 'sibling'
  } | null>(null)
  const [viewMode, setViewMode] = useState<'single' | 'overview'>('single')
  const [overviewData, setOverviewData] = useState<FamilyOverviewResponse | null>(null)
  const [overviewLoading, setOverviewLoading] = useState(false)
  const themeClass = useThemeClass()

  useEffect(() => {
    const loadData = async () => {
      setDataReady(false)
      try {
        await fetchFamilies()
        if (user) {
          await fetchPets(user.id)
        }
      } finally {
        setDataReady(true)
      }
    }
    loadData()
  }, [user])

  // 家庭宠物列表（当前家庭中的宠物，未加载完成时返回空数组避免误判空状态）
  const familyPets = useMemo(() => {
    if (!currentFamily) return []
    const memberPetIds = new Set(members.map(m => m.petId))
    return pets.filter(p => memberPetIds.has(p.id))
  }, [pets, members, currentFamily])

  // 自动选中第一个宠物
  useEffect(() => {
    if (familyPets.length > 0) {
      if (!selectedPetId || !familyPets.find(p => p.id === selectedPetId)) {
        setSelectedPetId(familyPets[0].id)
      }
    }
  }, [familyPets])

  // 加载选中宠物的血缘数据
  useEffect(() => {
    if (!selectedPetId || !currentFamily) return
    const loadLineage = async () => {
      setLoading(true)
      try {
        const data = await familyService.getLineage(selectedPetId, currentFamily.id)
        setLineage(data)
      } catch {
        setLineage(null)
      } finally {
        setLoading(false)
      }
    }
    loadLineage()
  }, [selectedPetId, currentFamily?.id])

  const selectedPet = useMemo(() => {
    return familyPets.find(p => p.id === selectedPetId) || null
  }, [familyPets, selectedPetId])

  // 从 lineage 数据中提取有对应 pet 的关系
  const parentPets = useMemo(() => {
    if (!lineage) return []
    const parentIds = lineage.parents.map(l => l.parentId)
    return pets.filter(p => parentIds.includes(p.id)).map(p => {
      const l = lineage.parents.find(lp => lp.parentId === p.id)
      return { pet: p, lineageId: l?.id || '', litterDate: l?.litterDate }
    })
  }, [pets, lineage])

  // 将某一代血亲行（LineageChild[]）转换为有对应 pet 的关系列表
  const mapLevelToPets = useCallback((level: LineageChild[], useChildId: boolean) => {
    const ids = level.map(l => (useChildId ? l.childId : l.parentId))
    return pets
      .filter(p => ids.includes(p.id))
      .map(p => {
        const l = level.find(lv => (useChildId ? lv.childId : lv.parentId) === p.id)
        return { pet: p, lineageId: l?.id || '', litterDate: l?.litterDate }
      })
  }, [pets])

  // 多代祖先：ancestorsLevels[0]=父母(用parentId)，[1]=祖辈，[2]=曾祖
  const grandparentPets = useMemo(() => {
    if (!lineage?.ancestorsLevels?.[1]) return []
    return mapLevelToPets(lineage.ancestorsLevels[1], false)
  }, [lineage, mapLevelToPets])

  const greatGrandparentPets = useMemo(() => {
    if (!lineage?.ancestorsLevels?.[2]) return []
    return mapLevelToPets(lineage.ancestorsLevels[2], false)
  }, [lineage, mapLevelToPets])

  const childPets = useMemo(() => {
    if (!lineage) return []
    const childIds = lineage.children.map(l => l.childId)
    return pets.filter(p => childIds.includes(p.id)).map(p => {
      const l = lineage.children.find(lc => lc.childId === p.id)
      return { pet: p, lineageId: l?.id || '', litterDate: l?.litterDate }
    })
  }, [pets, lineage])

  // 多代后代：descendantsLevels[0]=子女(用childId)，[1]=孙辈，[2]=曾孙
  const grandchildPets = useMemo(() => {
    if (!lineage?.descendantsLevels?.[1]) return []
    return mapLevelToPets(lineage.descendantsLevels[1], true)
  }, [lineage, mapLevelToPets])

  const greatGrandchildPets = useMemo(() => {
    if (!lineage?.descendantsLevels?.[2]) return []
    return mapLevelToPets(lineage.descendantsLevels[2], true)
  }, [lineage, mapLevelToPets])

  // 配偶：mates 中相对选中宠物的另一方
  const matePets = useMemo(() => {
    if (!lineage || !selectedPetId) return []
    const result: Array<{
      pet: PetProfile
      mate: LineageMate
      relationshipId: string
    }> = []
    for (const mate of lineage.mates || []) {
      const otherId = mate.petIdA === selectedPetId ? mate.petIdB : mate.petIdA
      const otherPet = pets.find(p => p.id === otherId)
      if (otherPet) {
        result.push({ pet: otherPet, mate, relationshipId: mate.id })
      }
    }
    return result
  }, [pets, lineage, selectedPetId])

  // 直接使用后端返回的 siblings 数据（含血缘和手动添加的兄弟姐妹）
  const siblingPets = useMemo(() => {
    if (!lineage) return []
    const siblingIds = lineage.siblings.map(l => l.petId || l.childId)
    return pets.filter(p => siblingIds.includes(p.id)).map(p => {
      const l = lineage.siblings.find(s => (s.petId || s.childId) === p.id)
      return { pet: p, lineageId: l?.id || '', litterDate: l?.litterDate, source: l?.source }
    })
  }, [pets, lineage])

  const hasAnyRelation = parentPets.length > 0 || childPets.length > 0 || siblingPets.length > 0 || matePets.length > 0

  // 当宠物没有任何祖先（父母/祖辈/曾祖）时，显示铲屎官作为家族树的根节点
  const hasNoAncestors = !!lineage && parentPets.length === 0 && grandparentPets.length === 0 && greatGrandparentPets.length === 0

  // 可添加关系的宠物（排除已有关系 + 自身）
  const availableForRelation = useMemo(() => {
    const relatedIds = new Set<string>()
    if (selectedPetId) relatedIds.add(selectedPetId)
    lineage?.parents.forEach(l => relatedIds.add(l.parentId))
    lineage?.children.forEach(l => relatedIds.add(l.childId))
    lineage?.siblings.forEach(l => relatedIds.add(l.petId || l.childId))
    ;(lineage?.ancestorsLevels || []).forEach(level => level.forEach(l => relatedIds.add(l.parentId)))
    ;(lineage?.descendantsLevels || []).forEach(level => level.forEach(l => relatedIds.add(l.childId)))
    ;(lineage?.mates || []).forEach(m => {
      relatedIds.add(m.petIdA === selectedPetId ? m.petIdB : m.petIdA)
    })
    return pets.filter(p => !relatedIds.has(p.id))
  }, [pets, selectedPetId, lineage])

  const handleSelectPet = (petId: string) => {
    setSelectedPetId(petId)
    setPetSelectorOpen(false)
  }

  const handleAddParent = () => {
    if (!selectedPetId) return
    if (availableForRelation.length === 0) {
      Taro.showToast({ title: '没有可选的宠物', icon: 'none' })
      return
    }
    setAddingRelation({ childId: selectedPetId, mode: 'parent' })
  }

  const handleAddChild = () => {
    if (!selectedPetId) return
    if (availableForRelation.length === 0) {
      Taro.showToast({ title: '没有可选的宠物', icon: 'none' })
      return
    }
    setAddingRelation({ childId: selectedPetId, mode: 'child' })
  }

  const handleAddMate = () => {
    if (!selectedPetId) return
    if (availableForRelation.length === 0) {
      Taro.showToast({ title: '没有可选的宠物', icon: 'none' })
      return
    }
    setAddingRelation({ childId: selectedPetId, mode: 'mate' })
  }

  const handleAddSibling = () => {
    if (!selectedPetId) return
    if (availableForRelation.length === 0) {
      Taro.showToast({ title: '没有可选的宠物', icon: 'none' })
      return
    }
    setAddingRelation({ childId: selectedPetId, mode: 'sibling' })
  }

  const loadOverview = useCallback(async () => {
    if (!currentFamily) return
    setOverviewLoading(true)
    try {
      const data = await familyService.getOverview(currentFamily.id)
      setOverviewData(data)
    } catch (err: unknown) {
      const error = err as { message?: string }
      Taro.showToast({ title: error.message || '加载失败', icon: 'none' })
    } finally {
      setOverviewLoading(false)
    }
  }, [currentFamily])

  const handleSwitchMode = useCallback((mode: 'single' | 'overview') => {
    setViewMode(mode)
    if (mode === 'overview' && !overviewData) {
      loadOverview()
    }
  }, [overviewData, loadOverview])

  const handleConfirmRelation = useCallback(async (targetPetId: string) => {
    if (!addingRelation || !currentFamily) return
    try {
      if (addingRelation.mode === 'mate') {
        // 添加配偶关系
        await familyService.addMate(currentFamily.id, addingRelation.childId, targetPetId)
      } else if (addingRelation.mode === 'sibling') {
        // 添加兄弟姐妹关系
        await familyService.addSibling(currentFamily.id, addingRelation.childId, targetPetId)
      } else if (addingRelation.mode === 'parent') {
        // targetPetId 是父母，addingRelation.childId 是子女
        await familyService.addLineage(targetPetId, addingRelation.childId, currentFamily.id)
      } else {
        // addingRelation.childId 是父母，targetPetId 是子女
        await familyService.addLineage(addingRelation.childId, targetPetId, currentFamily.id)
      }
      Taro.showToast({ title: '关系已添加', icon: 'success' })
      // 重新加载血缘数据
      if (selectedPetId) {
        const data = await familyService.getLineage(selectedPetId, currentFamily.id)
        setLineage(data)
        if (viewMode === 'overview') loadOverview()
      }
    } catch (err: unknown) {
      const error = err as { message?: string }
      Taro.showToast({ title: error.message || '添加失败', icon: 'none' })
    } finally {
      setAddingRelation(null)
    }
  }, [addingRelation, currentFamily, selectedPetId, viewMode, loadOverview])

  const handleRemoveRelation = useCallback((lineageId: string, relationType: 'parent' | 'child', targetName: string) => {
    if (!currentFamily) return
    Taro.showModal({
      title: '解除关系',
      content: `确认解除与${targetName}的${relationType === 'parent' ? '父母' : '子女'}关系吗？`,
      confirmText: '确认解除',
      confirmColor: '#E0856B',
      cancelText: '取消',
      success: async (res) => {
        if (res.confirm) {
          try {
            await familyService.removeLineage(lineageId, currentFamily.id)
            const data = await familyService.getLineage(selectedPetId!, currentFamily.id)
            setLineage(data)
            if (viewMode === 'overview') loadOverview()
            Taro.showToast({ title: '关系已解除', icon: 'success' })
          } catch (err: unknown) {
            const error = err as { message?: string }
            Taro.showToast({ title: error.message || '解除失败', icon: 'none' })
          }
        }
      },
    })
  }, [currentFamily, selectedPetId, viewMode, loadOverview])

  const handleRemoveMate = useCallback((relationshipId: string, targetName: string) => {
    if (!currentFamily) return
    Taro.showModal({
      title: '解除配偶',
      content: `确认解除与${targetName}的配偶关系吗？`,
      confirmText: '确认解除',
      confirmColor: '#E0856B',
      cancelText: '取消',
      success: async (res) => {
        if (res.confirm) {
          try {
            await familyService.removeMate(currentFamily.id, relationshipId)
            const data = await familyService.getLineage(selectedPetId!, currentFamily.id)
            setLineage(data)
            if (viewMode === 'overview') loadOverview()
            Taro.showToast({ title: '关系已解除', icon: 'success' })
          } catch (err: unknown) {
            const error = err as { message?: string }
            Taro.showToast({ title: error.message || '解除失败', icon: 'none' })
          }
        }
      },
    })
  }, [currentFamily, selectedPetId, viewMode, loadOverview])

  const handleRemoveSibling = useCallback((relationshipId: string, targetName: string, siblingLabel: string) => {
    if (!currentFamily) return
    Taro.showModal({
      title: '解除关系',
      content: `确认解除与${targetName}的${siblingLabel}关系吗？`,
      confirmText: '确认解除',
      confirmColor: '#E0856B',
      cancelText: '取消',
      success: async (res) => {
        if (res.confirm) {
          try {
            await familyService.removeSibling(currentFamily.id, relationshipId)
            const data = await familyService.getLineage(selectedPetId!, currentFamily.id)
            setLineage(data)
            if (viewMode === 'overview') loadOverview()
            Taro.showToast({ title: '关系已解除', icon: 'success' })
          } catch (err: unknown) {
            const error = err as { message?: string }
            Taro.showToast({ title: error.message || '解除失败', icon: 'none' })
          }
        }
      },
    })
  }, [currentFamily, selectedPetId, viewMode, loadOverview])

  const handlePetCardClick = (petId: string) => {
    if (addingRelation) {
      handleConfirmRelation(petId)
      return
    }
    setSelectedPetId(petId)
  }

  const renderPetCard = (
    pet: PetProfile,
    relation: 'self' | 'parent' | 'grandparent' | 'greatGrandparent' | 'child' | 'grandchild' | 'greatGrandchild' | 'sibling' | 'mate',
    extra?: { litterDate?: string; labelOverride?: string },
  ) => {
    const isSelected = pet.id === selectedPetId
    const genderIcon = getGenderIcon(pet.gender)
    const genderClass = getGenderClass(pet.gender)
    const age = formatPetAge(pet.birthDate)

    return (
      <View
        key={pet.id}
        className={`lineage-card ${isSelected ? 'lineage-card--selected' : ''} ${addingRelation ? 'lineage-card--selectable' : ''}`}
        onClick={() => handlePetCardClick(pet.id)}
      >
        <View className='lineage-card-badge'>
          <Text className='lineage-card-badge-text'>{extra?.labelOverride || RELATION_LABELS[relation]}</Text>
        </View>
        <View className='lineage-card-body'>
          <View className='lineage-card-avatar'>
            <SpeciesAvatar
              pet={pet}
              imgClass='lineage-card-avatar-img'
              emojiClass='lineage-card-emoji'
            />
          </View>
          <View className='lineage-card-info'>
            <View className='lineage-card-name-row'>
              <Text className='lineage-card-name'>{pet.name}</Text>
              {genderIcon && (
                <Text className={`lineage-card-gender ${genderClass}`}>{genderIcon}</Text>
              )}
            </View>
            <Text className='lineage-card-breed'>
              {pet.breed || '未知品种'}
              {age ? ` · ${age}` : ''}
            </Text>
            {extra?.litterDate && (
              <Text className='lineage-card-litter'>📅 {extra.litterDate}</Text>
            )}
          </View>
        </View>
      </View>
    )
  }

  // 树形连线（类名匹配 SCSS: lineage-connector / lineage-connector-line / lineage-connector-dot）
  const renderTreeConnector = (direction: 'up' | 'down') => (
    <View className='lineage-connector'>
      <View className={`lineage-connector-line lineage-connector-line--${direction === 'up' ? 'top' : 'bottom'}`} />
      <View className='lineage-connector-dot' />
    </View>
  )

  if (!dataReady) {
    return (
      <View className={`lineage-page ${themeClass}`}>
        <View className='lineage-empty'>
          <Text className='lineage-empty-icon'>⏳</Text>
          <Text className='lineage-empty-text'>加载中...</Text>
        </View>
      </View>
    )
  }

  // 无家庭：引导创建家庭
  if (!currentFamily) {
    return (
      <View className={`lineage-page ${themeClass}`}>
        <View className='lineage-empty'>
          <Text className='lineage-empty-icon'>🏡</Text>
          <Text className='lineage-empty-text'>还没有创建家庭</Text>
          <Text className='lineage-empty-hint'>创建家庭后，可以添加毛孩子并建立家族血缘关系</Text>
          {/* 去家庭页创建：2026-09-12「家庭看板」（family/dashboard）并入 pages/family 后已下线，
              这里必须改指家庭页，否则空态按钮点了没反应 */}
          <View className='lineage-empty-btn' onClick={() => Taro.navigateTo({ url: '/pages/family/index' })}>
            <Text>前往创建家庭</Text>
          </View>
        </View>
      </View>
    )
  }

  // 有家庭但无成员：引导添加成员
  if (familyPets.length === 0) {
    return (
      <View className={`lineage-page ${themeClass}`}>
        <View className='lineage-empty'>
          <Text className='lineage-empty-icon'>🧬</Text>
          <Text className='lineage-empty-text'>还没有家庭成员</Text>
          {/* 提示语与跳转同步改口：成员是在家庭页「成员宠物」区加入的（原指向已下线的家庭看板） */}
          <Text className='lineage-empty-hint'>请先在家庭页的「成员宠物」里把毛孩子加入家庭</Text>
          <View className='lineage-empty-btn' onClick={() => Taro.navigateTo({ url: '/pages/family/index' })}>
            <Text>前往家庭页</Text>
          </View>
        </View>
      </View>
    )
  }

  return (
    <View className={`lineage-page ${themeClass}`}>
      <View className='lineage-header'>
        <View className='lineage-header-top'>
          <Text className='lineage-header-title'>🧬 血缘图谱</Text>
          <View className='lineage-view-toggle'>
            <Text
              className={`lineage-view-toggle-btn ${viewMode === 'single' ? 'lineage-view-toggle-btn--active' : ''}`}
              onClick={() => handleSwitchMode('single')}
            >单宠视图</Text>
            <Text
              className={`lineage-view-toggle-btn ${viewMode === 'overview' ? 'lineage-view-toggle-btn--active' : ''}`}
              onClick={() => handleSwitchMode('overview')}
            >关系总览</Text>
          </View>
          {viewMode === 'single' && (
            <View className='lineage-header-switch' onClick={() => setPetSelectorOpen(!petSelectorOpen)}>
              <Text className='lineage-header-switch-text'>
                {selectedPet?.name || '选择宠物'}
              </Text>
              <Text className='lineage-header-switch-arrow'>
                {petSelectorOpen ? '▲' : '▼'}
              </Text>
            </View>
          )}
        </View>
        {viewMode === 'single' && petSelectorOpen && (
          <View className='lineage-selector'>
            {familyPets.map(pet => (
              <View
                key={pet.id}
                className={`lineage-selector-item ${pet.id === selectedPetId ? 'lineage-selector-item--active' : ''}`}
                onClick={() => handleSelectPet(pet.id)}
              >
                <SpeciesAvatar
                  pet={pet}
                  imgClass='lineage-selector-avatar-img'
                  emojiClass='lineage-selector-emoji'
                />
                <Text className='lineage-selector-name'>{pet.name}</Text>
                {pet.id === selectedPetId && <Text className='lineage-selector-check'>✓</Text>}
              </View>
            ))}
          </View>
        )}
      </View>

      {viewMode === 'overview' && (
        <View className='lineage-overview'>
          {overviewLoading ? (
            <View className='lineage-overview-loading'>
              <Text>加载中...</Text>
            </View>
          ) : overviewData && overviewData.members.length > 0 ? (() => {
            // ===== 图谱布局计算 =====
            // 图谱数据解构：members 别名 graphMembers，避免遮蔽组件顶层的 members（useFamilyStore，no-shadow）
            const { members: graphMembers, lineages, relationships } = overviewData
            const childToParents = new Map<string, string[]>()
            const parentToChildren = new Map<string, string[]>()
            lineages.forEach(l => {
              if (!childToParents.has(l.childId)) childToParents.set(l.childId, [])
              childToParents.get(l.childId)!.push(l.parentId)
              if (!parentToChildren.has(l.parentId)) parentToChildren.set(l.parentId, [])
              parentToChildren.get(l.parentId)!.push(l.childId)
            })

            // BFS 分层
            const roots = graphMembers.filter(m => !childToParents.has(m.petId)).map(m => m.petId)
            const levels: string[][] = []
            const visited = new Set<string>()
            let current = roots
            while (current.length > 0) {
              levels.push(current)
              current.forEach(id => visited.add(id))
              const next: string[] = []
              current.forEach(id => {
                const children = parentToChildren.get(id) || []
                children.forEach(cid => {
                  if (!visited.has(cid) && !next.includes(cid)) next.push(cid)
                })
              })
              current = next
            }
            graphMembers.forEach(m => {
              if (!visited.has(m.petId)) {
                levels.push([m.petId])
                visited.add(m.petId)
              }
            })

            const memberMap = new Map(graphMembers.map(m => [m.petId, m]))
            const siblingRels = relationships.filter(r => r.relationType === 'sibling')
            const mateRels = relationships.filter(r => r.relationType === 'mate')

            const NODE_W = 120
            const NODE_GAP = 24
            const LAYER_GAP = 100

            // 是否有铲屎官根节点（决定图谱整体是否下移一层）
            const hasOwnerRoot = childToParents.size === 0 && !!user

            // ===== 横向布局：经典“整齐树”列分配 =====
            // 记录每个节点在画布上的中心 x（rpx）
            const nodeX = new Map<string, number>()
            // 列游标：每个叶子节点占一列，同一父节点的孩子连续占列
            let colCursor = 0

            // 自上而下分配列号：先给孩子依次占列，父节点居中于首尾孩子之间。
            // 这样同一父节点的孩子一定排列在父节点下方两侧，
            // 不会出现“孩子按序排列而错位到其他长辈正下方”的问题；
            // 不同分支的孩子从左到右连续占列，天然不会重叠。
            // 有环数据时用 nodeX.has 兜底，避免递归死循环。
            const assignSubtree = (id: string): void => {
              const children = (parentToChildren.get(id) || []).filter(cid => !nodeX.has(cid))
              if (children.length === 0) {
                // 叶子节点：占用当前列，中心 x = 列号 * 列宽 + 半列偏移
                nodeX.set(id, colCursor * (NODE_W + NODE_GAP) + NODE_GAP / 2 + NODE_W / 2)
                colCursor += 1
                return
              }
              // 先给孩子分配列，父节点取首尾孩子中心的平均值
              children.forEach(cid => assignSubtree(cid))
              const firstX = nodeX.get(children[0]) ?? 0
              const lastX = nodeX.get(children[children.length - 1]) ?? firstX
              nodeX.set(id, (firstX + lastX) / 2)
            }

            // 根节点（无父节点的成员）依次展开整棵子树；未覆盖到的成员（异常数据）补位到最右
            graphMembers.filter(m => !childToParents.has(m.petId)).forEach(m => assignSubtree(m.petId))
            graphMembers.forEach(m => {
              if (!nodeX.has(m.petId)) {
                nodeX.set(m.petId, colCursor * (NODE_W + NODE_GAP) + NODE_GAP / 2 + NODE_W / 2)
                colCursor += 1
              }
            })
            // 铲屎官根节点居中于整个图谱（总列数 = 已分配的列游标）
            const ownerCenter = ((colCursor - 1) / 2) * (NODE_W + NODE_GAP) + NODE_GAP / 2 + NODE_W / 2

            // 计算某宠物在层级网格中的连线端点坐标；找不到该宠物所在层级时返回 null。
            // 说明：原实现在 forEach 闭包内给变量赋值，TypeScript 无法对闭包赋值做类型收窄
            // （报 TS2339: Property x/y does not exist on type 'never'），
            // 因此改为同步遍历查找并直接返回坐标，类型可正常收窄。
            // @param petId   宠物 ID
            // @param yOffset 纵向偏移（亲子/配偶/手足连线使用不同偏移）
            // @param xOffset 横向偏移（区分连线起点/终点，用于对齐端点）
            const findPos = (
              petId: string,
              yOffset: number,
              xOffset: number,
            ): { x: number; y: number } | null => {
              const levelIdx = levels.findIndex(level => level.includes(petId))
              const center = nodeX.get(petId)
              if (levelIdx < 0 || center === undefined) return null
              return {
                // 节点中心 - 半宽 = 节点左边缘，再叠加端点偏移（与原 idx 公式等价）
                x: center - NODE_W / 2 + xOffset,
                y: (hasOwnerRoot ? (levelIdx + 1) * LAYER_GAP + 20 : levelIdx * LAYER_GAP + 20) + yOffset,
              }
            }

            return (
              <>
                {/* 图谱统计栏 */}
                <View className='graph-stats-bar'>
                  <View className='graph-stats-item'>
                    <Text className='graph-stats-num'>{graphMembers.length}</Text>
                    <Text className='graph-stats-label'>成员</Text>
                  </View>
                  <View className='graph-stats-divider' />
                  <View className='graph-stats-item'>
                    <Text className='graph-stats-num'>{lineages.length}</Text>
                    <Text className='graph-stats-label'>亲子</Text>
                  </View>
                  <View className='graph-stats-divider' />
                  <View className='graph-stats-item'>
                    <Text className='graph-stats-num'>{siblingRels.length}</Text>
                    <Text className='graph-stats-label'>手足</Text>
                  </View>
                  <View className='graph-stats-divider' />
                  <View className='graph-stats-item'>
                    <Text className='graph-stats-num'>{mateRels.length}</Text>
                    <Text className='graph-stats-label'>配偶</Text>
                  </View>
                </View>

                {/* 关系图谱 */}
                <ScrollView scrollX className='graph-scroll' enhanced showScrollbar={false}>
                  <View
                    className='graph-canvas'
                    style={{
                      // 画布宽度按实际布局的最大横向坐标计算
                      // （锚定父节点后跨度可能超过“层内最大节点数”对应的宽度）
                      width: `${Math.max(...nodeX.values(), 0) + NODE_W / 2 + NODE_GAP}rpx`,
                      minHeight: `${levels.length * LAYER_GAP + 60}rpx`,
                    }}
                  >
                    {/* 铲屎官根节点 */}
                    {levels[0] && levels[0].length > 0 && childToParents.size === 0 && user && (
                      <View
                        className='graph-node graph-node--owner'
                        style={{
                          // 居中于整个图谱（基于列布局的总宽度）
                          left: `${ownerCenter - NODE_W / 2}rpx`,
                          top: '0rpx',
                          width: `${NODE_W}rpx`,
                        }}
                      >
                        <View className='graph-node-avatar graph-node-avatar--owner'>
                          <Text className='graph-node-emoji'>🧑</Text>
                        </View>
                        <Text className='graph-node-name'>{user.nickname || '铲屎官'}</Text>
                        <Text className='graph-node-tag'>🏠 家长</Text>
                      </View>
                    )}

                    {/* 宠物节点 */}
                    {levels.map((level, levelIdx) =>
                      level.map((petId, idx) => {
                        const m = memberMap.get(petId)
                        if (!m) return null
                        const genderIcon = m.gender === 'male' ? '♂' : m.gender === 'female' ? '♀' : ''
                        const genderClass = m.gender === 'male' ? 'male' : m.gender === 'female' ? 'female' : ''
                        // 横向位置取布局计算出的节点中心（回退到按序排列，避免 undefined 导致布局崩坏）
                        const centerX = nodeX.get(petId) ?? idx * (NODE_W + NODE_GAP) + NODE_GAP / 2 + NODE_W / 2
                        const left = centerX - NODE_W / 2
                        // 改名 isOwnerRootNode：避免遮蔽外层同名 hasOwnerRoot（no-shadow）
                        const isOwnerRootNode = childToParents.size === 0 && !!user
                        const top = isOwnerRootNode ? (levelIdx + 1) * LAYER_GAP + 20 : levelIdx * LAYER_GAP + 20

                        return (
                          <View
                            key={petId}
                            className='graph-node'
                            style={{
                              left: `${left}rpx`,
                              top: `${top}rpx`,
                              width: `${NODE_W}rpx`,
                            }}
                          >
                            <View className='graph-node-avatar'>
                              <SpeciesAvatar
                                pet={m}
                                imgClass='graph-node-avatar-img'
                                emojiClass='graph-node-emoji'
                              />
                            </View>
                            <Text className='graph-node-name'>{m.name || '未命名'}</Text>
                            <View className='graph-node-tags'>
                              {genderIcon && (
                                <Text className={`graph-node-gender graph-node-gender--${genderClass}`}>{genderIcon}</Text>
                              )}
                              <Text className='graph-node-layer'>L{levelIdx + 1}</Text>
                            </View>
                          </View>
                        )
                      })
                    )}

                    {/* 亲子连线 */}
                    {lineages.map(l => {
                      // 计算父/子节点的连线端点坐标；任一节点不在层级中则跳过该连线
                      const parentPos = findPos(l.parentId, 60, NODE_W / 2)
                      const childPos = findPos(l.childId, 0, NODE_W / 2)
                      if (!parentPos || !childPos) return null

                      return (
                        <View
                          key={l.id}
                          className='graph-edge graph-edge--lineage'
                          style={{
                            left: `${Math.min(parentPos.x, childPos.x)}rpx`,
                            top: `${parentPos.y}rpx`,
                            width: `${Math.abs(childPos.x - parentPos.x) || 2}rpx`,
                            height: `${childPos.y - parentPos.y}rpx`,
                          }}
                          onClick={() => {
                            if (!currentFamily) return
                            Taro.showModal({
                              title: '删除亲子关系',
                              content: `确认删除 ${l.parentName} → ${l.childName} 的亲子关系吗？`,
                              confirmText: '确认删除',
                              confirmColor: '#E0856B',
                              cancelText: '取消',
                              success: async (res) => {
                                if (res.confirm) {
                                  try {
                                    await familyService.removeLineage(l.id, currentFamily.id)
                                    loadOverview()
                                    Taro.showToast({ title: '关系已删除', icon: 'success' })
                                  } catch (err: unknown) {
                                    const error = err as { message?: string }
                                    Taro.showToast({ title: error.message || '删除失败', icon: 'none' })
                                  }
                                }
                              },
                            })
                          }}
                        />
                      )
                    })}

                    {/* 配偶/手足连线 */}
                    {relationships.map(r => {
                      // 计算两个关联宠物节点的端点坐标；xOffset 区分起点/终点以对齐水平连线两端
                      const posA = findPos(r.petIdA, 30, NODE_W)
                      const posB = findPos(r.petIdB, 30, 0)
                      if (!posA || !posB) return null
                      if (Math.abs(posA.y - posB.y) > 10) return null

                      const isMate = r.relationType === 'mate'
                      const label = isMate ? '💞' : (() => {
                        const ma = memberMap.get(r.petIdA)
                        const mb = memberMap.get(r.petIdB)
                        return getSiblingLabel(ma?.gender || undefined, mb?.gender || undefined)
                      })()

                      return (
                        <View
                          key={r.id}
                          className={`graph-edge-h ${isMate ? 'graph-edge-h--mate' : 'graph-edge-h--sibling'}`}
                          style={{
                            left: `${Math.min(posA.x, posB.x)}rpx`,
                            top: `${posA.y}rpx`,
                            width: `${Math.abs(posB.x - posA.x)}rpx`,
                          }}
                          onClick={() => {
                            if (!currentFamily) return
                            Taro.showModal({
                              title: `删除${isMate ? '配偶' : label}关系`,
                              content: `确认删除 ${r.petAName} 和 ${r.petBName} 的${isMate ? '配偶' : label}关系吗？`,
                              confirmText: '确认删除',
                              confirmColor: '#E0856B',
                              cancelText: '取消',
                              success: async (res) => {
                                if (res.confirm) {
                                  try {
                                    if (isMate) {
                                      await familyService.removeMate(currentFamily.id, r.id)
                                    } else {
                                      await familyService.removeSibling(currentFamily.id, r.id)
                                    }
                                    loadOverview()
                                    Taro.showToast({ title: '关系已删除', icon: 'success' })
                                  } catch (err: unknown) {
                                    const error = err as { message?: string }
                                    Taro.showToast({ title: error.message || '删除失败', icon: 'none' })
                                  }
                                }
                              },
                            })
                          }}
                        >
                          <Text className='graph-edge-label'>{label}</Text>
                        </View>
                      )
                    })}
                  </View>
                </ScrollView>

                {/* 图例 */}
                <View className='graph-legend'>
                  <View className='graph-legend-item'>
                    <View className='graph-legend-line graph-legend-line--solid' />
                    <Text>亲子</Text>
                  </View>
                  <View className='graph-legend-item'>
                    <View className='graph-legend-line graph-legend-line--dashed-red' />
                    <Text>配偶</Text>
                  </View>
                  <View className='graph-legend-item'>
                    <View className='graph-legend-line graph-legend-line--dashed-blue' />
                    <Text>手足</Text>
                  </View>
                  <Text className='graph-legend-hint'>点击连线可删除关系</Text>
                </View>
              </>
            )
          })() : (
            <View className='lineage-overview-empty'>
              <Text>暂无家庭成员</Text>
            </View>
          )}
        </View>
      )}

      {viewMode === 'single' && addingRelation && (
        <View className='lineage-adding-banner'>
          <Text className='lineage-adding-banner-icon'>
            {addingRelation.mode === 'parent' ? '👆' : addingRelation.mode === 'mate' ? '💞' : addingRelation.mode === 'sibling' ? '🤝' : '👇'}
          </Text>
          <Text className='lineage-adding-banner-text'>
            请选择{addingRelation.mode === 'parent' ? '父母' : addingRelation.mode === 'mate' ? '配偶' : addingRelation.mode === 'sibling' ? '兄弟姐妹' : '子女'}宠物
          </Text>
          <View className='lineage-adding-banner-cancel' onClick={() => setAddingRelation(null)}>
            <Text>取消</Text>
          </View>
        </View>
      )}

      {viewMode === 'single' && (
      <ScrollView className='lineage-scroll' scrollY>
        <View className='lineage-tree'>
          {/* 配偶层（最上方） */}
          {matePets.length > 0 && (
            <View className='lineage-layer lineage-layer--mates'>
              <View className='lineage-layer-label'>
                <Text className='lineage-layer-label-text'>💞 配偶</Text>
              </View>
              <View className='lineage-layer-cards'>
                {matePets.map(({ pet, relationshipId }) => (
                  <View key={pet.id} className='lineage-card-wrap'>
                    {renderPetCard(pet, 'mate')}
                    {!addingRelation && (
                      <View className='lineage-remove-btn' onClick={() => handleRemoveMate(relationshipId, pet.name)}>
                        <Text>✕</Text>
                      </View>
                    )}
                  </View>
                ))}
              </View>
            </View>
          )}

          {/* 铲屎官节点（当宠物没有父母/祖辈时显示，作为家族树的根） */}
          {hasNoAncestors && !loading && !addingRelation && user && (
            <View className='lineage-layer lineage-layer--owner'>
              <View className='lineage-layer-label'>
                <Text className='lineage-layer-label-text'>🏠 铲屎官</Text>
              </View>
              <View className='lineage-owner-card'>
                <View className='lineage-owner-badge'>
                  <Text className='lineage-owner-badge-text'>铲屎官</Text>
                </View>
                <View className='lineage-owner-body'>
                  <View className='lineage-owner-avatar'>
                    <Text className='lineage-owner-emoji'>🧑</Text>
                  </View>
                  <View className='lineage-owner-info'>
                    <Text className='lineage-owner-name'>{user.nickname || '主人'}</Text>
                    <Text className='lineage-owner-role'>毛孩子的家长</Text>
                  </View>
                </View>
              </View>
              {renderTreeConnector('down')}
            </View>
          )}

          {/* 曾祖层 */}
          {greatGrandparentPets.length > 0 && (
            <View className='lineage-layer lineage-layer--ancestors'>
              <View className='lineage-layer-label'>
                <Text className='lineage-layer-label-text'>👆 曾祖</Text>
              </View>
              <View className='lineage-layer-cards'>
                {greatGrandparentPets.map(({ pet, lineageId, litterDate }) => (
                  <View key={pet.id} className='lineage-card-wrap'>
                    {renderPetCard(pet, 'greatGrandparent', { litterDate })}
                    {!addingRelation && (
                      <View className='lineage-remove-btn' onClick={() => handleRemoveRelation(lineageId, 'parent', pet.name)}>
                        <Text>✕</Text>
                      </View>
                    )}
                  </View>
                ))}
              </View>
              {renderTreeConnector('down')}
            </View>
          )}

          {/* 祖辈层 */}
          {grandparentPets.length > 0 && (
            <View className='lineage-layer lineage-layer--ancestors'>
              <View className='lineage-layer-label'>
                <Text className='lineage-layer-label-text'>👆 祖辈</Text>
              </View>
              <View className='lineage-layer-cards'>
                {grandparentPets.map(({ pet, lineageId, litterDate }) => (
                  <View key={pet.id} className='lineage-card-wrap'>
                    {renderPetCard(pet, 'grandparent', { litterDate })}
                    {!addingRelation && (
                      <View className='lineage-remove-btn' onClick={() => handleRemoveRelation(lineageId, 'parent', pet.name)}>
                        <Text>✕</Text>
                      </View>
                    )}
                  </View>
                ))}
              </View>
              {renderTreeConnector('down')}
            </View>
          )}

          {/* 父母层 */}
          {parentPets.length > 0 && (
            <View className='lineage-layer lineage-layer--parents'>
              <View className='lineage-layer-label'>
                <Text className='lineage-layer-label-text'>👆 父母</Text>
              </View>
              <View className='lineage-layer-cards'>
                {parentPets.map(({ pet, lineageId, litterDate }) => (
                  <View key={pet.id} className='lineage-card-wrap'>
                    {renderPetCard(pet, 'parent', { litterDate })}
                    {!addingRelation && (
                      <View className='lineage-remove-btn' onClick={() => handleRemoveRelation(lineageId, 'parent', pet.name)}>
                        <Text>✕</Text>
                      </View>
                    )}
                  </View>
                ))}
              </View>
              {renderTreeConnector('down')}
            </View>
          )}

          {/* 中间层：兄弟姐妹 + 选中宠物 */}
          <View className='lineage-layer lineage-layer--center'>
            <View className='lineage-center-row'>
              {/* 兄弟姐妹（左侧） */}
              {siblingPets.length > 0 && (
                <View className='lineage-siblings-side'>
                  <View className='lineage-layer-label'>
                    <Text className='lineage-layer-label-text'>🤝 手足</Text>
                  </View>
                  <View className='lineage-siblings-list'>
                    {siblingPets.map(({ pet, lineageId, source }) => {
                      const siblingLabel = getSiblingLabel(selectedPet?.gender, pet.gender)
                      return (
                        <View key={pet.id} className='lineage-card-wrap lineage-card-wrap--sibling'>
                          {renderPetCard(pet, 'sibling', { labelOverride: siblingLabel })}
                          {!addingRelation && source === 'sibling_rel' && (
                            <View className='lineage-remove-btn' onClick={() => handleRemoveSibling(lineageId, pet.name, siblingLabel)}>
                              <Text>✕</Text>
                            </View>
                          )}
                        </View>
                      )
                    })}
                  </View>
                </View>
              )}

              {/* 选中宠物自身 */}
              {selectedPet && (
                <View className='lineage-self-wrap'>
                  <View className='lineage-self-card'>
                    <View className='lineage-self-glow' />
                    <View className='lineage-self-body'>
                      <View className='lineage-self-avatar'>
                        <SpeciesAvatar
                          pet={selectedPet}
                          imgClass='lineage-self-avatar-img'
                          emojiClass='lineage-self-emoji'
                        />
                      </View>
                      <View className='lineage-self-info'>
                        <View className='lineage-self-name-row'>
                          <Text className='lineage-self-name'>{selectedPet.name}</Text>
                          {getGenderIcon(selectedPet.gender) && (
                            <Text className={`lineage-card-gender ${getGenderClass(selectedPet.gender)}`}>
                              {getGenderIcon(selectedPet.gender)}
                            </Text>
                          )}
                        </View>
                        <Text className='lineage-self-breed'>
                          {selectedPet.breed || '未知品种'}
                          {formatPetAge(selectedPet.birthDate) ? ` · ${formatPetAge(selectedPet.birthDate)}` : ''}
                        </Text>
                      </View>
                    </View>
                    {!addingRelation && (
                      <View className='lineage-self-actions'>
                        <View className='lineage-self-action' onClick={handleAddParent}>
                          <Text className='lineage-self-action-icon'>+👆</Text>
                          <Text className='lineage-self-action-text'>添加父母</Text>
                        </View>
                        <View className='lineage-self-action' onClick={handleAddMate}>
                          <Text className='lineage-self-action-icon'>+💞</Text>
                          <Text className='lineage-self-action-text'>添加配偶</Text>
                        </View>
                        <View className='lineage-self-action' onClick={handleAddSibling}>
                          <Text className='lineage-self-action-icon'>+🤝</Text>
                          <Text className='lineage-self-action-text'>添加手足</Text>
                        </View>
                        <View className='lineage-self-action' onClick={handleAddChild}>
                          <Text className='lineage-self-action-icon'>+👇</Text>
                          <Text className='lineage-self-action-text'>添加子女</Text>
                        </View>
                      </View>
                    )}
                  </View>
                </View>
              )}
            </View>
          </View>

          {/* 子女层 */}
          {childPets.length > 0 && (
            <View className='lineage-layer lineage-layer--children'>
              {renderTreeConnector('up')}
              <View className='lineage-layer-label'>
                <Text className='lineage-layer-label-text'>👇 子女</Text>
              </View>
              <View className='lineage-layer-cards'>
                {childPets.map(({ pet, lineageId, litterDate }) => (
                  <View key={pet.id} className='lineage-card-wrap'>
                    {renderPetCard(pet, 'child', { litterDate })}
                    {!addingRelation && (
                      <View className='lineage-remove-btn' onClick={() => handleRemoveRelation(lineageId, 'child', pet.name)}>
                        <Text>✕</Text>
                      </View>
                    )}
                  </View>
                ))}
              </View>
            </View>
          )}

          {/* 孙辈层 */}
          {grandchildPets.length > 0 && (
            <View className='lineage-layer lineage-layer--descendants'>
              {renderTreeConnector('up')}
              <View className='lineage-layer-label'>
                <Text className='lineage-layer-label-text'>👇 孙辈</Text>
              </View>
              <View className='lineage-layer-cards'>
                {grandchildPets.map(({ pet, lineageId, litterDate }) => (
                  <View key={pet.id} className='lineage-card-wrap'>
                    {renderPetCard(pet, 'grandchild', { litterDate })}
                    {!addingRelation && (
                      <View className='lineage-remove-btn' onClick={() => handleRemoveRelation(lineageId, 'child', pet.name)}>
                        <Text>✕</Text>
                      </View>
                    )}
                  </View>
                ))}
              </View>
            </View>
          )}

          {/* 曾孙层 */}
          {greatGrandchildPets.length > 0 && (
            <View className='lineage-layer lineage-layer--descendants'>
              {renderTreeConnector('up')}
              <View className='lineage-layer-label'>
                <Text className='lineage-layer-label-text'>👇 曾孙</Text>
              </View>
              <View className='lineage-layer-cards'>
                {greatGrandchildPets.map(({ pet, lineageId, litterDate }) => (
                  <View key={pet.id} className='lineage-card-wrap'>
                    {renderPetCard(pet, 'greatGrandchild', { litterDate })}
                    {!addingRelation && (
                      <View className='lineage-remove-btn' onClick={() => handleRemoveRelation(lineageId, 'child', pet.name)}>
                        <Text>✕</Text>
                      </View>
                    )}
                  </View>
                ))}
              </View>
            </View>
          )}

          {/* 空状态 */}
          {!hasAnyRelation && !loading && !addingRelation && (
            <View className='lineage-empty-relation'>
              <Text className='lineage-empty-relation-icon'>🧬</Text>
              <Text className='lineage-empty-relation-text'>
                {selectedPet?.name || '这只宠物'}还没有家族关系
              </Text>
              <Text className='lineage-empty-relation-hint'>
                点击上方按钮添加父母、配偶或子女
              </Text>
            </View>
          )}
        </View>

        {/* 可选宠物列表（添加关系时） */}
        {addingRelation && (
          <View className='lineage-available-section'>
            <View className='lineage-section-title'>
              <Text>可选宠物</Text>
            </View>
            <View className='lineage-available-list'>
              {availableForRelation.map(pet => (
                <View
                  key={pet.id}
                  className='lineage-available-item'
                  onClick={() => handleConfirmRelation(pet.id)}
                >
                  <SpeciesAvatar
                    pet={pet}
                    imgClass='lineage-available-avatar-img'
                    emojiClass='lineage-available-emoji'
                  />
                  <View className='lineage-available-info'>
                    <Text className='lineage-available-name'>{pet.name}</Text>
                    <Text className='lineage-available-breed'>{pet.breed || '未知品种'}</Text>
                  </View>
                  <Text className='lineage-available-add'>+</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        <View className='lineage-bottom-safe' />
      </ScrollView>
      )}
    </View>
  )
}
