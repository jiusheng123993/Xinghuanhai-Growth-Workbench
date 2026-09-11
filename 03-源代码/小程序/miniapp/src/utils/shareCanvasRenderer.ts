import Taro from '@tarojs/taro'

const CANVAS_WIDTH = 750
const CARD_HEIGHT = 1334
const PADDING = 40
const LINE_HEIGHT = 44
const TITLE_FONT_SIZE = 36
const SUBTITLE_FONT_SIZE = 28
const BODY_FONT_SIZE = 24
const SMALL_FONT_SIZE = 20

const COLORS = {
  primary: '#FF8C42',
  text: '#333333',
  textSecondary: '#666666',
  textLight: '#999999',
  border: '#E8E8E8',
  background: '#FFFFFF',
  sectionBg: '#F8F8F8',
  success: '#52C41A',
  warning: '#FAAD14',
  danger: '#FF4D4F',
  toxic: '#F44336',
  brand: '#FF6B35',
}

const SAFETY_COLORS: Record<string, string> = {
  safe: COLORS.success,
  caution: COLORS.warning,
  dangerous: COLORS.danger,
  toxic: COLORS.toxic,
}

const SAFETY_LABELS: Record<string, string> = {
  safe: '安全',
  caution: '注意',
  dangerous: '危险',
  toxic: '有毒',
}

export interface FoodShareImageData {
  foodName: string
  safetyLevel: string
  petName: string
  dangerousCompounds?: string[]
  symptoms?: string[]
  inviteCode?: string
}

export interface HealthTrendShareImageData {
  petName: string
  dateRange: string
  trendSummary: string
  aiInsight: string
  inviteCode?: string
}

export interface VaccineShareImageData {
  petName: string
  vaccineName: string
  completedDate: string
  badgeTitle: string
  inviteCode?: string
}

export interface AchievementShareImageData {
  petName: string
  achievementTitle: string
  achievementSubtitle: string
  achievementIcon: string
  achievementColor: string
  inviteCode?: string
}

export type ShareCardDataType = FoodShareImageData | HealthTrendShareImageData | VaccineShareImageData | AchievementShareImageData

export interface ShareCanvasOptions {
  canvasId: string
  pixelRatio?: number
  width?: number
  height?: number
}

export interface ShareImageResult {
  tempFilePath: string
  width: number
  height: number
}

function drawBrandHeader(ctx: CanvasRenderingContext2D, y: number): number {
  ctx.save()
  ctx.fillStyle = COLORS.brand
  ctx.font = `bold ${TITLE_FONT_SIZE}px sans-serif`
  ctx.textAlign = 'center'
  ctx.fillText('星河宠记', CANVAS_WIDTH / 2, y + 50)

  ctx.fillStyle = COLORS.textLight
  ctx.font = `${SMALL_FONT_SIZE}px sans-serif`
  ctx.fillText('宠物健康管家', CANVAS_WIDTH / 2, y + 85)
  ctx.restore()
  return y + 110
}

function drawBrandFooter(ctx: CanvasRenderingContext2D, y: number): number {
  ctx.save()
  ctx.strokeStyle = COLORS.border
  ctx.beginPath()
  ctx.moveTo(PADDING + 20, y)
  ctx.lineTo(CANVAS_WIDTH - PADDING - 20, y)
  ctx.stroke()

  ctx.fillStyle = COLORS.textLight
  ctx.font = `${SMALL_FONT_SIZE}px sans-serif`
  ctx.textAlign = 'center'
  ctx.fillText('长按识别小程序码 · 关注宠物健康', CANVAS_WIDTH / 2, y + 40)
  ctx.fillText('星河宠记 - 宠物健康管理', CANVAS_WIDTH / 2, y + 75)
  ctx.restore()
  return y + 100
}

function drawInviteCode(ctx: CanvasRenderingContext2D, y: number, inviteCode?: string): number {
  if (!inviteCode) return y
  ctx.save()
  ctx.fillStyle = COLORS.textLight
  ctx.font = `${SMALL_FONT_SIZE}px sans-serif`
  ctx.textAlign = 'center'
  ctx.fillText(`邀请码: ${inviteCode} | 扫码一起养宠`, CANVAS_WIDTH / 2, y + 30)
  ctx.restore()
  return y + 50
}

export function drawFoodShareImage(ctx: CanvasRenderingContext2D, data: FoodShareImageData): void {
  let y = PADDING
  ctx.fillStyle = COLORS.background
  ctx.fillRect(0, 0, CANVAS_WIDTH, CARD_HEIGHT)

  y = drawBrandHeader(ctx, y) + 20

  ctx.save()
  ctx.fillStyle = COLORS.text
  ctx.font = `bold ${TITLE_FONT_SIZE}px sans-serif`
  ctx.textAlign = 'center'
  ctx.fillText(`${data.petName}的食物安全报告`, CANVAS_WIDTH / 2, y + 40)
  y += 70

  const safetyColor = SAFETY_COLORS[data.safetyLevel] || COLORS.warning
  const safetyLabel = SAFETY_LABELS[data.safetyLevel] || '未知'

  ctx.fillStyle = COLORS.sectionBg
  ctx.fillRect(PADDING, y, CANVAS_WIDTH - PADDING * 2, 80)
  ctx.fillStyle = safetyColor
  ctx.font = `bold ${SUBTITLE_FONT_SIZE}px sans-serif`
  ctx.textAlign = 'left'
  ctx.fillText(`安全等级：${safetyLabel}`, PADDING + 20, y + 50)
  y += 100

  ctx.fillStyle = COLORS.text
  ctx.font = `bold ${SUBTITLE_FONT_SIZE}px sans-serif`
  ctx.fillText(`食物：${data.foodName}`, PADDING + 20, y + 35)
  y += 60

  if (data.dangerousCompounds && data.dangerousCompounds.length > 0) {
    ctx.fillStyle = COLORS.danger
    ctx.font = `${BODY_FONT_SIZE}px sans-serif`
    ctx.fillText('危险成分：', PADDING + 20, y + 35)
    ctx.fillStyle = COLORS.text
    ctx.fillText(data.dangerousCompounds.join('、'), PADDING + 160, y + 35)
    y += 50
  }

  if (data.symptoms && data.symptoms.length > 0) {
    ctx.fillStyle = COLORS.warning
    ctx.font = `${BODY_FONT_SIZE}px sans-serif`
    ctx.fillText('中毒症状：', PADDING + 20, y + 35)
    ctx.fillStyle = COLORS.text
    const visibleSymptoms = data.symptoms.slice(0, 4)
    ctx.fillText(visibleSymptoms.join('、'), PADDING + 160, y + 35)
    y += 50
  }

  y += 40
  y = drawInviteCode(ctx, y, data.inviteCode)
  drawBrandFooter(ctx, y)
  ctx.restore()
}

export function drawHealthTrendShareImage(ctx: CanvasRenderingContext2D, data: HealthTrendShareImageData): void {
  let y = PADDING
  ctx.fillStyle = COLORS.background
  ctx.fillRect(0, 0, CANVAS_WIDTH, CARD_HEIGHT)

  y = drawBrandHeader(ctx, y) + 20

  ctx.save()
  ctx.fillStyle = COLORS.text
  ctx.font = `bold ${TITLE_FONT_SIZE}px sans-serif`
  ctx.textAlign = 'center'
  ctx.fillText(`${data.petName}的健康趋势`, CANVAS_WIDTH / 2, y + 40)
  y += 70

  ctx.fillStyle = COLORS.textSecondary
  ctx.font = `${BODY_FONT_SIZE}px sans-serif`
  ctx.fillText(data.dateRange, CANVAS_WIDTH / 2, y + 30)
  y += 60

  ctx.fillStyle = COLORS.sectionBg
  ctx.fillRect(PADDING, y, CANVAS_WIDTH - PADDING * 2, 200)

  ctx.fillStyle = COLORS.primary
  ctx.font = `bold ${SUBTITLE_FONT_SIZE}px sans-serif`
  ctx.textAlign = 'left'
  ctx.fillText('趋势概览', PADDING + 20, y + 40)

  ctx.fillStyle = COLORS.text
  ctx.font = `${BODY_FONT_SIZE}px sans-serif`
  const summaryLines = data.trendSummary.split(/[,，。；;]/g).filter(Boolean)
  summaryLines.slice(0, 4).forEach((line, i) => {
    ctx.fillText(line.trim(), PADDING + 20, y + 80 + i * LINE_HEIGHT)
  })
  y += 220

  if (data.aiInsight) {
    ctx.fillStyle = COLORS.sectionBg
    ctx.fillRect(PADDING, y, CANVAS_WIDTH - PADDING * 2, 120)

    ctx.fillStyle = COLORS.primary
    ctx.font = `bold ${SUBTITLE_FONT_SIZE}px sans-serif`
    ctx.textAlign = 'left'
    ctx.fillText('AI 分析', PADDING + 20, y + 40)

    ctx.fillStyle = COLORS.text
    ctx.font = `${BODY_FONT_SIZE}px sans-serif`
    ctx.fillText(data.aiInsight, PADDING + 20, y + 85)
    y += 140
  }

  y += 40
  y = drawInviteCode(ctx, y, data.inviteCode)
  drawBrandFooter(ctx, y)
  ctx.restore()
}

export function drawVaccineShareImage(ctx: CanvasRenderingContext2D, data: VaccineShareImageData): void {
  let y = PADDING
  ctx.fillStyle = COLORS.background
  ctx.fillRect(0, 0, CANVAS_WIDTH, CARD_HEIGHT)

  y = drawBrandHeader(ctx, y) + 20

  ctx.save()
  ctx.fillStyle = COLORS.success
  ctx.font = 'bold 48px sans-serif'
  ctx.textAlign = 'center'
  ctx.fillText('🏆', CANVAS_WIDTH / 2, y + 50)
  y += 80

  ctx.fillStyle = COLORS.text
  ctx.font = `bold ${TITLE_FONT_SIZE}px sans-serif`
  ctx.fillText(data.badgeTitle, CANVAS_WIDTH / 2, y + 40)
  y += 70

  ctx.fillStyle = COLORS.sectionBg
  ctx.fillRect(PADDING, y, CANVAS_WIDTH - PADDING * 2, 200)

  ctx.fillStyle = COLORS.text
  ctx.font = `bold ${SUBTITLE_FONT_SIZE}px sans-serif`
  ctx.textAlign = 'left'
  ctx.fillText(data.petName, PADDING + 20, y + 50)

  ctx.fillStyle = COLORS.textSecondary
  ctx.font = `${BODY_FONT_SIZE}px sans-serif`
  ctx.fillText(`完成接种：${data.vaccineName}`, PADDING + 20, y + 100)
  ctx.fillText(`完成日期：${data.completedDate}`, PADDING + 20, y + 145)
  y += 220

  ctx.fillStyle = COLORS.textLight
  ctx.font = `${BODY_FONT_SIZE}px sans-serif`
  ctx.textAlign = 'center'
  ctx.fillText('负责任的毛孩子家长', CANVAS_WIDTH / 2, y + 30)
  y += 60

  y = drawInviteCode(ctx, y, data.inviteCode)
  drawBrandFooter(ctx, y)
  ctx.restore()
}

export function drawAchievementShareImage(ctx: CanvasRenderingContext2D, data: AchievementShareImageData): void {
  let y = PADDING
  ctx.fillStyle = COLORS.background
  ctx.fillRect(0, 0, CANVAS_WIDTH, CARD_HEIGHT)

  y = drawBrandHeader(ctx, y) + 20

  ctx.save()
  ctx.fillStyle = data.achievementColor
  ctx.font = 'bold 64px sans-serif'
  ctx.textAlign = 'center'
  ctx.fillText(data.achievementIcon, CANVAS_WIDTH / 2, y + 70)
  y += 100

  ctx.fillStyle = data.achievementColor
  ctx.font = `bold ${TITLE_FONT_SIZE}px sans-serif`
  ctx.fillText(data.achievementTitle, CANVAS_WIDTH / 2, y + 40)
  y += 70

  ctx.fillStyle = COLORS.textSecondary
  ctx.font = `${SUBTITLE_FONT_SIZE}px sans-serif`
  ctx.fillText(data.achievementSubtitle, CANVAS_WIDTH / 2, y + 30)
  y += 60

  ctx.fillStyle = COLORS.sectionBg
  ctx.fillRect(PADDING, y, CANVAS_WIDTH - PADDING * 2, 120)

  ctx.fillStyle = COLORS.text
  ctx.font = `bold ${SUBTITLE_FONT_SIZE}px sans-serif`
  ctx.textAlign = 'left'
  ctx.fillText(data.petName, PADDING + 20, y + 70)
  y += 140

  y = drawInviteCode(ctx, y, data.inviteCode)
  drawBrandFooter(ctx, y)
  ctx.restore()
}

export async function renderShareCardToCanvas(
  cardType: string,
  data: ShareCardDataType,
  options: ShareCanvasOptions,
): Promise<ShareImageResult> {
  const pixelRatio = options.pixelRatio || 2
  const canvasWidth = options.width || CANVAS_WIDTH
  const canvasHeight = options.height || CARD_HEIGHT

  return new Promise<ShareImageResult>((resolve, reject) => {
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

        const dpr = pixelRatio
        canvas.width = canvasWidth * dpr
        canvas.height = canvasHeight * dpr
        ctx.scale(dpr, dpr)

        switch (cardType) {
          case 'food':
            drawFoodShareImage(ctx, data as FoodShareImageData)
            break
          case 'health_trend':
            drawHealthTrendShareImage(ctx, data as HealthTrendShareImageData)
            break
          case 'vaccine':
            drawVaccineShareImage(ctx, data as VaccineShareImageData)
            break
          case 'achievement':
            drawAchievementShareImage(ctx, data as AchievementShareImageData)
            break
        }

        setTimeout(() => {
          Taro.canvasToTempFilePath({
            canvas,
            width: canvasWidth,
            height: canvasHeight,
            destWidth: canvasWidth * dpr,
            destHeight: canvasHeight * dpr,
            fileType: 'png',
            // 回调参数改名 result：外层 exec 回调已有同名 res（no-shadow）
            success: (result: { tempFilePath: string }) => {
              resolve({ tempFilePath: result.tempFilePath, width: canvasWidth, height: canvasHeight })
            },
            fail: (err: { errMsg: string }) => {
              reject(new Error(`Canvas export failed: ${err.errMsg}`))
            },
          })
        }, 300)
      })
  })
}

export async function saveShareImage(tempFilePath: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    Taro.saveImageToPhotosAlbum({
      filePath: tempFilePath,
      success: () => {
        Taro.showToast({ title: '已保存到相册', icon: 'success' })
        resolve()
      },
      fail: (err: { errMsg: string }) => {
        reject(new Error(`Save to album failed: ${err.errMsg}`))
      },
    })
  })
}
