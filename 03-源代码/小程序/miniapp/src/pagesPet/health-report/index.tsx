/**
 * 健康报告页面（按高保真原型 1:1 新建）
 * 报告头部 → 健康总览（评分环+四指标）→ 食欲趋势 → 异常记录 → 用药史 → 导出/分享
 * 业务接回：healthReportPdfService（生成报告数据 + 导出 PDF + 分享兽医）
 */
import { View, Text, Image } from '@tarojs/components'
import { useState, useCallback, useEffect, useMemo } from 'react'
import Taro from '@tarojs/taro'
import { useThemeClass } from '../../hooks/useThemeClass'
import { formatPetAge } from '../../utils/date'
import { useAuthStore } from '../../stores/authStore'
import { usePetStore } from '../../stores/petStore'
import {
  generateHealthReportData,
  downloadHealthReport,
  shareReportToVet,
} from '../services/healthReportPdfService'
import type { HealthReportData } from '../../types/reportTypes'
import MemberGate from '../../components/MemberGate'
import { useMemberGate } from '../../hooks/useMemberGate'
import './index.scss'
import { PageBackground, Icon  } from '../../components'

/** 食欲值 → 5 级 */
function appetiteLevel(v: string): number {
  if (v === 'good' || v === 'increased') return 5
  if (v === 'normal') return 4
  if (v === 'decreased') return 2
  if (v === 'none') return 1
  return 3
}

/** 指标是否正常 */
function isNormal(v: string): boolean {
  return v === 'normal' || v === 'good' || v === 'increased' || v === 'high'
}

/** 格式化日期：2026-07-01 → 7/1 */
function shortDate(dateStr: string): string {
  const m = dateStr.slice(5, 7).replace(/^0/, '')
  const d = dateStr.slice(8, 10).replace(/^0/, '')
  return `${m}/${d}`
}

/**
 * 年龄文案已收敛到 utils/date 的 formatPetAge（2026-09-11）
 * 本页原实现只精确到「岁」（1岁3个月会显示成「1岁」），且格式与别页不统一。
 */

export default function HealthReportPage() {
  const themeClass = useThemeClass()
  const user = useAuthStore(s => s.user)
  const { currentPet } = usePetStore()

  const [report, setReport] = useState<HealthReportData | null>(null)
  const [loading, setLoading] = useState(true)

  const petId = currentPet?.id || ''

  // 会员门槛：健康报告导出 为会员权益，非会员展示开通引导（PRD 7.3）
  // ⚠️ 注意：useMemberGate 的 allowed 初始为 null，异步判断后变为 true/false。
  // 若在这里（其他 hooks 之前）条件 return，allowed 变化会导致 hooks 数量不一致，
  // 触发 React error #300。因此会员门槛 return 统一放在组件底部所有 hooks 之后。
  const { allowed: memberAllowed } = useMemberGate('health_report')

  useEffect(() => {
    if (!user?.id || !petId) {
      setLoading(false)
      return
    }
    let cancelled = false
    generateHealthReportData(user.id, petId)
      .then((data) => {
        if (!cancelled) setReport(data)
      })
      .catch(() => {
        // 加载失败静默处理，保留空态
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [user?.id, petId])

  /** 健康评分：100 - 异常占比加权 */
  const score = useMemo(() => {
    if (!report || report.entries.length === 0) return 100
    let anomalyDays = 0
    for (const e of report.entries) {
      if (!isNormal(e.bowel) || !isNormal(e.appetite) || !isNormal(e.energy) || !isNormal(e.exercise)) {
        anomalyDays++
      }
    }
    const rate = anomalyDays / report.entries.length
    return Math.max(0, Math.round(100 - rate * 40))
  }, [report])

  /** 四指标最新状态 */
  const metrics = useMemo(() => {
    const last = report?.entries[report.entries.length - 1]
    if (!last) {
      return [
        { name: '便便', status: '暂无', ok: true, icon: '💩' },
        { name: '食欲', status: '暂无', ok: true, icon: '🍽️' },
        { name: '精神', status: '暂无', ok: true, icon: '😊' },
        { name: '运动', status: '暂无', ok: true, icon: '🐾' },
      ]
    }
    return [
      { name: '便便', status: isNormal(last.bowel) ? '正常' : '需关注', ok: isNormal(last.bowel), icon: '💩' },
      { name: '食欲', status: isNormal(last.appetite) ? '正常' : '需关注', ok: isNormal(last.appetite), icon: '🍽️' },
      { name: '精神', status: isNormal(last.energy) ? '正常' : '需关注', ok: isNormal(last.energy), icon: '😊' },
      { name: '运动', status: isNormal(last.exercise) ? '正常' : '需关注', ok: isNormal(last.exercise), icon: '🐾' },
    ]
  }, [report])

  /** 近 7 天食欲柱状 */
  const appetiteBars = useMemo(() => {
    const recent = (report?.entries || []).slice(-7)
    return recent.map(e => ({
      date: shortDate(e.date),
      level: appetiteLevel(e.appetite),
      warn: !isNormal(e.appetite),
    }))
  }, [report])

  /** 异常记录 */
  const anomalies = useMemo(() => report?.symptoms || [], [report])

  /** 用药史（疫苗记录） */
  const meds = useMemo(() => report?.vaccines || [], [report])

  const handleExportPdf = useCallback(async () => {
    if (!report || !petId || !user?.id) {
      Taro.showToast({ title: '报告尚未生成', icon: 'none' })
      return
    }
    try {
      const data = report
      await downloadHealthReport(data, report.pet.name || '我的宠物')
    } catch {
      Taro.showToast({ title: '导出失败，请重试', icon: 'none' })
    }
  }, [report, petId, user?.id])

  const handleShareVet = useCallback(async () => {
    if (!report || !user?.id) {
      Taro.showToast({ title: '报告尚未生成', icon: 'none' })
      return
    }
    try {
      await shareReportToVet(report, report.pet.name || '我的宠物')
    } catch {
      Taro.showToast({ title: '分享失败，请重试', icon: 'none' })
    }
  }, [report, user?.id])

  const petName = report?.pet.name || currentPet?.name || '毛孩子'
  const petMeta = useMemo(() => {
    if (!report) return ''
    const { breed, birthDate, weight } = report.pet
    const age = formatPetAge(birthDate, { fallback: '年龄未知' })
    return `${breed || '未知品种'} · ${age} · ${weight ? `${weight}kg` : '体重未知'}`
  }, [report])

  // ===== 以下均为条件渲染（所有 hooks 之后，保证 hooks 数量恒定） =====

  // 会员门槛：非会员展示开通引导（须在全部 hooks 之后 return，见上方注释）
  if (memberAllowed === false) {
    return <MemberGate featureName='健康报告导出' />
  }

  return (
    <View className={`health-report ${themeClass}`}>
      <PageBackground />
      {/* 1. 报告头部 */}
      <View className='xhh-card hr-card'>
        <View className='hr-card__head'>
          <View className='hr-card__avatar'>
            {report?.pet.photoUrl ? (
              <Image className='hr-card__avatar-img' src={report.pet.photoUrl} mode='aspectFill' />
            ) : (
              <Text className='hr-card__avatar-emoji'>{report?.pet.species === 'cat' ? '🐱' : '🐶'}</Text>
            )}
          </View>
          <View className='hr-card__titles'>
            <Text className='hr-card__name'>{petName}</Text>
            <Text className='hr-card__meta'>{petMeta}</Text>
          </View>
          <View className='hr-card__pill hr-card__pill--coral'>
            <Text className='hr-card__pill-text'>健康报告</Text>
          </View>
        </View>
        <View className='hr-card__rows'>
          <View className='hr-card__row'>
            <Icon name='calendar-check' size={16} tone='muted' className='hr-card__row-icon' />
            <Text className='hr-card__row-text'>
              报告周期 <Text className='hr-card__row-bold'>{report?.period || '--'}</Text>
            </Text>
          </View>
          <View className='hr-card__row'>
            <Text className='hr-card__row-icon'>⏰</Text>
            <Text className='hr-card__row-text'>
              生成时间 <Text className='hr-card__row-bold'>{report ? shortDate(report.generatedAt.slice(0, 10)) + ' 生成' : '--'}</Text>
            </Text>
          </View>
        </View>
      </View>

      {/* 2. 健康总览 */}
      <View className='xhh-card hr-card'>
        <View className='hr-card__section-head'>
          <View className='hr-card__ico hr-card__ico--coral'>❤️</View>
          <View className='hr-card__section-titles'>
            <Text className='hr-card__section-title'>健康总览</Text>
            <Text className='hr-card__section-sub'>基于 {report?.entries.length || 0} 天打卡数据</Text>
          </View>
          <View className='hr-card__pill hr-card__pill--success'>
            <Text className='hr-card__pill-text'>整体{score >= 80 ? '良好' : score >= 60 ? '尚可' : '需关注'}</Text>
          </View>
        </View>
        <View className='hr-overview'>
          <View className='hr-score'>
            <View className={`hr-score__ring ${score >= 80 ? 'hr-score__ring--good' : score >= 60 ? 'hr-score__ring--warn' : 'hr-score__ring--bad'}`}>
              <Text className='hr-score__num'>{score}</Text>
            </View>
            <Text className='hr-score__label'>健康评分</Text>
          </View>
          <View className='hr-metrics'>
            {metrics.map(m => (
              <View key={m.name} className='hr-metric'>
                <View className={`hr-metric__icon ${m.ok ? 'hr-metric__icon--ok' : 'hr-metric__icon--warn'}`}>
                  <Text>{m.icon}</Text>
                </View>
                <Text className='hr-metric__name'>{m.name}</Text>
                <Text className={`hr-metric__status ${m.ok ? 'hr-metric__status--ok' : 'hr-metric__status--warn'}`}>{m.status}</Text>
              </View>
            ))}
          </View>
        </View>
      </View>

      {/* 3. 食欲趋势 */}
      <View className='xhh-card hr-card'>
        <View className='hr-card__section-head'>
          <View className='hr-card__ico hr-card__ico--gold'>🍽️</View>
          <View className='hr-card__section-titles'>
            <Text className='hr-card__section-title'>食欲趋势</Text>
            <Text className='hr-card__section-sub'>近 7 天 · 5 级制</Text>
          </View>
          {appetiteBars.some(b => b.warn) && (
            <View className='hr-card__pill hr-card__pill--warn'>
              <Text className='hr-card__pill-text'>需关注</Text>
            </View>
          )}
        </View>
        <View className='hr-bars'>
          {appetiteBars.map((bar, i) => (
            <View key={i} className='hr-bar-col'>
              <Text className='hr-bar__val'>{bar.level}</Text>
              <View className='hr-bar-track'>
                <View
                  className={`hr-bar ${bar.warn ? 'hr-bar--warn' : ''}`}
                  style={{ height: `${(bar.level / 5) * 100}%` }}
                />
              </View>
              <Text className='hr-bar__date'>{bar.date}</Text>
            </View>
          ))}
          {appetiteBars.length === 0 && (
            <Text className='hr-empty'>暂无食欲打卡数据</Text>
          )}
        </View>
        <View className='hr-legend'>
          <View className='hr-legend__item'>
            <View className='hr-legend__dot hr-legend__dot--ok' />
            <Text className='hr-legend__text'>正常（4-5 级）</Text>
          </View>
          <View className='hr-legend__item'>
            <View className='hr-legend__dot hr-legend__dot--warn' />
            <Text className='hr-legend__text'>需关注（≤3 级）</Text>
          </View>
        </View>
      </View>

      {/* 4. 异常记录 */}
      <View className='xhh-card hr-card'>
        <View className='hr-card__section-head'>
          <View className='hr-card__ico hr-card__ico--warn'>⚠️</View>
          <View className='hr-card__section-titles'>
            <Text className='hr-card__section-title'>异常记录</Text>
            <Text className='hr-card__section-sub'>近期 {anomalies.length} 条待关注</Text>
          </View>
          <View className='hr-card__pill hr-card__pill--warn'>
            <Text className='hr-card__pill-text'>{anomalies.length} 条</Text>
          </View>
        </View>
        <View className='hr-anomalies'>
          {anomalies.map((a, i) => (
            <View key={i} className='hr-anomaly'>
              <View className='hr-anomaly__head'>
                <Text className='hr-anomaly__date'>{shortDate(a.date)}</Text>
                <View className={`hr-pill-sm ${a.urgencyLevel === 'high' || a.urgencyLevel === 'emergency' ? 'hr-pill-sm--error' : 'hr-pill-sm--warn'}`}>
                  <Text className='hr-pill-sm-text'>{a.urgencyLevel === 'high' || a.urgencyLevel === 'emergency' ? '较紧急' : '观察中'}</Text>
                </View>
              </View>
              <Text className='hr-anomaly__title'>⚠️ {a.symptoms.join('、')}</Text>
              {a.aiAssessment && (
                <Text className='hr-anomaly__advice'>💡 {a.aiAssessment}</Text>
              )}
            </View>
          ))}
          {anomalies.length === 0 && (
            <Text className='hr-empty'>本月无异常记录，继续保持！</Text>
          )}
        </View>
      </View>

      {/* 5. 用药史 */}
      <View className='xhh-card hr-card'>
        <View className='hr-card__section-head'>
          <View className='hr-card__ico hr-card__ico--coral'>💊</View>
          <View className='hr-card__section-titles'>
            <Text className='hr-card__section-title'>用药史</Text>
            <Text className='hr-card__section-sub'>近期 {meds.length} 次用药</Text>
          </View>
          {meds.length > 0 && (
            <View className='hr-card__pill hr-card__pill--success'>
              <Text className='hr-card__pill-text'>均已按时完成</Text>
            </View>
          )}
        </View>
        <View className='hr-meds'>
          {meds.map((m, i) => (
            <View key={i} className='hr-med'>
              <View className='hr-med__icon'>💉</View>
              <View className='hr-med__info'>
                <Text className='hr-med__name'>{m.name}</Text>
                <Text className='hr-med__meta'>{m.dateGiven || m.dateDue || ''}</Text>
              </View>
              <View className='hr-pill-sm hr-pill-sm--ok'>
                <Text className='hr-pill-sm-text'>已完成</Text>
              </View>
            </View>
          ))}
          {meds.length === 0 && (
            <Text className='hr-empty'>暂无用药记录</Text>
          )}
        </View>
      </View>

      {/* 6. 操作区 */}
      <View className='hr-actions'>
        <View className='hr-btn hr-btn--primary' onClick={handleExportPdf}>
          <Text className='hr-btn-text'>⬇️ 导出 PDF</Text>
        </View>
        <View className='hr-btn hr-btn--ghost' onClick={handleShareVet}>
          <Text className='hr-btn-text--ghost'>📤 分享给兽医</Text>
        </View>
      </View>

      {loading && (
        <View className='hr-loading'>
          <View className='hr-loading-spinner' />
          <Text className='hr-loading-text'>正在生成健康报告...</Text>
        </View>
      )}
    </View>
  )
}
