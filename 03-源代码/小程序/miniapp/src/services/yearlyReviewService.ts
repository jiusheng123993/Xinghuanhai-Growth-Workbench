/**
 * 年度回顾服务
 *
 * 生成宠物年度回顾数据（统计/亮点/回忆），用于分享展示
 */
import Taro from '@tarojs/taro'
import type { PetProfile } from './petService'
import type { PetHealthEntry } from '../memory-body/types/memoryBodyTypes'
import { getCheckins , getCheckinStats } from './checkinService'
import { localDateString } from '../utils/date'


export interface YearlyReviewData {
  year: number
  petName: string
  petEmoji: string
  totalCheckins: number
  totalDays: number
  maxStreak: number
  weightChange?: { start: number; end: number; diff: number }
  topMoods: Array<{ mood: string; emoji: string; count: number }>
  milestones: Array<{ date: string; title: string; emoji: string }>
  highlights: string[]
  summary: string
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

export async function generateYearlyReview(
  pet: PetProfile,
  userId: string,
  year: number,
): Promise<YearlyReviewData> {
  const entries = await getCheckins(pet.id, userId)
  const stats = await getCheckinStats(pet.id, userId)

  const yearEntries = entries.filter(e => {
    const d = entryDateStr(e)
    return d.startsWith(`${year}-`)
  })

  const yearEntriesSorted = [...yearEntries].sort((a, b) =>
    entryDateStr(a).localeCompare(entryDateStr(b)),
  )

  const totalCheckins = yearEntries.length

  const uniqueDays = new Set(yearEntries.map(e => entryDateStr(e)))
  const totalDays = uniqueDays.size

  const birthday = pet.birthDate || ''
  const createdAt = pet.createdAt || ''
  const milestones: Array<{ date: string; title: string; emoji: string }> = []

  if (birthday && birthday.startsWith(`${year}-`)) {
    milestones.push({ date: birthday, title: `${pet.name}的生日`, emoji: '🎂' })
  }
  if (createdAt && createdAt.startsWith(`${year}-`) && (!birthday || birthday.slice(0, 4) !== createdAt.slice(0, 4))) {
    milestones.push({ date: createdAt, title: '加入家庭', emoji: '🏠' })
  }

  const weightEntries = yearEntriesSorted.filter(e => e.weight !== undefined && e.weight !== null)
  let weightChange: YearlyReviewData['weightChange'] | undefined
  if (weightEntries.length >= 2) {
    const start = weightEntries[0].weight!
    const end = weightEntries[weightEntries.length - 1].weight!
    const diff = Math.round((end - start) * 10) / 10
    weightChange = { start, end, diff }
  }

  const moodCount: Record<string, number> = {}
  for (const entry of yearEntries) {
    const mood = entry.spiritLevel >= 4 ? 'happy' : entry.spiritLevel >= 3 ? 'calm' : entry.spiritLevel >= 2 ? 'tired' : 'sad'
    moodCount[mood] = (moodCount[mood] || 0) + 1
  }
  const moodEntries = Object.entries(moodCount).sort((a, b) => b[1] - a[1])
  const topMoods = moodEntries.slice(0, 3).map(([mood, count]) => {
    const moodEmojiMap: Record<string, string> = {
      happy: '😊',
      excited: '🎉',
      calm: '😌',
      tired: '😴',
      sick: '🤒',
      sad: '😢',
    }
    const moodLabelMap: Record<string, string> = {
      happy: '开心',
      excited: '兴奋',
      calm: '平静',
      tired: '疲惫',
      sick: '不适',
      sad: '低落',
    }
    return { mood: moodLabelMap[mood] || mood, emoji: moodEmojiMap[mood] || '😊', count }
  })

  const highlights: string[] = []
  if (totalCheckins >= 100) {
    highlights.push(`今年累计打卡${totalCheckins}次，你是最用心的铲屎官！`)
  }
  if (stats.streak && stats.streak >= 7) {
    highlights.push(`最长连续打卡${stats.streak}天，坚持就是胜利！`)
  }
  if (weightChange && Math.abs(weightChange.diff) > 0.5) {
    const direction = weightChange.diff > 0 ? '增加了' : '减少了'
    highlights.push(`体重${direction}${Math.abs(weightChange.diff)}kg，${weightChange.diff > 0 ? '健康成长中' : '要注意营养哦'}`)
  }
  if (milestones.length > 0) {
    highlights.push(`今年有${milestones.length}个值得纪念的日子`)
  }
  if (topMoods.length > 0 && topMoods[0].count / Math.max(totalCheckins, 1) > 0.6) {
    highlights.push(`${pet.name}今年大多数时候都${topMoods[0].mood}`)
  }

  if (highlights.length === 0) {
    highlights.push(`${pet.name}度过了平静美好的一年`)
    highlights.push('新的一年继续陪伴彼此吧')
  }

  const summary = generateSummary(pet.name, year, totalCheckins, totalDays, topMoods, weightChange)

  return {
    year,
    petName: pet.name,
    petEmoji: pet.species === 'cat' ? '🐱' : '🐕',
    totalCheckins,
    totalDays,
    maxStreak: stats.streak || 0,
    weightChange,
    topMoods,
    milestones,
    highlights,
    summary,
  }
}

function generateSummary(
  petName: string,
  year: number,
  totalCheckins: number,
  totalDays: number,
  topMoods: Array<{ mood: string; count: number }>,
  weightChange?: { diff: number },
): string {
  const parts: string[] = []

  if (totalCheckins >= 200) {
    parts.push(`${year}年，${petName}的每一天都被细心记录。`)
  } else if (totalCheckins >= 50) {
    parts.push(`${year}年，${petName}和你一起度过了${totalDays}个被记录的日子。`)
  } else if (totalCheckins > 0) {
    // 文案纠正（2026-09-11）：totalDays 是"当年有记录的天数"，不是相处时长，
    // 原句「和你一起走过了 N 天」会把记录天数说成陪伴天数。
    parts.push(`${year}年，有${totalDays}天留下了${petName}的记录。`)
  } else {
    parts.push(`${year}年，${petName}安静地陪伴在你身边。`)
  }

  if (topMoods.length > 0) {
    parts.push(`大多数时候${petName}都很${topMoods[0].mood}。`)
  }

  if (weightChange) {
    parts.push(`新的一年，继续健康快乐地陪伴彼此吧。`)
  } else {
    parts.push(`新的一年，愿${petName}继续健康快乐。`)
  }

  return parts.join('')
}

const CANVAS_WIDTH = 750
const CANVAS_HEIGHT = 1334

const COLORS = {
  primary: '#FF8C42',
  gold: '#D4A574',
  text: '#333333',
  textSecondary: '#666666',
  textLight: '#999999',
  background: '#FFF8F0',
  cardBg: '#FFFFFF',
  border: '#F0E0D0',
  accent: '#E8A87C',
  sage: '#8BC34A',
}

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.lineTo(x + w - r, y)
  ctx.arcTo(x + w, y, x + w, y + r, r)
  ctx.lineTo(x + w, y + h - r)
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r)
  ctx.lineTo(x + r, y + h)
  ctx.arcTo(x, y + h, x, y + h - r, r)
  ctx.lineTo(x, y + r)
  ctx.arcTo(x, y, x + r, y, r)
  ctx.closePath()
}

export function drawYearlyReview(ctx: CanvasRenderingContext2D, data: YearlyReviewData): void {
  const pad = 40
  let y = pad + 20

  ctx.fillStyle = COLORS.background
  ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT)

  ctx.fillStyle = COLORS.text
  ctx.font = 'bold 48px sans-serif'
  ctx.textAlign = 'center'
  ctx.fillText(`${data.year}年度回忆`, CANVAS_WIDTH / 2, y)
  y += 30

  ctx.font = 'bold 36px sans-serif'
  ctx.fillText(`${data.petEmoji} ${data.petName}`, CANVAS_WIDTH / 2, y + 50)
  y += 90

  ctx.fillStyle = COLORS.cardBg
  drawRoundedRect(ctx, pad, y, CANVAS_WIDTH - pad * 2, 160, 20)
  ctx.fill()
  ctx.strokeStyle = COLORS.border
  ctx.lineWidth = 1
  drawRoundedRect(ctx, pad, y, CANVAS_WIDTH - pad * 2, 160, 20)
  ctx.stroke()

  const stats = [
    { label: '打卡次数', value: String(data.totalCheckins), unit: '次' },
    { label: '记录天数', value: String(data.totalDays), unit: '天' },
    { label: '最长连续', value: String(data.maxStreak), unit: '天' },
  ]

  const statW = (CANVAS_WIDTH - pad * 2) / 3
  stats.forEach((stat, i) => {
    const sx = pad + statW * i
    ctx.fillStyle = COLORS.primary
    ctx.font = 'bold 44px sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText(stat.value, sx + statW / 2, y + 50)

    ctx.fillStyle = COLORS.textLight
    ctx.font = '22px sans-serif'
    ctx.fillText(`${stat.unit}`, sx + statW / 2, y + 75)

    ctx.fillStyle = COLORS.textSecondary
    ctx.font = '24px sans-serif'
    ctx.fillText(stat.label, sx + statW / 2, y + 105)

    if (i < 2) {
      ctx.strokeStyle = COLORS.border
      ctx.beginPath()
      ctx.moveTo(sx + statW, y + 20)
      ctx.lineTo(sx + statW, y + 140)
      ctx.stroke()
    }
  })

  y += 190

  if (data.weightChange) {
    ctx.fillStyle = COLORS.cardBg
    drawRoundedRect(ctx, pad, y, CANVAS_WIDTH - pad * 2, 100, 20)
    ctx.fill()

    ctx.fillStyle = COLORS.text
    ctx.font = 'bold 28px sans-serif'
    ctx.textAlign = 'left'
    ctx.fillText('⚖️ 体重变化', pad + 24, y + 40)

    const diff = data.weightChange.diff
    const sign = diff > 0 ? '+' : ''
    const diffColor = diff > 0 ? COLORS.primary : COLORS.sage
    ctx.fillStyle = diffColor
    ctx.font = 'bold 32px sans-serif'
    ctx.textAlign = 'right'
    ctx.fillText(`${sign}${diff}kg`, CANVAS_WIDTH - pad - 24, y + 40)

    ctx.fillStyle = COLORS.textSecondary
    ctx.font = '22px sans-serif'
    ctx.textAlign = 'left'
    ctx.fillText(`从 ${data.weightChange.start}kg 到 ${data.weightChange.end}kg`, pad + 24, y + 72)

    y += 130
  }

  if (data.milestones.length > 0) {
    ctx.fillStyle = COLORS.text
    ctx.font = 'bold 28px sans-serif'
    ctx.textAlign = 'left'
    ctx.fillText('🏆 重要时刻', pad, y)
    y += 40

    data.milestones.forEach(ms => {
      ctx.fillStyle = COLORS.cardBg
      drawRoundedRect(ctx, pad, y, CANVAS_WIDTH - pad * 2, 60, 16)
      ctx.fill()
      ctx.strokeStyle = COLORS.border
      drawRoundedRect(ctx, pad, y, CANVAS_WIDTH - pad * 2, 60, 16)
      ctx.stroke()

      ctx.fillStyle = COLORS.text
      ctx.font = '26px sans-serif'
      ctx.textAlign = 'left'
      ctx.fillText(`${ms.emoji} ${ms.title}`, pad + 20, y + 40)
      y += 75
    })
    y += 10
  }

  if (data.topMoods.length > 0) {
    ctx.fillStyle = COLORS.text
    ctx.font = 'bold 28px sans-serif'
    ctx.textAlign = 'left'
    ctx.fillText('😊 情绪分布', pad, y)
    y += 40

    const maxCount = Math.max(...data.topMoods.map(m => m.count), 1)
    data.topMoods.forEach(mood => {
      const barWidth = ((CANVAS_WIDTH - pad * 2 - 160) * mood.count) / maxCount
      ctx.fillStyle = COLORS.textSecondary
      ctx.font = '24px sans-serif'
      ctx.textAlign = 'left'
      ctx.fillText(`${mood.emoji} ${mood.mood}`, pad + 20, y + 22)

      ctx.fillStyle = COLORS.border
      drawRoundedRect(ctx, pad + 160, y + 8, CANVAS_WIDTH - pad * 2 - 160, 28, 14)
      ctx.fill()

      ctx.fillStyle = COLORS.primary
      ctx.globalAlpha = 0.7
      drawRoundedRect(ctx, pad + 160, y + 8, Math.max(barWidth, 28), 28, 14)
      ctx.fill()
      ctx.globalAlpha = 1

      ctx.fillStyle = COLORS.text
      ctx.font = '22px sans-serif'
      ctx.textAlign = 'right'
      ctx.fillText(`${mood.count}天`, CANVAS_WIDTH - pad - 20, y + 28)
      y += 48
    })
    y += 10
  }

  if (data.highlights.length > 0) {
    ctx.fillStyle = COLORS.text
    ctx.font = 'bold 28px sans-serif'
    ctx.textAlign = 'left'
    ctx.fillText('✨ 年度亮点', pad, y)
    y += 40

    data.highlights.forEach(hl => {
      ctx.fillStyle = COLORS.textSecondary
      ctx.font = '24px sans-serif'
      ctx.textAlign = 'left'
      ctx.fillText(`• ${hl}`, pad + 20, y + 16)
      y += 40
    })
    y += 10
  }

  if (data.summary) {
    ctx.fillStyle = COLORS.cardBg
    drawRoundedRect(ctx, pad, y, CANVAS_WIDTH - pad * 2, 120, 20)
    ctx.fill()
    ctx.strokeStyle = COLORS.primary
    ctx.lineWidth = 2
    drawRoundedRect(ctx, pad, y, CANVAS_WIDTH - pad * 2, 120, 20)
    ctx.stroke()

    ctx.fillStyle = COLORS.textSecondary
    ctx.font = '24px sans-serif'
    ctx.textAlign = 'left'

    const words = data.summary
    let line = ''
    let lineY = y + 30
    for (const char of words) {
      const test = line + char
      if (ctx.measureText(test).width > CANVAS_WIDTH - pad * 2 - 40) {
        ctx.fillText(line, pad + 20, lineY)
        line = char
        lineY += 32
      } else {
        line = test
      }
    }
    if (line) ctx.fillText(line, pad + 20, lineY)

    y += 150
  }

  ctx.fillStyle = COLORS.textLight
  ctx.font = '22px sans-serif'
  ctx.textAlign = 'center'
  ctx.fillText('星河宠记 · 记录毛孩子的温暖时光', CANVAS_WIDTH / 2, CANVAS_HEIGHT - 40)
}

export async function renderYearlyReview(
  data: YearlyReviewData,
  options: {
    canvasId: string
    pixelRatio?: number
  },
): Promise<{ tempFilePath: string; width: number; height: number }> {
  const pixelRatio = options.pixelRatio || 2

  return new Promise((resolve, reject) => {
    const query = Taro.createSelectorQuery()
    query
      .select(`#${options.canvasId}`)
      .fields({ node: true, size: true })
      .exec((res: any[]) => {
        if (!res || !res[0] || !res[0].node) {
          reject(new Error('Canvas context not found'))
          return
        }

        const canvas = res[0].node as any
        const ctx = canvas.getContext('2d') as CanvasRenderingContext2D

        canvas.width = CANVAS_WIDTH * pixelRatio
        canvas.height = CANVAS_HEIGHT * pixelRatio
        ctx.scale(pixelRatio, pixelRatio)

        drawYearlyReview(ctx, data)

        setTimeout(() => {
          Taro.canvasToTempFilePath({
            canvas,
            width: CANVAS_WIDTH,
            height: CANVAS_HEIGHT,
            destWidth: CANVAS_WIDTH * pixelRatio,
            destHeight: CANVAS_HEIGHT * pixelRatio,
            fileType: 'png',
            // 回调参数改名 result：外层 exec 回调已有同名 res（no-shadow）
            success: (result: { tempFilePath: string }) => {
              resolve({ tempFilePath: result.tempFilePath, width: CANVAS_WIDTH, height: CANVAS_HEIGHT })
            },
            fail: (err: { errMsg: string }) => {
              reject(new Error(`Canvas export failed: ${err.errMsg}`))
            },
          })
        }, 300)
      })
  })
}

export async function saveYearlyReview(tempFilePath: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    Taro.saveImageToPhotosAlbum({
      filePath: tempFilePath,
      success: () => {
        Taro.showToast({ title: '年度回忆已保存到相册', icon: 'success' })
        resolve()
      },
      fail: (err: { errMsg: string }) => {
        reject(new Error(`Save failed: ${err.errMsg}`))
      },
    })
  })
}