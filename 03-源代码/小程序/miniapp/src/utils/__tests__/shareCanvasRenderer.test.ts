import { describe, it, expect, vi, beforeEach } from 'vitest'

import {
  drawFoodShareImage,
  drawHealthTrendShareImage,
  drawVaccineShareImage,
  drawAchievementShareImage,
  renderShareCardToCanvas,
  saveShareImage,
} from '../shareCanvasRenderer'

const mockTaro = vi.hoisted(() => ({
  createSelectorQuery: vi.fn(),
  canvasToTempFilePath: vi.fn(),
  saveImageToPhotosAlbum: vi.fn(),
  showToast: vi.fn(),
}))

vi.mock('@tarojs/taro', () => ({ default: mockTaro, ...mockTaro }))

interface MockContext {
  fillStyle: string
  strokeStyle: string
  font: string
  textAlign: string
  fillRect: ReturnType<typeof vi.fn>
  fillText: ReturnType<typeof vi.fn>
  strokeRect: ReturnType<typeof vi.fn>
  beginPath: ReturnType<typeof vi.fn>
  moveTo: ReturnType<typeof vi.fn>
  lineTo: ReturnType<typeof vi.fn>
  stroke: ReturnType<typeof vi.fn>
  arc: ReturnType<typeof vi.fn>
  fill: ReturnType<typeof vi.fn>
  drawImage: ReturnType<typeof vi.fn>
  save: ReturnType<typeof vi.fn>
  restore: ReturnType<typeof vi.fn>
  scale: ReturnType<typeof vi.fn>
  measureText: ReturnType<typeof vi.fn>
  clip: ReturnType<typeof vi.fn>
  closePath: ReturnType<typeof vi.fn>
}

function createMockCtx(): MockContext {
  return {
    fillStyle: '',
    strokeStyle: '',
    font: '',
    textAlign: 'left',
    fillRect: vi.fn(),
    fillText: vi.fn(),
    strokeRect: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    drawImage: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    scale: vi.fn(),
    measureText: vi.fn().mockReturnValue({ width: 100 }),
    clip: vi.fn(),
    closePath: vi.fn(),
  }
}

function asCtx(ctx: MockContext): CanvasRenderingContext2D {
  return ctx as unknown as CanvasRenderingContext2D
}

describe('shareCanvasRenderer', () => {
  let ctx: MockContext

  beforeEach(() => {
    ctx = createMockCtx()
    vi.clearAllMocks()
  })

  describe('drawFoodShareImage', () => {
    it('绘制食物安全分享卡片', () => {
      drawFoodShareImage(asCtx(ctx), {
        foodName: '巧克力',
        safetyLevel: 'toxic',
        petName: '咪咪',
        dangerousCompounds: ['可可碱', '咖啡因'],
        symptoms: ['呕吐', '腹泻', '心跳加速'],
      })
      expect(ctx.fillText).toHaveBeenCalled()
      const calls = ctx.fillText.mock.calls.map(c => c[0] as string)
      expect(calls.some(t => t.includes('巧克力'))).toBe(true)
      expect(calls.some(t => t.includes('有毒'))).toBe(true)
      expect(calls.some(t => t.includes('咪咪'))).toBe(true)
    })

    it('无危险成分和症状时不绘制对应区域', () => {
      drawFoodShareImage(asCtx(ctx), {
        foodName: '鸡胸肉',
        safetyLevel: 'safe',
        petName: '旺财',
      })
      const calls = ctx.fillText.mock.calls.map(c => c[0] as string)
      expect(calls.some(t => t.includes('鸡胸肉'))).toBe(true)
      expect(calls.some(t => t.includes('安全'))).toBe(true)
    })
  })

  describe('drawHealthTrendShareImage', () => {
    it('绘制健康趋势分享卡片', () => {
      drawHealthTrendShareImage(asCtx(ctx), {
        petName: '旺财',
        dateRange: '2025-01 ~ 2025-06',
        trendSummary: '体重稳定，食欲正常',
        aiInsight: '整体健康状态良好',
      })
      expect(ctx.fillText).toHaveBeenCalled()
      const calls = ctx.fillText.mock.calls.map(c => c[0] as string)
      expect(calls.some(t => t.includes('旺财'))).toBe(true)
      expect(calls.some(t => t.includes('体重稳定'))).toBe(true)
      expect(calls.some(t => t.includes('AI 分析'))).toBe(true)
    })

    it('无AI分析时不绘制AI区域', () => {
      drawHealthTrendShareImage(asCtx(ctx), {
        petName: '旺财',
        dateRange: '2025-01 ~ 2025-06',
        trendSummary: '体重稳定',
        aiInsight: '',
      })
      const calls = ctx.fillText.mock.calls.map(c => c[0] as string)
      expect(calls.some(t => t.includes('AI 分析'))).toBe(false)
    })
  })

  describe('drawVaccineShareImage', () => {
    it('绘制疫苗完成分享卡片', () => {
      drawVaccineShareImage(asCtx(ctx), {
        petName: '咪咪',
        vaccineName: '猫三联',
        completedDate: '2025-06-15',
        badgeTitle: '疫苗卫士',
      })
      expect(ctx.fillText).toHaveBeenCalled()
      const calls = ctx.fillText.mock.calls.map(c => c[0] as string)
      expect(calls.some(t => t.includes('咪咪'))).toBe(true)
      expect(calls.some(t => t.includes('猫三联'))).toBe(true)
      expect(calls.some(t => t.includes('疫苗卫士'))).toBe(true)
      expect(calls.some(t => t.includes('2025-06-15'))).toBe(true)
    })
  })

  describe('drawAchievementShareImage', () => {
    it('绘制成就纪念分享卡片', () => {
      drawAchievementShareImage(asCtx(ctx), {
        petName: '旺财',
        achievementTitle: '连续7天',
        achievementSubtitle: '一周健康打卡',
        achievementIcon: '⭐',
        achievementColor: '#FFD700',
      })
      expect(ctx.fillText).toHaveBeenCalled()
      const calls = ctx.fillText.mock.calls.map(c => c[0] as string)
      expect(calls.some(t => t.includes('旺财'))).toBe(true)
      expect(calls.some(t => t.includes('连续7天'))).toBe(true)
    })
  })

  describe('renderShareCardToCanvas', () => {
    it('Canvas节点不存在时reject', async () => {
      mockTaro.createSelectorQuery.mockReturnValue({
        select: vi.fn().mockReturnValue({
          fields: vi.fn().mockReturnValue({
            exec: vi.fn().mockImplementation((cb: any) => cb([null])),
          }),
        }),
      })
      await expect(renderShareCardToCanvas('food', {} as any, { canvasId: 'test-canvas' }))
        .rejects.toThrow('Canvas context not found')
    })

    it('Canvas导出失败时reject', async () => {
      const mockCtx = createMockCtx()
      mockTaro.createSelectorQuery.mockReturnValue({
        select: vi.fn().mockReturnValue({
          fields: vi.fn().mockReturnValue({
            exec: vi.fn().mockImplementation((cb: any) => cb([{
              node: {
                getContext: vi.fn().mockReturnValue(mockCtx),
                width: 0,
                height: 0,
              },
            }])),
          }),
        }),
      })
      mockTaro.canvasToTempFilePath.mockImplementation((opts: any) => opts.fail({ errMsg: 'export error' }))
      await expect(renderShareCardToCanvas('food', {
        foodName: '巧克力',
        safetyLevel: 'toxic',
        petName: '咪咪',
      }, { canvasId: 'test-canvas' }))
        .rejects.toThrow('Canvas export failed')
    })
  })

  describe('saveShareImage', () => {
    it('保存图片到相册成功', async () => {
      mockTaro.saveImageToPhotosAlbum.mockImplementation((opts: any) => opts.success())
      await saveShareImage('/tmp/test.png')
      expect(mockTaro.saveImageToPhotosAlbum).toHaveBeenCalled()
    })

    it('保存图片到相册失败', async () => {
      mockTaro.saveImageToPhotosAlbum.mockImplementation((opts: any) => opts.fail({ errMsg: 'denied' }))
      await expect(saveShareImage('/tmp/test.png')).rejects.toThrow('Save to album failed')
    })
  })
})
