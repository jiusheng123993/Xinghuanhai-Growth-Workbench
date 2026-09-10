/**
 * 家庭周报页面
 * 金色横幅 + 本周亮点 + 成员健康小结 + 本周数据 + AI 寄语 + 分享，历史列表与生成
 */
import { useEffect, useState, useCallback, useMemo } from 'react'
import { View, Text, ScrollView } from '@tarojs/components'
import Taro, { useShareAppMessage, useShareTimeline } from '@tarojs/taro'
import { api } from '../../services/api'
import { getLatestWeeklyReport, getWeeklyReportList, mapBackendReportRowToView } from '../../services/weeklyReportService'
import type { BackendWeeklyReport, BackendReportRow } from '../../services/weeklyReportService'
import { useFamilyStore } from '../../stores/familyStore'
import './index.scss'
import { Icon } from '../../components'
import PageBackground from '../../components/PageBackground'

const EMOJI: Record<string, string> = { cat: '🐱', dog: '🐕' }

function formatDateRange(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00')
  const end = new Date(d)
  end.setDate(end.getDate() + 6)
  return `${d.getMonth() + 1}月${d.getDate()}日 - ${end.getMonth() + 1}月${end.getDate()}日`
}

/** 成员状态：按健康分分级 */
function memberStatus(ps: BackendWeeklyReport['petReports'][number]): { text: string; tone: 'good' | 'warn'; emoji: string } {
  if (ps.score >= 80 && ps.anomalyDays === 0) return { text: '健康良好', tone: 'good', emoji: '✅' }
  if (ps.score >= 60) return { text: '需要关注', tone: 'warn', emoji: '⚠️' }
  return { text: '建议调整', tone: 'warn', emoji: '💊' }
}

function memberSummary(ps: BackendWeeklyReport['petReports'][number]): string {
  if (ps.streak > 0) return `连续打卡 ${ps.streak} 天`
  if (ps.anomalyDays > 0) return `异常 ${ps.anomalyDays} 天`
  return `本周打卡 ${ps.checkinDays} 天`
}

export default function WeeklyReport() {
  const { currentFamily } = useFamilyStore()
  const [latestReport, setLatestReport] = useState<BackendWeeklyReport | null>(null)
  const [historyList, setHistoryList] = useState<BackendWeeklyReport[]>([])
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
  const [generating, setGenerating] = useState(false)

  useShareAppMessage(() => ({
    title: latestReport ? `${currentFamily?.name || '家庭'} · 本周周报` : '星河宠记 - 家庭周报',
    path: `/pagesPet/weekly-report/index`,
  }))
  useShareTimeline(() => ({
    title: latestReport ? `${currentFamily?.name || '家庭'} · 本周周报` : '星河宠记 - 家庭周报',
    query: '',
  }))

  const fetchData = useCallback(async () => {
    if (!currentFamily) return
    const fid = currentFamily.id
    try {
      const [latest, listRes] = await Promise.all([
        getLatestWeeklyReport(fid),
        getWeeklyReportList(fid),
      ])
      setLatestReport(latest)
      setHistoryList(listRes?.items || [])
    } catch {
      setLatestReport(null)
      setHistoryList([])
    }
  }, [currentFamily])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  const handleGenerate = useCallback(async () => {
    if (!currentFamily || generating) return
    setGenerating(true)
    try {
      // 直接调用生成接口拿到行结构，再映射为视图结构（保留 409/500 等错误提示给用户）
      const row = await api.post<BackendReportRow>(
        `/api/families/${currentFamily.id}/weekly-reports/generate`,
      )
      const report = mapBackendReportRowToView(row)
      setLatestReport(report)
      setHistoryList(prev => [report, ...prev])
      Taro.showToast({ title: '周报生成成功', icon: 'success' })
    } catch (err: unknown) {
      const error = err as { message?: string }
      Taro.showToast({ title: error.message || '生成失败', icon: 'none' })
    } finally {
      setGenerating(false)
    }
  }, [currentFamily, generating])

  const handleShare = useCallback(() => {
    Taro.showShareMenu({ withShareTicket: true })
    Taro.showToast({ title: '点击右上角分享周报', icon: 'none' })
  }, [])

  const toggleExpand = (id: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  /** 本周数据 2x2：直接取后端 report_data 聚合字段（后端暂无 per-pet 明细，不再依赖 pet_summaries） */
  const weekStats = useMemo(() => {
    const h = latestReport?.reportData?.health
    const a = latestReport?.reportData?.activities
    return [
      { value: `${h?.checkin_count ?? 0}`, label: '本周打卡（次）' },
      // 标签纠正（2026-09-11）：后端是 `COUNT(*) FILTER (WHERE has_anomaly)`＝异常**条数**，
      // 不是"天数"（一天补记两条会算 2）。同排其它三格都带单位，这里统一成「（次）」。
      { value: `${h?.anomaly_count ?? 0}`, label: '需关注（次）' },
      { value: `${a?.symptom_checks ?? 0}`, label: '症状初筛（次）' },
      { value: `${a?.new_moments ?? 0}`, label: '新增动态（条）' },
    ]
  }, [latestReport])

  if (!currentFamily) {
    return (
      <View className='report-page'>
        <View className='report-page__empty'>
          <Icon name='clipboard-text' size={48} tone='primary' className='report-page__empty-icon' />
          <Text className='report-page__empty-text'>请先创建家庭</Text>
        </View>
      </View>
    )
  }

  const report = latestReport

  return (
    <ScrollView className='report-page' scrollY>
      {/* 全屏动态背景层 */}
      <PageBackground />

      <View className='report-page__content'>
        {/* 生成入口 */}
        <View
          className={`report-generate-btn ${generating ? 'report-generate-btn--loading' : ''}`}
          onClick={handleGenerate}
        >
          <Text className='report-generate-btn__text'>
            {generating ? '⏳ 生成中...' : '✨ 生成本周周报'}
          </Text>
        </View>

        {report && (
          <>
            {/* ===== 周报头部：金色渐变横幅 ===== */}
            <View className='fr-banner'>
              <View className='fr-banner__head'>
                <View className='fr-banner__icon'>
                  <Text className='fr-banner__icon-text'>✨</Text>
                </View>
                <View className='fr-banner__info'>
                  <Text className='fr-banner__title'>{currentFamily.name} · 本周周报</Text>
                  <View className='fr-banner__meta'>
                    <Icon name='calendar-check' size={12} tone='primary' className='fr-banner__meta-icon' />
                    <Text className='fr-banner__meta-text'>{formatDateRange(report.reportDate)}</Text>
                  </View>
                </View>
                <View className='fr-banner__badge'>
                  <Text className='fr-banner__badge-text'>✨ AI 生成</Text>
                </View>
              </View>
            </View>

            {/* ===== 本周亮点：珊瑚描边卡 ===== */}
            {report.highlights.length > 0 && (
              <View className='fr-highlights'>
                <View className='fr-card__title-row'>
                  <Icon name='star' size={14} tone='primary' className='fr-card__title-icon' />
                  <Text className='fr-card__title'>本周亮点</Text>
                </View>
                <View className='fr-highlights__list'>
                  {report.highlights.map((h, i) => (
                    <View key={i} className='fr-highlight-row'>
                      <View className='fr-highlight-dot'>
                        <Text className='fr-highlight-dot-icon'>✨</Text>
                      </View>
                      <Text className='fr-highlight-text'>{h}</Text>
                    </View>
                  ))}
                </View>
              </View>
            )}

            {/* ===== 成员健康小结卡 ===== */}
            {report.petReports.length > 0 && (
              <View className='fr-members'>
                <View className='fr-card__title-row'>
                  <Text className='fr-card__title'>成员健康小结</Text>
                  <Text className='fr-card__title-meta'>共 {report.petReports.length} 位</Text>
                </View>
                <View className='fr-member-list'>
                  {report.petReports.map(ps => {
                    const status = memberStatus(ps)
                    return (
                      <View key={ps.petId} className='fr-member-row'>
                        <View className='fr-member-avatar'>
                          <Text className='fr-member-avatar-emoji'>{EMOJI[ps.species] || '🐾'}</Text>
                        </View>
                        <View className='fr-member-info'>
                          <Text className='fr-member-name'>{ps.petName}</Text>
                          <Text className='fr-member-summary'>{memberSummary(ps)}</Text>
                        </View>
                        <View className={`fr-status fr-status--${status.tone}`}>
                          <Text className='fr-status-text'>{status.emoji} {status.text}</Text>
                        </View>
                      </View>
                    )
                  })}
                </View>
              </View>
            )}

            {/* ===== 本周数据 2x2 ===== */}
            <View className='fr-stats'>
              <Text className='fr-card__title'>本周数据</Text>
              <View className='fr-stat-grid'>
                {weekStats.map(s => (
                  <View key={s.label} className='fr-stat-tile'>
                    <Text className='fr-stat-tile__value'>{s.value}</Text>
                    <Text className='fr-stat-tile__label'>{s.label}</Text>
                  </View>
                ))}
              </View>
            </View>

            {/* ===== AI 寄语：信息蓝底 ===== */}
            <View className='fr-note'>
              <View className='fr-card__title-row'>
                <Text className='fr-card__title-icon'>💙</Text>
                <Text className='fr-card__title'>AI 寄语</Text>
              </View>
              <Text className='fr-note__text'>{report.summary || '这一周毛孩子们状态不错，继续保持每日打卡吧！'}</Text>
            </View>

            {/* ===== 分享周报按钮 ===== */}
            <View className='fr-share-btn' onClick={handleShare}>
              <Icon name='share-network' size={16} tone='primary' className='fr-share-btn__icon' />
              <Text className='fr-share-btn__text'>分享周报</Text>
            </View>
          </>
        )}

        {/* ===== 历史周报 ===== */}
        {historyList.length > 0 && (
          <View className='report-history'>
            <Text className='report-history__title'>📋 历史周报</Text>
            {historyList.map(item => {
              const isExpanded = expandedIds.has(item.id)
              return (
                <View key={item.id} className='report-history__item' onClick={() => toggleExpand(item.id)}>
                  <View className='report-history__head'>
                    <Text className='report-history__date'>{item.reportDate}</Text>
                    <Text className='report-history__arrow'>{isExpanded ? '▲' : '▼'}</Text>
                  </View>
                  {isExpanded && (
                    <View className='report-history__body'>
                      <Text className='report-history__summary'>{item.summary}</Text>
                      {item.highlights.length > 0 && (
                        <View className='report-history__tags'>
                          {item.highlights.map((h, i) => (
                            <Text key={i} className='report-history__tag'>✨ {h}</Text>
                          ))}
                        </View>
                      )}
                    </View>
                  )}
                </View>
              )
            })}
          </View>
        )}

        <View style={{ height: '40rpx' }} />
      </View>
    </ScrollView>
  )
}
