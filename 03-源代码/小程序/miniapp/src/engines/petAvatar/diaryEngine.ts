/**
 * 宠物日记引擎
 * 根据健康打卡数据和里程碑，以宠物口吻自动生成个性化日记文本
 */
import type { PetHealthEntry, DiaryTone, DiaryEntry } from '../../types/avatarTypes'
import { localDateString } from '../../utils/date'

export type { DiaryTone, DiaryEntry }

/**
 * 宠物日记引擎
 *
 * 根据健康打卡数据和里程碑（连续签到、生日、恢复等），
 * 以宠物口吻自动生成个性化日记文本。
 */

const DIARY_TEMPLATES: Record<string, DiaryEntry[]> = {
  all_normal: [
    { text: '今天便便很正常，我很舒服~', tone: 'happy', emoji: '💩' },
    { text: '今天精神不错，主人陪我玩了好久！', tone: 'happy', emoji: '🎾' },
    { text: '今天吃得香睡得香，是快乐的一天~', tone: 'happy', emoji: '😋' },
    { text: '一切正常！主人今天给我梳毛了，好舒服~', tone: 'happy', emoji: '✨' },
  ],
  appetite: [
    { text: '今天不太想吃东西，可能天气太热了...', tone: 'tired', emoji: '🥵' },
    { text: '今天的饭不太合胃口，主人别担心~', tone: 'neutral', emoji: '🍚' },
    { text: '胃口不太好，但主人给我开了罐头！', tone: 'neutral', emoji: '🥫' },
  ],
  spirit: [
    { text: '有点懒洋洋的，想多睡一会儿...', tone: 'tired', emoji: '😴' },
    { text: '今天不想动，就让我当一天懒虫吧~', tone: 'tired', emoji: '🛋️' },
    { text: '精神不太好，但主人的摸摸让我很开心', tone: 'neutral', emoji: '🤚' },
  ],
  poop: [
    { text: '今天肚子不太舒服，主人要留意哦...', tone: 'sick', emoji: '🤒' },
    { text: '便便有点稀，可能是昨天吃多了...', tone: 'neutral', emoji: '💩' },
  ],
  weight: [
    { text: '主人说我胖了！该减肥了...', tone: 'neutral', emoji: '⚖️' },
    { text: '体重下降了，主人很担心我', tone: 'sick', emoji: '📉' },
  ],
  exercise: [
    { text: '今天不想运动，让我歇歇吧~', tone: 'tired', emoji: '😮‍💨' },
  ],
  other: [
    { text: '今天有点不太对劲，主人多看看我~', tone: 'sick', emoji: '🤒' },
  ],
  streak_3: [
    { text: '连续3天状态满分！我是健康小标兵~', tone: 'proud', emoji: '⭐' },
  ],
  streak_7: [
    { text: '连续7天打卡！主人好认真，我也要加油！', tone: 'proud', emoji: '🏆' },
  ],
  streak_30: [
    { text: '连续30天！我和主人都是最棒的搭档！', tone: 'proud', emoji: '👑' },
  ],
  birthday: [
    { text: '今天是我的生日！谢谢主人陪我~', tone: 'happy', emoji: '🎂' },
    { text: '又长大一岁了，要更乖才行！', tone: 'happy', emoji: '🎁' },
  ],
  recovery: [
    { text: '今天好多了！谢谢主人的照顾~', tone: 'happy', emoji: '💪' },
    { text: '恢复中！很快就能活蹦乱跳了！', tone: 'happy', emoji: '🏃' },
  ],
  default: [
    { text: '今天也是普通而幸福的一天~', tone: 'happy', emoji: '💕' },
    { text: '有主人在身边，每天都是好日子~', tone: 'happy', emoji: '🏠' },
  ],
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

function hashCode(str: string): number {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash |= 0
  }
  return Math.abs(hash)
}

function pickDeterministic<T>(arr: T[], seed: string): T {
  return arr[hashCode(seed) % arr.length]
}

/** 根据打卡数据生成日记条目 */
export function generateDiaryEntry(
  entry: PetHealthEntry,
  streakDays: number,
  isBirthday: boolean,
  isRecovery: boolean
): DiaryEntry {
  const seed = `${entry.id}_${entryDateStr(entry)}`

  if (isBirthday) {
    return pickDeterministic(DIARY_TEMPLATES.birthday, seed)
  }

  if (isRecovery) {
    return pickDeterministic(DIARY_TEMPLATES.recovery, seed)
  }

  if (streakDays >= 30) {
    return pickDeterministic(DIARY_TEMPLATES.streak_30, seed)
  }

  if (streakDays >= 7) {
    return pickDeterministic(DIARY_TEMPLATES.streak_7, seed)
  }

  if (streakDays >= 3 && !entry.hasAnomaly) {
    return pickDeterministic(DIARY_TEMPLATES.streak_3, seed)
  }

  if (entry.hasAnomaly && entry.anomalyItems) {
    for (const anomaly of entry.anomalyItems) {
      if (DIARY_TEMPLATES[anomaly]) {
        return pickDeterministic(DIARY_TEMPLATES[anomaly], seed)
      }
    }
  }

  if (!entry.hasAnomaly) {
    return pickDeterministic(DIARY_TEMPLATES.all_normal, seed)
  }

  return pickDeterministic(DIARY_TEMPLATES.default, seed)
}

/** 生成当日日记（无打卡数据时返回提醒） */
export function generateDiaryForToday(
  entry: PetHealthEntry | null,
  streakDays: number,
  isBirthday: boolean,
  isRecovery: boolean
): DiaryEntry {
  if (!entry) {
    return { text: '今天还没打卡呢，主人快来~', tone: 'neutral', emoji: '⏰' }
  }

  return generateDiaryEntry(entry, streakDays, isBirthday, isRecovery)
}
