/**
 * 宠物日记服务
 *
 * 根据健康打卡记录生成拟人化宠物日记
 */
import type { PetHealthEntry } from '../memory-body/types/memoryBodyTypes'
import { generateDiaryEntry, type DiaryEntry } from '../engines/petAvatar/diaryEngine'
import { localDateString } from '../utils/date'

export interface DiaryRecord {
  date: string
  diary: DiaryEntry
  entry: PetHealthEntry
}

/**
 * 记录所属的「本地日历日」（YYYY-MM-DD）
 *
 * 2026-09-11 全站口径收口：原实现用 toISOString().slice(0,10) / slice(0,10) 取的是 **UTC 日期** ——
 * 东八区 00:00-08:00 的记录会被算成前一天，于是「打卡天数 / 连续天数 / 去重天数」
 * 在早上齐齐差一天，并与已改用本地日的 checkinService、reportService 口径不一致。
 */
function entryDateStr(entry: PetHealthEntry): string {
  return localDateString(entry.createdAt) ?? ''
}

function isSameDay(dateStr: string, target: Date): boolean {
  const parts = dateStr.split('-')
  if (parts.length < 3) return false
  return (
    parts[0] === String(target.getFullYear()) &&
    parts[1] === String(target.getMonth() + 1).padStart(2, '0') &&
    parts[2] === String(target.getDate()).padStart(2, '0')
  )
}

function calculateStreakAtTime(entries: PetHealthEntry[], beforeDate: Date): number {
  const uniqueDates = new Set<string>()
  for (const entry of entries) {
    const ds = entryDateStr(entry)
    if (ds <= beforeDate.toISOString().slice(0, 10)) {
      uniqueDates.add(ds)
    }
  }
  const sorted = Array.from(uniqueDates).sort()
  let streak = 0
  const checkDate = new Date(beforeDate)
  for (let i = sorted.length - 1; i >= 0; i--) {
    if (isSameDay(sorted[i], checkDate)) {
      streak++
      checkDate.setDate(checkDate.getDate() - 1)
    } else {
      break
    }
  }
  return streak
}

export function generateDiaryFromEntries(
  entries: PetHealthEntry[],
  petBirthDate?: string | null
): DiaryRecord[] {
  const sorted = [...entries].sort((a, b) => {
    const da = entryDateStr(a)
    const db = entryDateStr(b)
    return db.localeCompare(da)
  })

  const birthDate = petBirthDate ? new Date(petBirthDate) : null

  return sorted.map((entry) => {
    const entryDate = entryDateStr(entry)
    const entryTime = new Date(entry.createdAt || new Date())
    const streakAtTime = calculateStreakAtTime(sorted, entryTime)
    const isBirthday = birthDate
      ? isSameDay(entryDate, birthDate)
      : false

    const diary = generateDiaryEntry(entry, streakAtTime, isBirthday, false)

    return {
      date: entryDate,
      diary,
      entry,
    }
  })
}
