/**
 * 家庭日历页面
 * 宠物家庭日历事件展示与管理
 */
import { useState, useEffect, useCallback } from 'react'
import { View, Text, ScrollView } from '@tarojs/components'
import Taro, { useDidShow } from '@tarojs/taro'
import { useThemeClass } from '../../../hooks/useThemeClass'
import { getFamilyCalendarEvents, getEventsByDay, hasEventsOnDay, type CalendarEvent } from '../../../services/calendarService'
import { useFamilyStore } from '../../../stores/familyStore'
import { logger } from '../../../logger'
import './index.scss'

const WEEK_DAYS = ['日', '一', '二', '三', '四', '五', '六']

const EVENT_TYPE_CONFIG: Record<CalendarEvent['type'], { emoji: string; color: string; label: string }> = {
  vaccine: { emoji: '💉', color: '#E8A838', label: '疫苗' },
  deworm: { emoji: '🪱', color: '#8CAD7E', label: '驱虫' },
  checkin: { emoji: '✅', color: '#5B9A9B', label: '打卡' },
}

export default function FamilyCalendar() {
  const themeClass = useThemeClass()
  const today = new Date()
  const [year, setYear] = useState(today.getFullYear())
  const [month, setMonth] = useState(today.getMonth() + 1)
  const [selectedDay, setSelectedDay] = useState<number | null>(null)
  const [events, setEvents] = useState<CalendarEvent[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const { members, fetchFamilies } = useFamilyStore()

  const loadEvents = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await getFamilyCalendarEvents(members, year, month)
      setEvents(result)
    } catch (err) {
      logger.error('familyCalendar', '加载日历事件失败', err)
      setError('加载失败，请重试')
    } finally {
      setLoading(false)
    }
  }, [members, year, month])

  useEffect(() => {
    fetchFamilies()
  }, [])

  useDidShow(() => {
    loadEvents()
  })

  useEffect(() => {
    if (members.length > 0) {
      loadEvents()
    }
  }, [year, month])

  const daysInMonth = new Date(year, month, 0).getDate()
  const firstDayOfWeek = new Date(year, month - 1, 1).getDay()
  const todayDate = today.getDate()
  const isCurrentMonth = year === today.getFullYear() && month === today.getMonth() + 1

  const days: (number | null)[] = []
  for (let i = 0; i < firstDayOfWeek; i++) days.push(null)
  for (let d = 1; d <= daysInMonth; d++) days.push(d)

  const selectedEvents = selectedDay ? getEventsByDay(events, selectedDay) : []

  const handlePrevMonth = () => {
    if (month === 1) {
      setMonth(12)
      setYear(year - 1)
    } else {
      setMonth(month - 1)
    }
    setSelectedDay(null)
  }

  const handleNextMonth = () => {
    if (month === 12) {
      setMonth(1)
      setYear(year + 1)
    } else {
      setMonth(month + 1)
    }
    setSelectedDay(null)
  }

  const handleDayClick = (d: number | null) => {
    if (d !== null) {
      setSelectedDay(d === selectedDay ? null : d)
    }
  }

  const handleRetry = () => {
    loadEvents()
  }

  if (error) {
    return (
      <View className={`calendar-page ${themeClass}`}>
        <View className='calendar-error'>
          <Text className='calendar-error__text'>{error}</Text>
          <View className='calendar-error__btn' onClick={handleRetry}>
            <Text>重试</Text>
          </View>
        </View>
      </View>
    )
  }

  return (
    <View className={`calendar-page ${themeClass}`}>
      {/* 月份切换 */}
      <View className='calendar-header'>
        <View className='calendar-header__nav' onClick={handlePrevMonth}>
          <Text>◀</Text>
        </View>
        <Text className='calendar-header__title'>
          {year}年{month}月
        </Text>
        <View className='calendar-header__nav' onClick={handleNextMonth}>
          <Text>▶</Text>
        </View>
      </View>

      {/* 星期头 */}
      <View className='calendar-weekdays'>
        {WEEK_DAYS.map((w) => (
          <Text key={w} className='calendar-weekdays__item'>{w}</Text>
        ))}
      </View>

      {/* 日历网格 */}
      {loading && events.length === 0 ? (
        <View className='calendar-loading'>
          <Text className='calendar-loading__text'>加载中...</Text>
        </View>
      ) : (
        <View className='calendar-grid'>
          {days.map((d, idx) => {
            const isToday = isCurrentMonth && d === todayDate
            const hasEvent = d !== null && hasEventsOnDay(events, d)
            const isSelected = d === selectedDay

            if (d === null) {
              return <View key={idx} className='calendar-grid__cell calendar-grid__cell--empty' />
            }

            const dayEvents = getEventsByDay(events, d)
            const hasEmergency = dayEvents.some((e) => e.riskLevel === 'emergency' || e.riskLevel === 'high')

            return (
              <View
                key={idx}
                className={`calendar-grid__cell ${isToday ? 'calendar-grid__cell--today' : ''} ${isSelected ? 'calendar-grid__cell--selected' : ''}`}
                onClick={() => handleDayClick(d)}
              >
                <Text className='calendar-grid__day'>{d}</Text>
                {hasEvent && (
                  <View className={`calendar-grid__dot ${hasEmergency ? 'calendar-grid__dot--danger' : ''}`} />
                )}
              </View>
            )
          })}
        </View>
      )}

      {/* 事件列表 */}
      <ScrollView className='calendar-events' scrollY>
        {selectedDay ? (
          <>
            <Text className='calendar-events__date'>
              {month}月{selectedDay}日 · 事件
            </Text>

            {loading ? (
              <Text className='calendar-events__loading'>加载中...</Text>
            ) : selectedEvents.length === 0 ? (
              <Text className='calendar-events__empty'>暂无事件</Text>
            ) : (
              selectedEvents.map((ev, idx) => {
                const config = EVENT_TYPE_CONFIG[ev.type]
                return (
                  <View
                    key={idx}
                    className='calendar-events__item'
                    style={{ borderLeftColor: config.color }}
                  >
                    <Text className='calendar-events__item-emoji'>{config.emoji}</Text>
                    <View className='calendar-events__item-body'>
                      <Text className='calendar-events__item-title'>
                        {ev.title}
                      </Text>
                      <View className='calendar-events__item-meta'>
                        <Text className='calendar-events__item-pet'>{ev.petName}</Text>
                        <Text
                          className='calendar-events__item-type'
                          style={{ color: config.color }}
                        >
                          {config.label}
                        </Text>
                      </View>
                    </View>
                  </View>
                )
              })
            )}
          </>
        ) : (
          <Text className='calendar-events__placeholder'>
            {members.length === 0
              ? '暂无家庭成员，请先添加宠物'
              : '点击日期查看事件'}
          </Text>
        )}
      </ScrollView>

      {/* 底部导航 */}
      <View className='calendar-footer'>
        <View
          className='calendar-footer__btn'
          onClick={() => Taro.navigateTo({ url: '/pagesPet/vaccine/index' })}
        >
          <Text className='calendar-footer__btn-text'>疫苗管理</Text>
        </View>
        <View
          className='calendar-footer__btn'
          onClick={() => Taro.navigateTo({ url: '/pagesPet/checkin/index' })}
        >
          <Text className='calendar-footer__btn-text'>健康打卡</Text>
        </View>
      </View>
    </View>
  )
}