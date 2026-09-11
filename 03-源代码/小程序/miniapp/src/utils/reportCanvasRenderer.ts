import Taro from '@tarojs/taro'
import type { HealthReportData, CanvasRenderOptions, ReportImageResult } from '../types/reportTypes'

const CANVAS_WIDTH = 750
const PADDING = 40
const SECTION_GAP = 30
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
}

interface LayoutSection {
  type: 'header' | 'profile' | 'entries' | 'symptoms' | 'ai_analysis' | 'vaccines' | 'footer'
  y: number
  height: number
}

interface LayoutResult {
  totalHeight: number
  sections: LayoutSection[]
}

export function calculateReportLayout(data: HealthReportData): LayoutResult {
  const sections: LayoutSection[] = []
  let currentY = PADDING

  const headerHeight = 120
  sections.push({ type: 'header', y: currentY, height: headerHeight })
  currentY += headerHeight + SECTION_GAP

  const profileHeight = 200
  sections.push({ type: 'profile', y: currentY, height: profileHeight })
  currentY += profileHeight + SECTION_GAP

  const entryCount = Math.min(data.entries.length, 14)
  const entriesHeight = 80 + entryCount * LINE_HEIGHT
  sections.push({ type: 'entries', y: currentY, height: entriesHeight })
  currentY += entriesHeight + SECTION_GAP

  if (data.symptoms.length > 0) {
    const symptomCount = Math.min(data.symptoms.length, 5)
    const symptomsHeight = 80 + symptomCount * (LINE_HEIGHT * 3)
    sections.push({ type: 'symptoms', y: currentY, height: symptomsHeight })
    currentY += symptomsHeight + SECTION_GAP
  }

  if (data.aiAnalysis) {
    const aiAnalysisHeight = 120
    sections.push({ type: 'ai_analysis', y: currentY, height: aiAnalysisHeight })
    currentY += aiAnalysisHeight + SECTION_GAP
  }

  if (data.vaccines.length > 0) {
    const vaccineHeight = 80 + data.vaccines.length * LINE_HEIGHT
    sections.push({ type: 'vaccines', y: currentY, height: vaccineHeight })
    currentY += vaccineHeight + SECTION_GAP
  }

  const footerHeight = 120
  sections.push({ type: 'footer', y: currentY, height: footerHeight })
  currentY += footerHeight + PADDING

  return { totalHeight: currentY, sections }
}

export function drawReportHeader(
  ctx: CanvasRenderingContext2D,
  data: HealthReportData,
  y: number,
  _canvasWidth: number,
): number {
  ctx.save()
  ctx.fillStyle = COLORS.primary
  ctx.font = `bold ${TITLE_FONT_SIZE}px sans-serif`
  ctx.textAlign = 'center'
  ctx.fillText(`${data.pet.name}的健康报告`, CANVAS_WIDTH / 2, y + 50)

  ctx.fillStyle = COLORS.textSecondary
  ctx.font = `${SMALL_FONT_SIZE}px sans-serif`
  ctx.fillText(data.period, CANVAS_WIDTH / 2, y + 90)
  ctx.restore()
  return y + 120
}

export function drawPetProfile(
  ctx: CanvasRenderingContext2D,
  data: HealthReportData,
  y: number,
): number {
  ctx.save()
  ctx.fillStyle = COLORS.sectionBg
  ctx.fillRect(PADDING, y, CANVAS_WIDTH - PADDING * 2, 180)

  ctx.fillStyle = COLORS.primary
  ctx.font = `bold ${SUBTITLE_FONT_SIZE}px sans-serif`
  ctx.textAlign = 'left'
  ctx.fillText('宠物档案', PADDING + 20, y + 40)

  ctx.fillStyle = COLORS.text
  ctx.font = `${BODY_FONT_SIZE}px sans-serif`

  const info = [
    `品种：${data.pet.breed}`,
    `性别：${data.pet.gender === 'female' ? '母' : data.pet.gender === 'male' ? '公' : '未知'}${data.pet.neutered ? '（已绝育）' : ''}`,
    `出生日期：${data.pet.birthDate}`,
    `当前体重：${data.pet.weight}kg`,
  ]

  if (data.pet.allergies.length > 0) {
    info.push(`过敏史：${data.pet.allergies.join('、')}`)
  }

  info.forEach((line, i) => {
    ctx.fillText(line, PADDING + 20, y + 75 + i * LINE_HEIGHT)
  })

  ctx.restore()
  return y + 200
}

export function drawHealthEntries(
  ctx: CanvasRenderingContext2D,
  entries: HealthReportData['entries'],
  y: number,
  _canvasWidth: number,
): number {
  ctx.save()

  ctx.fillStyle = COLORS.primary
  ctx.font = `bold ${SUBTITLE_FONT_SIZE}px sans-serif`
  ctx.textAlign = 'left'
  ctx.fillText('健康记录', PADDING + 20, y + 35)

  if (entries.length === 0) {
    ctx.fillStyle = COLORS.textLight
    ctx.font = `${BODY_FONT_SIZE}px sans-serif`
    ctx.fillText('暂无打卡记录', PADDING + 20, y + 75)
    ctx.restore()
    return y + 80
  }

  const displayEntries = entries.slice(0, 14)

  ctx.fillStyle = COLORS.textSecondary
  ctx.font = `${SMALL_FONT_SIZE}px sans-serif`
  ctx.fillText('日期', PADDING + 20, y + 70)
  ctx.fillText('便便', PADDING + 180, y + 70)
  ctx.fillText('食欲', PADDING + 300, y + 70)
  ctx.fillText('精神', PADDING + 420, y + 70)
  ctx.fillText('体重', PADDING + 540, y + 70)

  ctx.strokeStyle = COLORS.border
  ctx.beginPath()
  ctx.moveTo(PADDING + 20, y + 80)
  ctx.lineTo(CANVAS_WIDTH - PADDING - 20, y + 80)
  ctx.stroke()

  displayEntries.forEach((entry, i) => {
    const rowY = y + 110 + i * LINE_HEIGHT
    ctx.fillStyle = COLORS.text
    ctx.font = `${SMALL_FONT_SIZE}px sans-serif`
    ctx.fillText(entry.date.slice(5), PADDING + 20, rowY)
    ctx.fillText(entry.bowel, PADDING + 180, rowY)
    ctx.fillText(entry.appetite, PADDING + 300, rowY)
    ctx.fillText(entry.energy, PADDING + 420, rowY)
    ctx.fillText(entry.weight ? `${entry.weight}kg` : '-', PADDING + 540, rowY)
  })

  ctx.restore()
  return y + 80 + displayEntries.length * LINE_HEIGHT
}

export function drawSymptomRecords(
  ctx: CanvasRenderingContext2D,
  symptoms: HealthReportData['symptoms'],
  y: number,
  _canvasWidth: number,
): number {
  if (symptoms.length === 0) return y

  ctx.save()

  ctx.fillStyle = COLORS.primary
  ctx.font = `bold ${SUBTITLE_FONT_SIZE}px sans-serif`
  ctx.textAlign = 'left'
  ctx.fillText('症状检查记录', PADDING + 20, y + 35)

  const displaySymptoms = symptoms.slice(0, 5)

  displaySymptoms.forEach((record, i) => {
    const rowY = y + 70 + i * (LINE_HEIGHT * 3)

    ctx.fillStyle = COLORS.text
    ctx.font = `${BODY_FONT_SIZE}px sans-serif`
    ctx.fillText(record.date, PADDING + 20, rowY)

    const riskColor = record.urgencyLevel === 'emergency'
      ? COLORS.danger
      : record.urgencyLevel === 'warning'
        ? COLORS.warning
        : record.urgencyLevel === 'caution'
          ? '#FAAD14'
          : COLORS.success
    const riskLabel = record.urgencyLevel === 'emergency'
      ? '紧急'
      : record.urgencyLevel === 'warning'
        ? '警告'
        : record.urgencyLevel === 'caution'
          ? '注意'
          : '正常'
    ctx.fillStyle = riskColor
    ctx.font = `bold ${SMALL_FONT_SIZE}px sans-serif`
    ctx.fillText(riskLabel, CANVAS_WIDTH - PADDING - 80, rowY)

    ctx.fillStyle = COLORS.textSecondary
    ctx.font = `${SMALL_FONT_SIZE}px sans-serif`
    const symptomText = record.symptoms.length > 0 ? record.symptoms.join('、') : '无'
    ctx.fillText(`症状：${symptomText}`, PADDING + 20, rowY + LINE_HEIGHT)

    const adviceText = record.aiAssessment.length > 40
      ? record.aiAssessment.slice(0, 40) + '...'
      : record.aiAssessment
    ctx.fillText(`AI建议：${adviceText}`, PADDING + 20, rowY + LINE_HEIGHT * 2)

    if (i < displaySymptoms.length - 1) {
      ctx.strokeStyle = COLORS.border
      ctx.beginPath()
      ctx.moveTo(PADDING + 20, rowY + LINE_HEIGHT * 2 + 10)
      ctx.lineTo(CANVAS_WIDTH - PADDING - 20, rowY + LINE_HEIGHT * 2 + 10)
      ctx.stroke()
    }
  })

  ctx.restore()
  return y + 80 + displaySymptoms.length * (LINE_HEIGHT * 3)
}

export function drawAiAnalysis(
  ctx: CanvasRenderingContext2D,
  aiAnalysis: string,
  y: number,
  _canvasWidth: number,
): number {
  ctx.save()

  ctx.fillStyle = COLORS.sectionBg
  ctx.fillRect(PADDING, y, CANVAS_WIDTH - PADDING * 2, 100)

  ctx.fillStyle = COLORS.primary
  ctx.font = `bold ${SUBTITLE_FONT_SIZE}px sans-serif`
  ctx.textAlign = 'left'
  ctx.fillText('AI趋势分析', PADDING + 20, y + 35)

  ctx.fillStyle = COLORS.textSecondary
  ctx.font = `${BODY_FONT_SIZE}px sans-serif`

  const displayText = aiAnalysis.length > 200 ? aiAnalysis.slice(0, 200) + '...' : aiAnalysis
  const maxWidth = CANVAS_WIDTH - PADDING * 2 - 40
  const lines: string[] = []
  let currentLine = ''

  for (const char of displayText) {
    const testLine = currentLine + char
    const metrics = ctx.measureText(testLine)
    if (metrics.width > maxWidth && currentLine.length > 0) {
      lines.push(currentLine)
      currentLine = char
    } else {
      currentLine = testLine
    }
  }
  if (currentLine) {
    lines.push(currentLine)
  }

  lines.forEach((line, i) => {
    ctx.fillText(line, PADDING + 20, y + 65 + i * LINE_HEIGHT)
  })

  ctx.restore()
  return y + 120
}

export function drawVaccineRecords(
  ctx: CanvasRenderingContext2D,
  vaccines: HealthReportData['vaccines'],
  y: number,
  _canvasWidth: number,
): number {
  if (vaccines.length === 0) return y

  ctx.save()

  ctx.fillStyle = COLORS.primary
  ctx.font = `bold ${SUBTITLE_FONT_SIZE}px sans-serif`
  ctx.textAlign = 'left'
  ctx.fillText('疫苗记录', PADDING + 20, y + 35)

  vaccines.forEach((vaccine, i) => {
    const rowY = y + 70 + i * LINE_HEIGHT
    ctx.fillStyle = COLORS.text
    ctx.font = `${BODY_FONT_SIZE}px sans-serif`
    ctx.fillText(vaccine.name, PADDING + 20, rowY)

    ctx.fillStyle = COLORS.textSecondary
    ctx.font = `${SMALL_FONT_SIZE}px sans-serif`
    const dateStr = vaccine.dateGiven || vaccine.dateDue
    ctx.fillText(dateStr, PADDING + 250, rowY)

    const statusLabel = vaccine.status === 'done' ? '已接种' : vaccine.status === 'pending' ? '待接种' : '已逾期'
    ctx.fillStyle = vaccine.status === 'done' ? COLORS.success : vaccine.status === 'overdue' ? COLORS.danger : COLORS.warning
    ctx.fillText(statusLabel, PADDING + 500, rowY)
  })

  ctx.restore()
  return y + 80 + vaccines.length * LINE_HEIGHT
}

export function drawReportFooter(
  ctx: CanvasRenderingContext2D,
  generatedAt: string,
  y: number,
  _canvasWidth: number,
): number {
  ctx.save()

  ctx.strokeStyle = COLORS.border
  ctx.beginPath()
  ctx.moveTo(PADDING + 20, y)
  ctx.lineTo(CANVAS_WIDTH - PADDING - 20, y)
  ctx.stroke()

  ctx.fillStyle = COLORS.textLight
  ctx.font = `${SMALL_FONT_SIZE}px sans-serif`
  ctx.textAlign = 'center'
  ctx.fillText('⚠️ 本报告仅供参考，不替代兽医诊断。如发现异常请及时就医。', CANVAS_WIDTH / 2, y + 40)
  ctx.fillText(`生成时间：${generatedAt}`, CANVAS_WIDTH / 2, y + 75)
  ctx.fillText('星河宠记 - 宠物健康管理', CANVAS_WIDTH / 2, y + 105)

  ctx.restore()
  return y + 120
}

export async function renderReportToCanvas(
  data: HealthReportData,
  options: CanvasRenderOptions,
): Promise<ReportImageResult> {
  const layout = calculateReportLayout(data)
  const pixelRatio = options.pixelRatio || 2
  const canvasWidth = options.width || CANVAS_WIDTH
  const canvasHeight = options.height || layout.totalHeight

  return new Promise<ReportImageResult>((resolve, reject) => {
    const query = Taro.createSelectorQuery()
    query
      .select(`#${options.canvasId}`)
      .fields({
        node: true,
        size: true,
      })
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

        ctx.fillStyle = COLORS.background
        ctx.fillRect(0, 0, canvasWidth, canvasHeight)

        let currentY = PADDING

        for (const section of layout.sections) {
          switch (section.type) {
            case 'header':
              currentY = drawReportHeader(ctx, data, currentY, canvasWidth)
              break
            case 'profile':
              currentY = drawPetProfile(ctx, data, currentY)
              break
            case 'entries':
              currentY = drawHealthEntries(ctx, data.entries, currentY, canvasWidth)
              break
            case 'symptoms':
              currentY = drawSymptomRecords(ctx, data.symptoms, currentY, canvasWidth)
              break
            case 'ai_analysis':
              if (data.aiAnalysis) {
                currentY = drawAiAnalysis(ctx, data.aiAnalysis, currentY, canvasWidth)
              }
              break
            case 'vaccines':
              currentY = drawVaccineRecords(ctx, data.vaccines, currentY, canvasWidth)
              break
            case 'footer':
              currentY = drawReportFooter(ctx, data.generatedAt, currentY, canvasWidth)
              break
          }
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
              resolve({
                tempFilePath: result.tempFilePath,
                width: canvasWidth,
                height: canvasHeight,
              })
            },
            fail: (err: { errMsg: string }) => {
              reject(new Error(`Canvas export failed: ${err.errMsg}`))
            },
          })
        }, 300)
      })
  })
}

export async function saveReportImage(tempFilePath: string): Promise<void> {
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
