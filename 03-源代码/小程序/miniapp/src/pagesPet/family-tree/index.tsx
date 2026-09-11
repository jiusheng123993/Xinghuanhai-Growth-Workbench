/**
 * 家族图谱页面 - 三代树形图 + 家庭成员列表 + 关系管理
 */
import { useState, useEffect, useCallback, useMemo } from 'react'
import { View, Text, Image } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { useFamilyStore } from '../../stores/familyStore'
import { useAuthStore } from '../../stores/authStore'
import { familyTreeService } from '../../services/familyTreeService'
import type { TreeNode, TreeEdge } from '../../services/familyTreeService'
import type { FamilyUserRelation, FamilyUserRelationType } from '../../types/familyTypes'
import './index.scss'
import { Icon } from '../../components'
import PageBackground from '../../components/PageBackground'

const REL_TYPES = [
  { value: 'parent_child', label: '亲子' },
  { value: 'sibling', label: '兄弟姐妹' },
  { value: 'mate', label: '伴侣' },
  { value: 'friend', label: '好友' },
  { value: 'rival', label: '对手' },
]

/** 家庭成员（人）8 种标准关系元数据（2026-08-24）：emoji + 中文名，与后端 schema 保持一致 */
const USER_REL_META: Record<FamilyUserRelationType, { label: string; emoji: string }> = {
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
const DIRECTED_USER_RELS: FamilyUserRelationType[] = ['father_daughter', 'father_son', 'mother_daughter', 'mother_son']

/** 生成"人关系"的展示文案（如：小明 → 小红 · 父女 / 小明 ↔ 小红 · 情侣） */
function describeUserRelation(r: FamilyUserRelation): string {
  const meta = USER_REL_META[r.relationType] || USER_REL_META.other
  const nameA = r.nicknameA || '成员 A'
  const nameB = r.nicknameB || '成员 B'
  const arrow = DIRECTED_USER_RELS.includes(r.relationType) ? '→' : '↔'
  return `${nameA} ${arrow} ${nameB} · ${meta.label}`
}

const EMOJI: Record<string, string> = { cat: '🐱', dog: '🐕' }
const emoji = (s: string) => EMOJI[s] || '🐾'

/** 三代树形图行配置（2026-08-24 对齐后端契约：父母/同代/子女） */

interface LineageData {
  parents: TreeNode[]
  siblings: TreeNode[]
  children: TreeNode[]
}

export default function FamilyTree() {
  const { currentFamily } = useFamilyStore()
  const user = useAuthStore(state => state.user)
  const userId = useAuthStore(state => state.user?.id) || ''
  const [nodes, setNodes] = useState<TreeNode[]>([])
  const [edges, setEdges] = useState<TreeEdge[]>([])
  const [selPid, setSelPid] = useState('')
  const [lineage, setLineage] = useState<LineageData | null>(null)
  const [loading, setLoading] = useState(false)
  const [showRel, setShowRel] = useState(false)
  const [rf, setRf] = useState({ pet_id_a: '', pet_id_b: '', relation_type: 'friend', label_a: '', label_b: '' })
  const fid = currentFamily?.id || ''

  // ===== 多成员共同养宠：人关系（2026-08-24） =====
  const familyUsers = useFamilyStore(state => state.users)
  const familyRelations = useFamilyStore(state => state.relations)
  const [showUserRel, setShowUserRel] = useState(false)
  const [userRelForm, setUserRelForm] = useState<{ userIdA: string; userIdB: string; relationType: FamilyUserRelationType }>({
    userIdA: '',
    userIdB: '',
    relationType: 'couple',
  })
  // 当前用户是否为家庭创建者（仅 owner 可管理成员关系）
  const isFamilyOwner = familyUsers.some(u => u.userId === userId && u.role === 'owner')

  const loadLineage = useCallback(async (pid: string) => {
    if (!fid || !pid) return
    setSelPid(pid)
    try {
      const d = await familyTreeService.getLineageTree(fid, pid)
      // 对齐后端契约：只取页面三行需要的父母/兄弟姐妹/子女
      setLineage({ parents: d.parents, siblings: d.siblings, children: d.children })
    } catch {
      setLineage(null)
    }
  }, [fid])

  const loadTree = useCallback(async () => {
    if (!fid) return
    setLoading(true)
    try {
      const d = await familyTreeService.getFamilyTree(fid)
      setNodes(d.nodes)
      setEdges(d.edges)
      if (d.nodes.length > 0) {
        await loadLineage(d.nodes[0].pet_id)
      } else {
        setLineage(null)
        setSelPid('')
      }
    } catch {
      Taro.showToast({ title: '加载失败', icon: 'none' })
    } finally {
      setLoading(false)
    }
  }, [fid, loadLineage])

  useEffect(() => {
    if (currentFamily) {
      loadTree()
      // 多成员共同养宠：加载家庭成员（人）列表与关系（2026-08-24）
      useFamilyStore.getState().fetchUsers().catch(() => {})
      useFamilyStore.getState().fetchRelations().catch(() => {})
    }
  }, [currentFamily, loadTree])

  const doCreateRel = useCallback(async () => {
    if (!fid || !rf.pet_id_a || !rf.pet_id_b) return
    try {
      await familyTreeService.createRelationship(fid, rf)
      Taro.showToast({ title: '关系已创建', icon: 'success' })
      setShowRel(false)
      setRf({ pet_id_a: '', pet_id_b: '', relation_type: 'friend', label_a: '', label_b: '' })
      loadTree()
    } catch {
      Taro.showToast({ title: '创建失败', icon: 'none' })
    }
  }, [fid, rf, loadTree])

  const doSaveSnapshot = useCallback(async () => {
    if (!fid || nodes.length === 0) return
    try {
      await familyTreeService.saveSnapshot(fid, { layout_type: 'lineage', graph_data: { nodes } as Record<string, unknown> })
      Taro.showToast({ title: '快照已保存', icon: 'success' })
    } catch {
      Taro.showToast({ title: '保存失败', icon: 'none' })
    }
  }, [fid, nodes])

  /** 选择人关系中的成员（actionSheet 按昵称选择，2026-08-24） */
  const pickUser = (field: 'userIdA' | 'userIdB') => {
    const names = familyUsers.map(u => u.nickname || '成员')
    if (names.length < 2) {
      Taro.showToast({ title: '至少需要两名家庭成员', icon: 'none' })
      return
    }
    Taro.showActionSheet({
      itemList: names,
      success: (res) => setUserRelForm(f => ({ ...f, [field]: familyUsers[res.tapIndex].userId })),
    })
  }

  /** 创建人关系（仅 owner；失败透传服务端原因如"两人之间已存在关系"） */
  const doCreateUserRelation = async () => {
    if (!fid) return
    if (!userRelForm.userIdA || !userRelForm.userIdB) {
      Taro.showToast({ title: '请选择两名成员', icon: 'none' })
      return
    }
    if (userRelForm.userIdA === userRelForm.userIdB) {
      Taro.showToast({ title: '不能给自己设置关系', icon: 'none' })
      return
    }
    try {
      await useFamilyStore.getState().createRelation(userRelForm.userIdA, userRelForm.userIdB, userRelForm.relationType)
      Taro.showToast({ title: '关系已添加', icon: 'success' })
      setShowUserRel(false)
      setUserRelForm({ userIdA: '', userIdB: '', relationType: 'couple' })
    } catch (err) {
      const message = (err as { message?: string }).message || '添加失败'
      Taro.showToast({ title: message, icon: 'none' })
    }
  }

  /** 删除人关系（仅 owner；二次确认） */
  const handleRemoveUserRelation = (relationId: string) => {
    Taro.showModal({
      title: '删除关系',
      content: '确定删除这条成员关系吗？',
      confirmText: '删除',
      cancelText: '取消',
      success: async (res) => {
        if (res.confirm) {
          try {
            await useFamilyStore.getState().removeRelation(relationId)
            Taro.showToast({ title: '已删除', icon: 'success' })
          } catch {
            Taro.showToast({ title: '删除失败', icon: 'none' })
          }
        }
      },
    })
  }

  const pickPet = (field: 'pet_id_a' | 'pet_id_b') => {
    const names = nodes.map(n => n.name)
    if (names.length === 0) { Taro.showToast({ title: '暂无宠物', icon: 'none' }); return }
    Taro.showActionSheet({ itemList: names, success: (res) => setRf(f => ({ ...f, [field]: nodes[res.tapIndex].pet_id })) })
  }

  const selectedNode = useMemo(() => nodes.find(n => n.pet_id === selPid) || null, [nodes, selPid])

  /** 每个成员的关系描述（如：爸爸、妈妈） */
  const memberRelation = useMemo(() => {
    const map: Record<string, string> = {}
    for (const edge of edges) {
      if (edge.label_a) map[edge.pet_id_a] = edge.label_a
      if (edge.label_b) map[edge.pet_id_b] = edge.label_b
    }
    return map
  }, [edges])

  const renderTreeNode = (n: TreeNode, role?: string) => (
    <View key={n.pet_id} className='ft-node'>
      <View className='ft-avatar-wrap'>
        <View className='ft-avatar'>
          {n.avatar_url ? (
            <Image src={n.avatar_url} className='ft-avatar-img' mode='aspectFill' />
          ) : (
            <Text className='ft-avatar-emoji'>{emoji(n.species)}</Text>
          )}
        </View>
      </View>
      <Text className='ft-node-name'>{n.name}</Text>
      {role ? (
        <Text className='ft-node-role'>{role}</Text>
      ) : n.role ? (
        <Text className='ft-node-role'>{n.role}</Text>
      ) : null}
    </View>
  )

  if (!currentFamily) {
    return (
      <View className='family-tree'>
        <View className='family-tree__empty'>
          <Icon name='house' size={48} tone='primary' className='family-tree__empty-icon' />
          <Text className='family-tree__empty-text'>请先创建或加入一个家庭</Text>
          <View
            className='family-tree__empty-btn'
            onClick={() => Taro.navigateTo({ url: '/pagesPet/family/dashboard/index' })}
          >
            <Text>前往创建家庭</Text>
          </View>
        </View>
      </View>
    )
  }

  return (
    <View className='family-tree'>
      {/* 全屏动态背景层 */}
      <PageBackground />

      <View className='family-tree__content'>
        {/* ===== 图谱头部卡 ===== */}
        <View className='ft-card'>
          <View className='ft-card__head'>
            <View className='ft-card__avatar'>
              <Icon name='paw-print' size={20} tone='primary' className='ft-card__avatar-icon' />
            </View>
            <View className='ft-card__info'>
              <Text className='ft-card__name'>{currentFamily.name}</Text>
              <View className='ft-card__meta'>
                <Icon name='paw-print' size={12} tone='primary' className='ft-card__meta-icon' />
                <Text className='ft-card__meta-text'>{nodes.length} 位成员</Text>
              </View>
            </View>
            <View
              className='ft-card__edit'
              onClick={() => Taro.navigateTo({ url: '/pagesPet/family/dashboard/index' })}
            >
              <Icon name='pencil-simple' size={12} tone='primary' className='ft-card__edit-icon' />
              <Text className='ft-card__edit-text'>编辑</Text>
            </View>
          </View>
        </View>

        {/* ===== 家族图谱树形图卡 ===== */}
        <View className='ft-card'>
          <Text className='ft-card__section-title'>🌿 家族图谱</Text>

          {loading ? (
            <View className='family-tree__loading'>
              <Text className='family-tree__loading-text'>加载中...</Text>
            </View>
          ) : nodes.length === 0 ? (
            <View className='family-tree__empty'>
              <Icon name='dna' size={48} tone='primary' className='family-tree__empty-icon' />
              <Text className='family-tree__empty-text'>暂无成员数据，添加宠物后可生成图谱</Text>
            </View>
          ) : (
            <>
              <View className='ft-tree'>
                {/* 动态组装三代行（2026-08-24）：
                    - 父母行：有父母显示父母；无父母（无祖先）→ 显示"铲屎官"作图谱根（指向铲屎官，不指向空气）
                    - 同代行：选中宠物自己（最前）+ 兄弟姐妹
                    - 子女行：有子女才渲染（无子女不显示该行，避免空手势） */}
                {(() => {
                  const rowsToRender: Array<{
                    key: string
                    title: string
                    nodes: TreeNode[]
                    ownerRoot?: boolean
                  }> = []
                  const parentsNodes = lineage?.parents || []
                  const childrenNodes = lineage?.children || []
                  const siblingsNodes = (lineage?.siblings || []).filter(n => n.pet_id !== selPid)
                  const selfNodes = selectedNode ? [selectedNode, ...siblingsNodes] : siblingsNodes
                  if (parentsNodes.length > 0) {
                    rowsToRender.push({ key: 'parents', title: '第一代 · 父母', nodes: parentsNodes })
                  } else if (user) {
                    // 无父母/无祖辈：以铲屎官为根节点（如烧鸭没有父母时指向铲屎官）
                    rowsToRender.push({ key: 'owner', title: '🏠 铲屎官', nodes: [], ownerRoot: true })
                  }
                  if (selfNodes.length > 0) {
                    rowsToRender.push({ key: 'self', title: '第二代 · 同代', nodes: selfNodes })
                  }
                  if (childrenNodes.length > 0) {
                    rowsToRender.push({ key: 'children', title: '第三代 · 子女', nodes: childrenNodes })
                  }
                  return rowsToRender.map((row, rowIndex) => (
                    <View key={row.key}>
                      {rowIndex > 0 && (
                        <View className='ft-connector'>
                          <View className={`ft-connector-v${rowIndex >= 2 ? ' ft-connector-v--dash' : ''}`} />
                        </View>
                      )}
                      <Text className='ft-tree-row-title'>{row.title}</Text>
                      <View className='ft-tree-row'>
                        {row.ownerRoot ? (
                          /* 铲屎官根节点：无父母的宠物图谱顶部根，指向下方宠物 */
                          <View className='ft-node'>
                            <View className='ft-avatar-wrap'>
                              <View className='ft-avatar ft-avatar--owner'>
                                <Text className='ft-avatar-emoji'>🧑</Text>
                              </View>
                            </View>
                            <Text className='ft-node-name'>{user?.nickname || '铲屎官'}</Text>
                            <Text className='ft-node-role'>家长</Text>
                          </View>
                        ) : (
                          row.nodes.map(n => renderTreeNode(n))
                        )}
                      </View>
                    </View>
                  ))
                })()}
              </View>

              {/* 图例说明 */}
              <View className='ft-legend'>
                <View className='ft-legend__item'>
                  <View className='ft-legend__line ft-legend__line--solid' />
                  <Text className='ft-legend__text'>实线 · 血缘</Text>
                </View>
                <View className='ft-legend__item'>
                  <View className='ft-legend__line ft-legend__line--dash' />
                  <Text className='ft-legend__text'>虚线 · 非血缘</Text>
                </View>
              </View>
            </>
          )}
        </View>

        {/* ===== 家庭成员列表卡 ===== */}
        <View className='ft-card'>
          <View className='ft-card__section-title'>
            <Icon name='heart' size={18} tone='primary' />
            <Text>家庭成员</Text>
          </View>
          {nodes.length === 0 ? (
            <View className='family-tree__empty'>
              <Text className='family-tree__empty-text'>暂无成员</Text>
            </View>
          ) : (
            <View className='ft-member-list'>
              {nodes.map(n => (
                <View
                  key={n.pet_id}
                  className={`ft-member-row${n.pet_id === selPid ? ' ft-member-row--active' : ''}`}
                  onClick={() => loadLineage(n.pet_id)}
                >
                  <View className='ft-member-avatar'>
                    {n.avatar_url ? (
                      <Image src={n.avatar_url} className='ft-member-avatar-img' mode='aspectFill' />
                    ) : (
                      <Text className='ft-member-avatar-emoji'>{emoji(n.species)}</Text>
                    )}
                  </View>
                  <View className='ft-member-info'>
                    <Text className='ft-member-name'>{n.name}</Text>
                    <Text className='ft-member-rel'>{memberRelation[n.pet_id] || '家庭成员'}</Text>
                  </View>
                  {n.role && (
                    <View className='ft-member-role'>
                      <Text className='ft-member-role-text'>{n.role}</Text>
                    </View>
                  )}
                  <Text className='ft-member-arrow'>›</Text>
                </View>
              ))}
            </View>
          )}

          {/* 关系管理入口 */}
          <View className='ft-actions'>
            <View className='ft-action ft-action--primary' onClick={() => setShowRel(true)}>
              <Icon name='plus' size={18} tone='primary' />
            <Text className='ft-action__text'>添加关系</Text>
            </View>
            <View className='ft-action ft-action--outline' onClick={doSaveSnapshot}>
              <Text className='ft-action__text'>💾 保存快照</Text>
            </View>
          </View>
        </View>

        {/* ===== 家庭成员（人）卡：人节点 + 人关系（情侣/父女等，2026-08-24） ===== */}
        <View className='ft-card'>
          <Text className='ft-card__section-title'>👥 家庭成员（人）</Text>
          {familyUsers.length === 0 ? (
            <View className='family-tree__empty'>
              <Text className='family-tree__empty-text'>暂无家庭成员，邀请 TA 加入家庭后可设置关系</Text>
            </View>
          ) : (
            <>
              {/* 人节点列表 */}
              <View className='ft-user-list'>
                {familyUsers.map(u => (
                  <View key={u.id} className='ft-user-row'>
                    <View className='ft-user-avatar'>
                      <Text className='ft-user-avatar-text'>
                        {/* Array.from 按码点取首字符，避免 emoji 代理对被截坏 */}
                        {u.nickname ? Array.from(u.nickname)[0] : '👤'}
                      </Text>
                    </View>
                    <View className='ft-user-info'>
                      <Text className='ft-user-name'>{u.nickname || '成员'}</Text>
                    </View>
                    <View className={`ft-user-role${u.role === 'owner' ? ' ft-user-role--owner' : ''}`}>
                      <Text>{u.role === 'owner' ? '创建者' : '成员'}</Text>
                    </View>
                  </View>
                ))}
              </View>

              {/* 人关系列表 */}
              {familyRelations.length > 0 && (
                <View className='ft-rel-list'>
                  {familyRelations.map(r => (
                    <View key={r.id} className='ft-rel-row'>
                      <Text className='ft-rel-emoji'>{USER_REL_META[r.relationType]?.emoji || '💞'}</Text>
                      <Text className='ft-rel-text'>{describeUserRelation(r)}</Text>
                      {isFamilyOwner && (
                        <View className='ft-rel-remove' onClick={() => handleRemoveUserRelation(r.id)}>
                          <Text>✕</Text>
                        </View>
                      )}
                    </View>
                  ))}
                </View>
              )}

              {/* owner 可添加人关系 */}
              {isFamilyOwner && (
                <View className='ft-actions'>
                  <View className='ft-action ft-action--primary' onClick={() => setShowUserRel(true)}>
                    <Icon name='plus' size={18} tone='primary' />
            <Text className='ft-action__text'>添加成员关系</Text>
                  </View>
                </View>
              )}
            </>
          )}
        </View>

        <View className='family-tree__safe' />
      </View>

      {/* 添加关系面板 */}
      {showRel && (
        <>
          <View className='overlay' onClick={() => setShowRel(false)} />
          <View className='relation-panel'>
            <View className='relation-panel__header'>
              <Text className='relation-panel__title'>添加关系</Text>
              <Text className='relation-panel__close' onClick={() => setShowRel(false)}>✕</Text>
            </View>
            <View className='relation-panel__body'>
              <View className='relation-form__field'>
                <Text className='relation-form__label'>宠物 A</Text>
                <View className='relation-form__picker' onClick={() => pickPet('pet_id_a')}>
                  <Text className={rf.pet_id_a ? '' : 'relation-form__picker-placeholder'}>
                    {rf.pet_id_a ? nodes.find(n => n.pet_id === rf.pet_id_a)?.name || '已选择' : '请选择宠物 A'}
                  </Text>
                  <Text>›</Text>
                </View>
              </View>
              <View className='relation-form__field'>
                <Text className='relation-form__label'>宠物 B</Text>
                <View className='relation-form__picker' onClick={() => pickPet('pet_id_b')}>
                  <Text className={rf.pet_id_b ? '' : 'relation-form__picker-placeholder'}>
                    {rf.pet_id_b ? nodes.find(n => n.pet_id === rf.pet_id_b)?.name || '已选择' : '请选择宠物 B'}
                  </Text>
                  <Text>›</Text>
                </View>
              </View>
              <View className='relation-form__field'>
                <Text className='relation-form__label'>关系类型</Text>
                <View className='relation-form__type-list'>
                  {REL_TYPES.map(t => (
                    <View
                      key={t.value}
                      className={`relation-form__type-item ${rf.relation_type === t.value ? 'relation-form__type-item--active' : ''}`}
                      onClick={() => setRf(f => ({ ...f, relation_type: t.value }))}
                    >
                      <Text>{t.label}</Text>
                    </View>
                  ))}
                </View>
              </View>
              <View className='relation-form__submit' onClick={doCreateRel}>
                <Text>确认添加</Text>
              </View>
            </View>
          </View>
        </>
      )}

      {/* 添加成员（人）关系面板（2026-08-24）：选两人 + 8 种关系类型 */}
      {showUserRel && (
        <>
          <View className='overlay' onClick={() => setShowUserRel(false)} />
          <View className='relation-panel'>
            <View className='relation-panel__header'>
              <Text className='relation-panel__title'>添加成员关系</Text>
              <Text className='relation-panel__close' onClick={() => setShowUserRel(false)}>✕</Text>
            </View>
            <View className='relation-panel__body'>
              <View className='relation-form__field'>
                <Text className='relation-form__label'>成员 A</Text>
                <View className='relation-form__picker' onClick={() => pickUser('userIdA')}>
                  <Text className={userRelForm.userIdA ? '' : 'relation-form__picker-placeholder'}>
                    {userRelForm.userIdA ? familyUsers.find(u => u.userId === userRelForm.userIdA)?.nickname || '已选择' : '请选择成员 A'}
                  </Text>
                  <Text>›</Text>
                </View>
              </View>
              <View className='relation-form__field'>
                <Text className='relation-form__label'>成员 B</Text>
                <View className='relation-form__picker' onClick={() => pickUser('userIdB')}>
                  <Text className={userRelForm.userIdB ? '' : 'relation-form__picker-placeholder'}>
                    {userRelForm.userIdB ? familyUsers.find(u => u.userId === userRelForm.userIdB)?.nickname || '已选择' : '请选择成员 B'}
                  </Text>
                  <Text>›</Text>
                </View>
              </View>
              <View className='relation-form__field'>
                <Text className='relation-form__label'>关系类型</Text>
                <View className='relation-form__type-list'>
                  {(Object.keys(USER_REL_META) as FamilyUserRelationType[]).map(t => (
                    <View
                      key={t}
                      className={`relation-form__type-item ${userRelForm.relationType === t ? 'relation-form__type-item--active' : ''}`}
                      onClick={() => setUserRelForm(f => ({ ...f, relationType: t }))}
                    >
                      <Text>{USER_REL_META[t].emoji} {USER_REL_META[t].label}</Text>
                    </View>
                  ))}
                </View>
              </View>
              <View className='relation-form__submit' onClick={doCreateUserRelation}>
                <Text>确认添加</Text>
              </View>
            </View>
          </View>
        </>
      )}
    </View>
  )
}
