/**
 * 慢性病追踪页面
 * 宠物慢性病记录管理与追踪
 */
import { View, Text, ScrollView, Input, Textarea, Picker } from '@tarojs/components'
import Taro, { useDidShow } from '@tarojs/taro'
import { useEffect, useState, useCallback } from 'react'
import { useThemeClass } from '../../hooks/useThemeClass'
import { useAuthStore } from '../../stores/authStore'
import { usePetStore } from '../../stores/petStore'
import {
  getChronicRecords,
  addChronicRecord,
  updateChronicRecord,
  deleteChronicRecord,
  getChronicStats,
  getUpcomingCheckups,
  getChronicTrendData,
  getAiChronicAdvice,
  scanChronicRisk,
  getCachedRiskScan,
  saveCachedRiskScan,
  generateChronicReminderPayload,
  type ChronicRiskSignal,
} from '../../services/chronicService'
import { getSyncService } from '../../services/syncService'
import type { ChronicRecord, ChronicStats, ChronicTrendPoint, CheckupReminder } from '../../types/chronicTypes'
import { CHRONIC_COMMON_CONDITIONS, CHRONIC_SEVERITY_MAP, CHRONIC_STATUS_MAP } from '../../types/chronicTypes'
import MemberGate from '../../components/MemberGate'
import { useMemberGate } from '../../hooks/useMemberGate'
import './index.scss'
import { PageBackground, Icon  } from '../../components'

export default function ChronicTrackingPage() {
  const themeClass = useThemeClass()
  const user = useAuthStore(state => state.user)
  const { currentPet, pets, fetchPets } = usePetStore()
  const [records, setRecords] = useState<ChronicRecord[]>([])
  const [stats, setStats] = useState<ChronicStats>({ active: 0, managed: 0, resolved: 0, total: 0, overdueCheckups: 0 })
  const [upcomingCheckups, setUpcomingCheckups] = useState<CheckupReminder[]>([])
  const [trendData, setTrendData] = useState<ChronicTrendPoint[]>([])
  const [showAdd, setShowAdd] = useState(false)
  const [editingRecord, setEditingRecord] = useState<ChronicRecord | null>(null)
  const [activeTab, setActiveTab] = useState<'list' | 'trend' | 'reminders'>('list')
  const [syncing, setSyncing] = useState(false)
  const [syncStatus, setSyncStatus] = useState<'idle' | 'syncing' | 'synced' | 'error'>('idle')
  // AI 慢病管理分析状态
  const [aiLoading, setAiLoading] = useState(false)
  const [aiAdvice, setAiAdvice] = useState<string | null>(null)
  const [aiError, setAiError] = useState('')
  // 慢病风险扫描状态（L2 规则预警 + L3 AI 疑似识别）
  const [riskScanning, setRiskScanning] = useState(false)
  const [riskSignals, setRiskSignals] = useState<ChronicRiskSignal[]>([])
  const [riskAiInsight, setRiskAiInsight] = useState('')
  const [riskError, setRiskError] = useState('')

  const pet = currentPet || pets[0]

  // 会员门槛：慢性病追踪 为会员权益，非会员展示开通引导（PRD 7.3）
  // ⚠️ 注意：useMemberGate 的 allowed 初始为 null，异步判断后变为 true/false。
  // 若在这里（其他 hooks 之前）条件 return，allowed 变化会导致 hooks 数量不一致，
  // 触发 React error #300。因此会员门槛 return 统一放在组件底部所有 hooks 之后。
  const { allowed: memberAllowed } = useMemberGate('chronic_tracking')

  const loadData = useCallback(async () => {
    if (!pet || !user) return
    const petRecords = await getChronicRecords(pet.id, user.id)
    setRecords(petRecords)
    setStats(await getChronicStats(pet.id, user.id))
    setUpcomingCheckups(await getUpcomingCheckups(pet.id, user.id, 7))
    setTrendData(await getChronicTrendData(pet.id, user.id, 30))
  }, [pet, user])

  useDidShow(() => {
    if (user && !pets.length) {
      fetchPets(user.id)
    }
  })

  useEffect(() => {
    loadData()
  }, [loadData])

  const handleSync = async () => {
    if (!user) return
    setSyncing(true)
    setSyncStatus('syncing')
    try {
      const syncService = getSyncService(user.id)
      await syncService.syncAll()
      setSyncStatus('synced')
      setTimeout(() => setSyncStatus('idle'), 2000)
      loadData()
    } catch {
      setSyncStatus('error')
      setTimeout(() => setSyncStatus('idle'), 2000)
    } finally {
      setSyncing(false)
    }
  }

  /**
   * AI 慢病管理分析：后端从 pet_chronic_records 权威读取慢病数据，
   * 注入宠物档案/打卡/记忆后生成管理建议（会员专属）
   */
  const handleAiAnalyze = useCallback(async () => {
    if (!pet || aiLoading) return
    setAiLoading(true)
    setAiError('')
    try {
      const result = await getAiChronicAdvice(pet.id)
      if (!result) {
        setAiError('AI 分析暂时不可用，请稍后再试')
      } else if (result.unsafe) {
        setAiError('本次分析未通过安全校验，请稍后再试')
      } else {
        setAiAdvice(result.aiAdvice)
      }
    } catch {
      setAiError('AI 分析失败，请稍后再试')
    } finally {
      setAiLoading(false)
    }
  }, [pet, aiLoading])

  /**
   * 慢病风险扫描：L2 规则预警（打卡数据确定性规则）+ L3 AI 疑似识别。
   * 用于"发现"慢性病风险——从打卡数据主动提示疑似信号，仅"疑似/建议排查"。
   * @param silent - 自动扫描模式：使用缓存结果优先，失败静默不打扰
   */
  const handleRiskScan = useCallback(async (silent = false) => {
    if (!pet || riskScanning) return
    // 自动模式：有未过期缓存直接显示（避免每次进页面重复调 LLM）
    if (silent) {
      const cached = getCachedRiskScan(pet.id)
      if (cached) {
        setRiskSignals(cached.signals)
        setRiskAiInsight(cached.aiInsight)
        return
      }
    }
    setRiskScanning(true)
    if (!silent) setRiskError('')
    try {
      const result = await scanChronicRisk(pet.id)
      if (!result) {
        if (!silent) setRiskError('风险扫描暂时不可用，请稍后再试')
      } else if (result.unsafe) {
        if (!silent) setRiskError('本次风险分析未通过安全校验，请稍后再试')
      } else {
        setRiskSignals(result.signals)
        setRiskAiInsight(result.aiInsight)
        saveCachedRiskScan(pet.id, result)
      }
    } catch {
      if (!silent) setRiskError('风险扫描失败，请稍后再试')
    } finally {
      setRiskScanning(false)
    }
  }, [pet, riskScanning])

  // 自动追踪：进入页面自动扫描一次（有缓存直接显示；无缓存静默拉取）
  useEffect(() => {
    if (pet && memberAllowed !== false) {
      handleRiskScan(true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pet?.id, memberAllowed])

  const handleAdd = async (data: Omit<ChronicRecord, 'id' | 'petId' | 'createdAt' | 'updatedAt'>) => {
    if (!pet || !user) return
    await addChronicRecord(pet.id, user.id, data)
    setShowAdd(false)
    loadData()
    Taro.showToast({ title: '添加成功', icon: 'success' })
  }

  const handleUpdate = async (id: string, updates: Partial<ChronicRecord>) => {
    if (!pet || !user) return
    await updateChronicRecord(pet.id, user.id, id, updates)
    setEditingRecord(null)
    loadData()
    Taro.showToast({ title: '更新成功', icon: 'success' })
  }

  const handleDelete = (id: string) => {
    Taro.showModal({
      title: '确认删除',
      content: '确定要删除这条慢性病记录吗？',
      success: async (res) => {
        if (res.confirm && pet && user) {
          await deleteChronicRecord(pet.id, user.id, id)
          loadData()
          Taro.showToast({ title: '已删除', icon: 'success' })
        }
      },
    })
  }

  // ===== 以下均为条件渲染（所有 hooks 之后，保证 hooks 数量恒定） =====

  // 会员门槛：非会员展示开通引导（须在全部 hooks 之后 return，见上方注释）
  if (memberAllowed === false) {
    return <MemberGate featureName='慢性病追踪' />
  }

  if (!pet) {
    return (
      <View className='chronic-empty'>
        <PageBackground />
        <Text className='chronic-empty-text'>请先添加宠物</Text>
      </View>
    )
  }

  return (
    <ScrollView className={`chronic-page ${themeClass}`} scrollY>
      <View className='chronic-header'>
        <View className='chronic-header-top'>
          <View>
            <Text className='chronic-title'>慢性病追踪</Text>
            <Text className='chronic-subtitle'>{pet.name} 的健康档案</Text>
          </View>
          <View className='chronic-sync-btn' onClick={handleSync}>
            <Text className='chronic-sync-icon'>{syncing ? '⏳' : syncStatus === 'synced' ? '✅' : '☁️'}</Text>
          </View>
        </View>
      </View>

      <View className='chronic-summary'>
        <View className='chronic-summary-item'>
          <Text className='chronic-summary-number'>{stats.active}</Text>
          <Text className='chronic-summary-label'>活跃中</Text>
        </View>
        <View className='chronic-summary-item'>
          <Text className='chronic-summary-number'>{stats.managed}</Text>
          <Text className='chronic-summary-label'>已控制</Text>
        </View>
        <View className='chronic-summary-item'>
          <Text className='chronic-summary-number'>{stats.resolved}</Text>
          <Text className='chronic-summary-label'>已康复</Text>
        </View>
        <View className='chronic-summary-item'>
          <Text className={`chronic-summary-number ${stats.overdueCheckups > 0 ? 'chronic-summary-number--warn' : ''}`}>
            {stats.overdueCheckups}
          </Text>
          <Text className='chronic-summary-label'>逾期复查</Text>
        </View>
      </View>

      {stats.overdueCheckups > 0 && (
        <View className='chronic-alert'>
          <Icon name='warning' size={18} tone='primary' className='chronic-alert-icon' />
          <Text className='chronic-alert-text'>
            有 {stats.overdueCheckups} 项复查已逾期，请尽快安排
          </Text>
        </View>
      )}

      {/* ===== 慢病风险扫描卡片（L2 规则预警 + L3 AI 疑似识别，会员专属） ===== */}
      <View className='chronic-risk-card'>
        <View className='chronic-risk-head'>
          <View className='chronic-risk-icon'>🔍</View>
          <View className='chronic-risk-titles'>
            <Text className='chronic-risk-title'>
              慢病风险扫描
              {riskSignals.length > 0 && (
                <Text className='chronic-risk-alert-badge'>
                  {riskSignals.filter(s => s.level === 'alert').length > 0 ? '发现风险' : '有提示'}
                </Text>
              )}
            </Text>
            <Text className='chronic-risk-sub'>进入页面自动扫描，基于近 90 天打卡数据主动发现疑似风险</Text>
          </View>
        </View>

        {riskSignals.length > 0 && (
          <View className='chronic-risk-signals'>
            {riskSignals.map((signal, idx) => (
              <View key={idx} className={`chronic-risk-signal chronic-risk-signal--${signal.level}`}>
                <View className='chronic-risk-signal-head'>
                  <Text className='chronic-risk-signal-title'>
                    {signal.level === 'alert' ? '🚨' : signal.level === 'warning' ? '⚠️' : 'ℹ️'} {signal.title}
                  </Text>
                  <Text className='chronic-risk-signal-badge'>
                    {signal.level === 'alert' ? '需重视' : signal.level === 'warning' ? '建议关注' : '提示'}
                  </Text>
                </View>
                <Text className='chronic-risk-signal-detail'>{signal.detail}</Text>
                {signal.suggestedCondition && (
                  <Text className='chronic-risk-signal-suggest'>{signal.suggestedCondition}</Text>
                )}
              </View>
            ))}
          </View>
        )}

        {riskAiInsight ? (
          <Text className='chronic-risk-ai'>{riskAiInsight}</Text>
        ) : riskScanning ? (
          <Text className='chronic-risk-ai chronic-risk-ai--muted'>正在分析 {pet.name} 近 90 天的健康数据…</Text>
        ) : riskError ? (
          <Text className='chronic-risk-ai chronic-risk-ai--error'>{riskError}</Text>
        ) : (
          <Text className='chronic-risk-ai chronic-risk-ai--muted'>
            扫描打卡记录中的高风险频率、体重趋势与持续异常，AI 辅助判断是否疑似慢性病方向（仅提示，不诊断）。
          </Text>
        )}

        <View
          className={`chronic-risk-btn${riskScanning ? ' chronic-risk-btn--disabled' : ''}`}
          onClick={() => handleRiskScan(false)}
        >
          <Text>{riskScanning ? '扫描中…' : riskSignals.length > 0 || riskAiInsight ? '重新扫描' : '立即扫描'}</Text>
        </View>
      </View>

      {/* ===== AI 慢病管理分析卡片（会员专属，后端注入档案/打卡/记忆） ===== */}
      <View className='chronic-ai-card'>
        <View className='chronic-ai-head'>
          <View className='chronic-ai-icon'>✨</View>
          <View className='chronic-ai-titles'>
            <Text className='chronic-ai-title'>AI 慢病管理建议</Text>
            <Text className='chronic-ai-sub'>结合慢病记录、健康打卡与历史记忆生成</Text>
          </View>
        </View>
        {aiAdvice ? (
          <Text className='chronic-ai-text'>{aiAdvice}</Text>
        ) : aiLoading ? (
          <Text className='chronic-ai-text chronic-ai-text--muted'>AI 正在分析 {pet.name} 的慢病管理情况…</Text>
        ) : aiError ? (
          <Text className='chronic-ai-text chronic-ai-text--error'>{aiError}</Text>
        ) : (
          <Text className='chronic-ai-text chronic-ai-text--muted'>
            点击下方按钮，AI 将结合慢性病记录与近期打卡给出日常护理、复查提醒等管理建议。
          </Text>
        )}
        <View
          className={`chronic-ai-btn${aiLoading ? ' chronic-ai-btn--disabled' : ''}`}
          onClick={handleAiAnalyze}
        >
          <Text>{aiLoading ? '生成中…' : aiAdvice ? '重新生成' : '生成 AI 管理建议'}</Text>
        </View>
      </View>

      <View className='chronic-tabs'>
        {(['list', 'trend', 'reminders'] as const).map(tab => (
          <View
            key={tab}
            className={`chronic-tab ${activeTab === tab ? 'chronic-tab--active' : ''}`}
            onClick={() => setActiveTab(tab)}
          >
            <Text>{tab === 'list' ? '记录' : tab === 'trend' ? '趋势' : '提醒'}</Text>
          </View>
        ))}
      </View>

      <View className='chronic-actions'>
        <View className='chronic-add-btn' onClick={() => setShowAdd(true)}>
          <Text className='chronic-add-icon'>+</Text>
          <Text>添加记录</Text>
        </View>
      </View>

      {activeTab === 'list' && (
        <View className='chronic-content'>
          {records.length === 0 && (
            <View className='chronic-empty-state'>
              <Icon name='stethoscope' size={48} tone='primary' className='chronic-empty-icon' />
              <Text className='chronic-empty-title'>暂无慢性病记录</Text>
              <Text className='chronic-empty-hint'>点击上方按钮添加宠物的慢性病信息</Text>
            </View>
          )}

          {records.map(record => (
            <ChronicRecordCard
              key={record.id}
              record={record}
              onUpdate={handleUpdate}
              onDelete={handleDelete}
              onEdit={setEditingRecord}
            />
          ))}
        </View>
      )}

      {activeTab === 'trend' && (
        <View className='chronic-content'>
          <ChronicTrendChart data={trendData} records={records} />
        </View>
      )}

      {activeTab === 'reminders' && (
        <View className='chronic-content'>
          <ChronicReminders
            upcoming={upcomingCheckups}
            petName={pet.name}
            onRecordClick={(record) => {
              setActiveTab('list')
            }}
          />
        </View>
      )}

      {showAdd && (
        <ChronicFormModal
          mode='add'
          onSubmit={handleAdd}
          onClose={() => setShowAdd(false)}
        />
      )}

      {editingRecord && (
        <ChronicFormModal
          mode='edit'
          record={editingRecord}
          onSubmit={(data) => handleUpdate(editingRecord.id, data)}
          onClose={() => setEditingRecord(null)}
        />
      )}

      <View className='chronic-bottom-safe' />
    </ScrollView>
  )
}

function ChronicRecordCard({
  record,
  onUpdate,
  onDelete,
  onEdit,
}: {
  record: ChronicRecord
  onUpdate: (id: string, updates: Partial<ChronicRecord>) => void
  onDelete: (id: string) => void
  onEdit: (record: ChronicRecord) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const isOverdue = record.nextCheckupDate && new Date(record.nextCheckupDate) < new Date() && record.status !== 'resolved'

  return (
    <View className='chronic-card'>
      <View className='chronic-card-header' onClick={() => setExpanded(!expanded)}>
        <View className='chronic-card-main'>
          <View className='chronic-card-title-row'>
            <Text className='chronic-card-title'>{record.condition}</Text>
            {isOverdue && <Text className='chronic-card-overdue-badge'>逾期</Text>}
          </View>
          <View className='chronic-card-tags'>
            <Text
              className='chronic-card-tag'
              style={{ backgroundColor: CHRONIC_SEVERITY_MAP[record.severity].color + '20', color: CHRONIC_SEVERITY_MAP[record.severity].color }}
            >
              {CHRONIC_SEVERITY_MAP[record.severity].label}
            </Text>
            <Text className='chronic-card-tag' style={{ backgroundColor: CHRONIC_STATUS_MAP[record.status].color + '20', color: CHRONIC_STATUS_MAP[record.status].color }}>
              {CHRONIC_STATUS_MAP[record.status].label}
            </Text>
          </View>
        </View>
        <Text className='chronic-card-arrow'>{expanded ? '▼' : '▶'}</Text>
      </View>

      {expanded && (
        <View className='chronic-card-body'>
          <View className='chronic-card-row'>
            <Text className='chronic-card-label'>确诊日期</Text>
            <Text className='chronic-card-value'>{record.diagnosedDate}</Text>
          </View>
          <View className='chronic-card-row'>
            <Text className='chronic-card-label'>主治医生</Text>
            <Text className='chronic-card-value'>{record.vetName || '未填写'}</Text>
          </View>
          {record.vetContact && (
            <View className='chronic-card-row'>
              <Text className='chronic-card-label'>联系方式</Text>
              <Text className='chronic-card-value'>{record.vetContact}</Text>
            </View>
          )}
          <View className='chronic-card-row'>
            <Text className='chronic-card-label'>用药</Text>
            <Text className='chronic-card-value'>
              {record.medications.length > 0 ? record.medications.join('、') : '无'}
            </Text>
          </View>
          <View className='chronic-card-row'>
            <Text className='chronic-card-label'>症状</Text>
            <Text className='chronic-card-value'>
              {record.symptoms.length > 0 ? record.symptoms.join('、') : '无'}
            </Text>
          </View>
          <View className='chronic-card-row'>
            <Text className='chronic-card-label'>下次复查</Text>
            <Text className={`chronic-card-value ${isOverdue ? 'chronic-card-overdue' : ''}`}>
              {record.nextCheckupDate || '未设置'}
              {isOverdue && ' (已逾期)'}
            </Text>
          </View>
          {record.notes && (
            <View className='chronic-card-row'>
              <Text className='chronic-card-label'>备注</Text>
              <Text className='chronic-card-value'>{record.notes}</Text>
            </View>
          )}

          <View className='chronic-card-actions'>
            <View
              className='chronic-card-btn chronic-card-btn-primary'
              onClick={() => onUpdate(record.id, { status: record.status === 'active' ? 'managed' : 'active' })}
            >
              <Text>{record.status === 'active' ? '标记为已控制' : '标记为活跃'}</Text>
            </View>
            <View className='chronic-card-btn chronic-card-btn-edit' onClick={() => onEdit(record)}>
              <Text>编辑</Text>
            </View>
            <View className='chronic-card-btn chronic-card-btn-danger' onClick={() => onDelete(record.id)}>
              <Text>删除</Text>
            </View>
          </View>
        </View>
      )}
    </View>
  )
}

function ChronicTrendChart({
  data,
  records,
}: {
  data: ChronicTrendPoint[]
  records: ChronicRecord[]
}) {
  if (records.length === 0) {
    return (
      <View className='chronic-empty-state'>
        <Icon name='chart-line' size={48} tone='primary' className='chronic-empty-icon' />
        <Text className='chronic-empty-title'>暂无趋势数据</Text>
        <Text className='chronic-empty-hint'>添加慢性病记录后将展示健康趋势</Text>
      </View>
    )
  }

  const maxConditions = Math.max(1, ...data.map(d => d.conditions.length))
  const activeConditions = records.filter(r => r.status !== 'resolved').map(r => r.condition)
  const uniqueConditions = [...new Set(activeConditions)]

  return (
    <View className='chronic-trend'>
      <View className='chronic-trend-header'>
        <Text className='chronic-trend-title'>30天疾病活跃趋势</Text>
        <Text className='chronic-trend-subtitle'>每日活跃疾病数量变化</Text>
      </View>

      <View className='chronic-trend-chart'>
        <View className='chronic-trend-y-axis'>
          {[maxConditions, Math.ceil(maxConditions * 0.75), Math.ceil(maxConditions * 0.5), Math.ceil(maxConditions * 0.25), 0].map(v => (
            <Text key={v} className='chronic-trend-y-label'>{v}</Text>
          ))}
        </View>

        <ScrollView className='chronic-trend-canvas' scrollX>
          <View className='chronic-trend-bars' style={{ width: `${data.length * 12}px` }}>
            {data.map((point, index) => {
              const height = maxConditions > 0 ? (point.conditions.length / maxConditions) * 100 : 0
              const hasSevere = point.severityCounts.severe > 0
              const hasModerate = point.severityCounts.moderate > 0

              let barColor = '#52c41a'
              if (hasSevere) barColor = '#f5222d'
              else if (hasModerate) barColor = '#faad14'

              const showLabel = index % 5 === 0 || point.conditions.length > 0

              return (
                <View key={point.date} className='chronic-trend-bar-wrap'>
                  <View className='chronic-trend-bar-bg'>
                    <View
                      className='chronic-trend-bar'
                      style={{
                        height: `${Math.max(height, point.conditions.length > 0 ? 8 : 2)}%`,
                        backgroundColor: barColor,
                      }}
                    />
                  </View>
                  {showLabel && (
                    <Text className='chronic-trend-bar-label'>
                      {point.date.slice(5)}
                    </Text>
                  )}
                </View>
              )
            })}
          </View>
        </ScrollView>
      </View>

      <View className='chronic-trend-legend'>
        <View className='chronic-trend-legend-item'>
          <View className='chronic-trend-legend-dot' style={{ backgroundColor: '#f5222d' }} />
          <Text className='chronic-trend-legend-text'>含重度</Text>
        </View>
        <View className='chronic-trend-legend-item'>
          <View className='chronic-trend-legend-dot' style={{ backgroundColor: '#faad14' }} />
          <Text className='chronic-trend-legend-text'>含中度</Text>
        </View>
        <View className='chronic-trend-legend-item'>
          <View className='chronic-trend-legend-dot' style={{ backgroundColor: '#52c41a' }} />
          <Text className='chronic-trend-legend-text'>仅轻度</Text>
        </View>
      </View>

      {uniqueConditions.length > 0 && (
        <View className='chronic-trend-conditions'>
          <Text className='chronic-trend-conditions-title'>当前活跃疾病：</Text>
          <View className='chronic-trend-conditions-list'>
            {uniqueConditions.map(condition => (
              <View key={condition} className='chronic-trend-condition-tag'>
                <Text className='chronic-trend-condition-text'>{condition}</Text>
              </View>
            ))}
          </View>
        </View>
      )}
    </View>
  )
}

function ChronicReminders({
  upcoming,
  petName,
}: {
  upcoming: CheckupReminder[]
  petName: string
  onRecordClick: (record: ChronicRecord) => void
}) {
  if (upcoming.length === 0) {
    return (
      <View className='chronic-empty-state'>
        <Icon name='calendar-check' size={48} tone='primary' className='chronic-empty-icon' />
        <Text className='chronic-empty-title'>暂无提醒</Text>
        <Text className='chronic-empty-hint'>未来7天没有待复查项目，太棒了！</Text>
      </View>
    )
  }

  const overdue = upcoming.filter(u => u.isOverdue)
  const upcomingList = upcoming.filter(u => !u.isOverdue)

  return (
    <View className='chronic-reminders'>
      {overdue.length > 0 && (
        <View className='chronic-reminders-section'>
          <View className='chronic-reminders-section-header'>
            <Icon name='warning' size={16} tone='primary' className='chronic-reminders-section-icon' />
            <Text className='chronic-reminders-section-title'>已逾期 ({overdue.length})</Text>
          </View>
          {overdue.map(item => {
            const payload = generateChronicReminderPayload(item.record, petName, item.daysUntil)
            return (
              <View key={item.record.id} className='chronic-reminder-card chronic-reminder-card--urgent'>
                <View className='chronic-reminder-badge'>
                  <Text className='chronic-reminder-badge-text'>逾期 {Math.abs(item.daysUntil)} 天</Text>
                </View>
                <View className='chronic-reminder-body'>
                  <Text className='chronic-reminder-condition'>{item.record.condition}</Text>
                  <Text className='chronic-reminder-date'>应于 {item.record.nextCheckupDate} 复查</Text>
                  {item.record.vetName && (
                    <Text className='chronic-reminder-vet'>医生：{item.record.vetName}</Text>
                  )}
                </View>
              </View>
            )
          })}
        </View>
      )}

      {upcomingList.length > 0 && (
        <View className='chronic-reminders-section'>
          <View className='chronic-reminders-section-header'>
            <Icon name='calendar-check' size={16} tone='primary' className='chronic-reminders-section-icon' />
            <Text className='chronic-reminders-section-title'>即将到期 ({upcomingList.length})</Text>
          </View>
          {upcomingList.map(item => {
            const payload = generateChronicReminderPayload(item.record, petName, item.daysUntil)
            return (
              <View key={item.record.id} className={`chronic-reminder-card ${item.daysUntil <= 3 ? 'chronic-reminder-card--soon' : ''}`}>
                <View className={`chronic-reminder-badge ${item.daysUntil <= 3 ? 'chronic-reminder-badge--soon' : ''}`}>
                  <Text className='chronic-reminder-badge-text'>
                    {item.daysUntil === 0 ? '今天' : `${item.daysUntil} 天后`}
                  </Text>
                </View>
                <View className='chronic-reminder-body'>
                  <Text className='chronic-reminder-condition'>{item.record.condition}</Text>
                  <Text className='chronic-reminder-date'>复查日期：{item.record.nextCheckupDate}</Text>
                  {item.record.vetName && (
                    <Text className='chronic-reminder-vet'>医生：{item.record.vetName}</Text>
                  )}
                </View>
              </View>
            )
          })}
        </View>
      )}
    </View>
  )
}

function ChronicFormModal({
  mode,
  record,
  onSubmit,
  onClose,
}: {
  mode: 'add' | 'edit'
  record?: ChronicRecord
  onSubmit: (data: Omit<ChronicRecord, 'id' | 'petId' | 'createdAt' | 'updatedAt'>) => void
  onClose: () => void
}) {
  const [form, setForm] = useState({
    condition: record?.condition || '',
    diagnosedDate: record?.diagnosedDate || '',
    severity: record?.severity || 'mild' as 'mild' | 'moderate' | 'severe',
    status: record?.status || 'active' as 'active' | 'managed' | 'resolved',
    medications: record?.medications?.join('、') || '',
    vetName: record?.vetName || '',
    vetContact: record?.vetContact || '',
    nextCheckupDate: record?.nextCheckupDate || '',
    notes: record?.notes || '',
    symptoms: record?.symptoms?.join('、') || '',
  })

  const [showConditionPicker, setShowConditionPicker] = useState(false)

  const handleDateChange = (field: string) => (e: { detail: { value: string } }) => {
    setForm({ ...form, [field]: e.detail.value })
  }

  const handleInput = (field: string) => (e: { detail: { value: string } }) => {
    setForm({ ...form, [field]: e.detail.value })
  }

  const handleSelectCondition = (condition: string) => {
    setForm({ ...form, condition })
    setShowConditionPicker(false)
  }

  const handleSubmit = () => {
    if (!form.condition.trim()) {
      Taro.showToast({ title: '请输入疾病名称', icon: 'none' })
      return
    }
    if (!form.diagnosedDate) {
      Taro.showToast({ title: '请选择确诊日期', icon: 'none' })
      return
    }

    onSubmit({
      condition: form.condition.trim(),
      diagnosedDate: form.diagnosedDate,
      severity: form.severity,
      status: form.status,
      medications: form.medications.split(/[,，、]/).map(s => s.trim()).filter(Boolean),
      vetName: form.vetName.trim(),
      vetContact: form.vetContact.trim(),
      nextCheckupDate: form.nextCheckupDate,
      notes: form.notes.trim(),
      symptoms: form.symptoms.split(/[,，、]/).map(s => s.trim()).filter(Boolean),
    })
  }

  return (
    <View className='chronic-modal-overlay' onClick={onClose}>
      <View className='chronic-modal' onClick={e => e.stopPropagation()}>
        <View className='chronic-modal-header'>
          <Text className='chronic-modal-title'>{mode === 'add' ? '添加慢性病记录' : '编辑慢性病记录'}</Text>
          <Text className='chronic-modal-close' onClick={onClose}>×</Text>
        </View>

        <ScrollView className='chronic-modal-body' scrollY>
          <View className='chronic-form-group'>
            <Text className='chronic-form-label'>疾病名称 *</Text>
            <View className='chronic-form-condition-input'>
              <Input
                className='chronic-form-input chronic-form-input--condition'
                placeholder='如：慢性肾病、心脏病等'
                value={form.condition}
                onInput={handleInput('condition')}
                onFocus={() => setShowConditionPicker(true)}
              />
              <View className='chronic-form-condition-toggle' onClick={() => setShowConditionPicker(!showConditionPicker)}>
                <Text>{showConditionPicker ? '▲' : '▼'}</Text>
              </View>
            </View>
            {showConditionPicker && (
              <View className='chronic-condition-picker'>
                {CHRONIC_COMMON_CONDITIONS.map(c => (
                  <View
                    key={c}
                    className={`chronic-condition-option ${form.condition === c ? 'chronic-condition-option--active' : ''}`}
                    onClick={() => handleSelectCondition(c)}
                  >
                    <Text>{c}</Text>
                  </View>
                ))}
              </View>
            )}
          </View>

          <View className='chronic-form-group'>
            <Text className='chronic-form-label'>确诊日期 *</Text>
            <Picker mode='date' value={form.diagnosedDate} onChange={handleDateChange('diagnosedDate') as (e: unknown) => void}>
              <View className='chronic-form-picker'>
                <Text>{form.diagnosedDate || '请选择日期'}</Text>
              </View>
            </Picker>
          </View>

          <View className='chronic-form-group'>
            <Text className='chronic-form-label'>严重程度</Text>
            <View className='chronic-form-severity'>
              {(['mild', 'moderate', 'severe'] as const).map(s => (
                <View
                  key={s}
                  className={`chronic-severity-option ${form.severity === s ? 'chronic-severity-active' : ''}`}
                  style={form.severity === s ? { backgroundColor: CHRONIC_SEVERITY_MAP[s].color, borderColor: CHRONIC_SEVERITY_MAP[s].color } : {}}
                  onClick={() => setForm({ ...form, severity: s })}
                >
                  <Text>{CHRONIC_SEVERITY_MAP[s].label}</Text>
                </View>
              ))}
            </View>
          </View>

          <View className='chronic-form-group'>
            <Text className='chronic-form-label'>状态</Text>
            <View className='chronic-form-severity'>
              {(['active', 'managed', 'resolved'] as const).map(s => (
                <View
                  key={s}
                  className={`chronic-severity-option ${form.status === s ? 'chronic-severity-active' : ''}`}
                  style={form.status === s ? { backgroundColor: CHRONIC_STATUS_MAP[s].color, borderColor: CHRONIC_STATUS_MAP[s].color } : {}}
                  onClick={() => setForm({ ...form, status: s })}
                >
                  <Text>{CHRONIC_STATUS_MAP[s].label}</Text>
                </View>
              ))}
            </View>
          </View>

          <View className='chronic-form-group'>
            <Text className='chronic-form-label'>主治医生</Text>
            <Input
              className='chronic-form-input'
              placeholder='医生姓名'
              value={form.vetName}
              onInput={handleInput('vetName')}
            />
          </View>

          <View className='chronic-form-group'>
            <Text className='chronic-form-label'>联系方式</Text>
            <Input
              className='chronic-form-input'
              placeholder='电话或微信'
              value={form.vetContact}
              onInput={handleInput('vetContact')}
            />
          </View>

          <View className='chronic-form-group'>
            <Text className='chronic-form-label'>用药（用逗号分隔）</Text>
            <Input
              className='chronic-form-input'
              placeholder='如：贝那普利、塞米'
              value={form.medications}
              onInput={handleInput('medications')}
            />
          </View>

          <View className='chronic-form-group'>
            <Text className='chronic-form-label'>症状（用逗号分隔）</Text>
            <Input
              className='chronic-form-input'
              placeholder='如：多饮多尿、食欲下降'
              value={form.symptoms}
              onInput={handleInput('symptoms')}
            />
          </View>

          <View className='chronic-form-group'>
            <Text className='chronic-form-label'>下次复查日期</Text>
            <Picker mode='date' value={form.nextCheckupDate} onChange={handleDateChange('nextCheckupDate') as (e: unknown) => void}>
              <View className='chronic-form-picker'>
                <Text>{form.nextCheckupDate || '请选择日期'}</Text>
              </View>
            </Picker>
          </View>

          <View className='chronic-form-group'>
            <Text className='chronic-form-label'>备注</Text>
            <Textarea
              className='chronic-form-textarea'
              placeholder='其他需要记录的信息'
              value={form.notes}
              onInput={handleInput('notes')}
            />
          </View>
        </ScrollView>

        <View className='chronic-modal-footer'>
          <View className='chronic-modal-btn chronic-modal-btn-cancel' onClick={onClose}>
            <Text>取消</Text>
          </View>
          <View className='chronic-modal-btn chronic-modal-btn-confirm' onClick={handleSubmit}>
            <Text>保存</Text>
          </View>
        </View>
      </View>
    </View>
  )
}