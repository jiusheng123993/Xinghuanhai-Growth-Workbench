/**
 * 家庭合照生成服务
 *
 * Canvas 绘制宠物全家福图片，含装饰元素/头像/文字，支持保存和分享
 */
import Taro from '@tarojs/taro'
import type { PetProfile } from './petService'

// ==================== AI 全家福生成 ====================

/** 全家福风格类型 */
export type FamilyPhotoStyle = 'pixar' | 'ghibli' | 'oil' | 'ink' | 'nordic' | 'cyberpunk'

/** 风格标签映射 */
export const FAMILY_PHOTO_STYLE_LABELS: Record<FamilyPhotoStyle, { label: string; emoji: string }> = {
  pixar: { label: '皮克斯3D', emoji: '🎬' },
  ghibli: { label: '吉卜力动漫', emoji: '🌿' },
  oil: { label: '油画印象', emoji: '🎨' },
  ink: { label: '水墨中国', emoji: '🏮' },
  nordic: { label: '极简北欧', emoji: '🪵' },
  cyberpunk: { label: '赛博朋克', emoji: '🤖' },
}

/** 所有风格列表 */
export const FAMILY_PHOTO_STYLES: FamilyPhotoStyle[] = ['pixar', 'ghibli', 'oil', 'ink', 'nordic', 'cyberpunk']

// ==================== 全家福场景模板 ====================
// 场景 key 与服务端 familyPhotoService.ts 的 FAMILY_PHOTO_SCENES 保持一致（有单测锁同步）；
// 场景描写在服务端 SCENE_PROMPTS（时间光线+空间层次+道具细节+色彩基调+氛围的多维组合）

/** 全家福场景类型（与服务端白名单一致） */
export type FamilyPhotoScene =
  | 'livingroom' | 'window' | 'futon' | 'bookshelf'          // 居家时光
  | 'sakura' | 'garden' | 'autumn' | 'snow' | 'lavender' | 'forest'  // 四季自然
  | 'christmas' | 'birthday' | 'lunarnewyear' | 'midautumn'  // 节日庆典
  | 'seaside' | 'roof' | 'cafe' | 'camping'                  // 旅行见闻
  | 'aurora' | 'clouds' | 'monet' | 'ocean'                  // 梦幻唯美

/** 场景标签映射（宫格选择器与相册标签共用） */
export const FAMILY_PHOTO_SCENE_LABELS: Record<FamilyPhotoScene, { label: string; emoji: string }> = {
  livingroom: { label: '温馨客厅', emoji: '🛋️' },
  window: { label: '窗边午后', emoji: '🪟' },
  futon: { label: '日式和室', emoji: '🍵' },
  bookshelf: { label: '复古书房', emoji: '📚' },
  sakura: { label: '樱花树下', emoji: '🌸' },
  garden: { label: '夏日花园', emoji: '🌳' },
  autumn: { label: '秋日庭院', emoji: '🍁' },
  snow: { label: '冬日雪原', emoji: '❄️' },
  lavender: { label: '薰衣草花田', emoji: '💜' },
  forest: { label: '森林秘境', emoji: '🍄' },
  christmas: { label: '圣诞之夜', emoji: '🎄' },
  birthday: { label: '生日派对', emoji: '🎂' },
  lunarnewyear: { label: '新春灯笼', emoji: '🧧' },
  midautumn: { label: '中秋月圆', emoji: '🌕' },
  seaside: { label: '海边日落', emoji: '🏖️' },
  roof: { label: '城市天台', emoji: '🌇' },
  cafe: { label: '复古咖啡馆', emoji: '☕' },
  camping: { label: '星空露营', emoji: '⛺' },
  aurora: { label: '极光冰原', emoji: '🌌' },
  clouds: { label: '云端彩虹', emoji: '☁️' },
  monet: { label: '莫奈花园', emoji: '🎨' },
  ocean: { label: '梦幻海底', emoji: '🐚' },
}

/** 默认场景（温馨客厅） */
export const DEFAULT_FAMILY_PHOTO_SCENE: FamilyPhotoScene = 'livingroom'

/** 场景主题分组（五大主题，宫格按组展示避免 22 个 chip 一屏铺满） */
export interface FamilyPhotoSceneGroup {
  key: string
  label: string
  emoji: string
  /** 该分组下的场景 key 列表 */
  scenes: FamilyPhotoScene[]
}

/** 五大主题分组 */
export const FAMILY_PHOTO_SCENE_GROUPS: FamilyPhotoSceneGroup[] = [
  { key: 'home', label: '居家时光', emoji: '🏠', scenes: ['livingroom', 'window', 'futon', 'bookshelf'] },
  { key: 'nature', label: '四季自然', emoji: '🌸', scenes: ['sakura', 'garden', 'autumn', 'snow', 'lavender', 'forest'] },
  { key: 'festival', label: '节日庆典', emoji: '🎄', scenes: ['christmas', 'birthday', 'lunarnewyear', 'midautumn'] },
  { key: 'travel', label: '旅行见闻', emoji: '✈️', scenes: ['seaside', 'roof', 'cafe', 'camping'] },
  { key: 'dream', label: '梦幻唯美', emoji: '✨', scenes: ['aurora', 'clouds', 'monet', 'ocean'] },
]

// ==================== Canvas 绘制 ====================

const CANVAS_WIDTH = 750
const CANVAS_HEIGHT = 1000
const BRAND_COLORS = {
  primary: '#FF8C42',
  gold: '#D4A574',
  text: '#333333',
  textSecondary: '#666666',
  textLight: '#999999',
  background: '#FFF8F0',
  cardBg: '#FFFFFF',
  border: '#F0E0D0',
  accent: '#E8A87C',
}

export interface FamilyPhotoData {
  familyName: string
  members: Array<{
    name: string
    emoji: string
    role: string
  }>
  date: string
}

export interface FamilyPhotoResult {
  tempFilePath: string
  width: number
  height: number
}

export function buildFamilyPhotoData(
  familyName: string,
  pets: PetProfile[],
  roles: Record<string, string>,
): FamilyPhotoData {
  return {
    familyName,
    members: pets.map(pet => ({
      name: pet.name,
      emoji: pet.species === 'cat' ? '🐱' : '🐕',
      role: roles[pet.id] || '',
    })),
    date: new Date().toISOString().slice(0, 10),
  }
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

function drawGradientBg(ctx: CanvasRenderingContext2D): void {
  const gradient = ctx.createLinearGradient(0, 0, 0, CANVAS_HEIGHT)
  gradient.addColorStop(0, '#FFF8F0')
  gradient.addColorStop(0.5, '#FFFDF8')
  gradient.addColorStop(1, '#FFF5EC')
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT)
}

function drawDecorativeCircles(ctx: CanvasRenderingContext2D): void {
  ctx.save()
  ctx.globalAlpha = 0.08

  ctx.fillStyle = BRAND_COLORS.gold
  ctx.beginPath()
  ctx.arc(80, 100, 150, 0, Math.PI * 2)
  ctx.fill()

  ctx.beginPath()
  ctx.arc(670, 800, 120, 0, Math.PI * 2)
  ctx.fill()

  ctx.beginPath()
  ctx.arc(100, 700, 80, 0, Math.PI * 2)
  ctx.fill()

  ctx.globalAlpha = 0.05
  ctx.fillStyle = BRAND_COLORS.primary
  ctx.beginPath()
  ctx.arc(600, 150, 100, 0, Math.PI * 2)
  ctx.fill()

  ctx.restore()
}

function drawHeader(ctx: CanvasRenderingContext2D, data: FamilyPhotoData): number {
  ctx.save()

  ctx.fillStyle = BRAND_COLORS.text
  ctx.font = 'bold 48px sans-serif'
  ctx.textAlign = 'center'
  ctx.fillText('🏡 全家福', CANVAS_WIDTH / 2, 100)

  ctx.fillStyle = BRAND_COLORS.accent
  ctx.font = 'bold 32px sans-serif'
  ctx.fillText(data.familyName, CANVAS_WIDTH / 2, 145)

  ctx.fillStyle = BRAND_COLORS.textLight
  ctx.font = '22px sans-serif'
  ctx.fillText(data.date, CANVAS_WIDTH / 2, 178)

  ctx.restore()
  return 210
}

function drawFamilyFrame(ctx: CanvasRenderingContext2D, data: FamilyPhotoData): number {
  const memberCount = data.members.length
  if (memberCount === 0) return 0

  const startY = 230
  const framePadding = 60
  const frameTop = startY
  const frameLeft = framePadding

  let columns = 1
  let avatarSize = 120
  if (memberCount === 2) { columns = 2; avatarSize = 130 }
  else if (memberCount === 3) { columns = 3; avatarSize = 110 }
  else if (memberCount === 4) { columns = 2; avatarSize = 110 }
  else if (memberCount <= 6) { columns = 3; avatarSize = 90 }
  else { columns = 4; avatarSize = 80 }

  const rows = Math.ceil(memberCount / columns)
  const cellW = (CANVAS_WIDTH - framePadding * 2) / columns
  const contentHeight = rows * (avatarSize + 80)

  const frameHeight = contentHeight + 80
  const frameWidth = CANVAS_WIDTH - framePadding * 2

  ctx.save()

  ctx.shadowColor = 'rgba(0,0,0,0.08)'
  ctx.shadowBlur = 20
  ctx.shadowOffsetY = 4
  ctx.fillStyle = BRAND_COLORS.cardBg
  drawRoundedRect(ctx, frameLeft, frameTop, frameWidth, frameHeight, 24)
  ctx.fill()
  ctx.shadowColor = 'transparent'

  ctx.strokeStyle = BRAND_COLORS.border
  ctx.lineWidth = 2
  drawRoundedRect(ctx, frameLeft, frameTop, frameWidth, frameHeight, 24)
  ctx.stroke()

  data.members.forEach((member, index) => {
    const col = index % columns
    const row = Math.floor(index / columns)
    const cx = frameLeft + cellW * col + cellW / 2
    const cy = frameTop + 50 + row * (avatarSize + 70)

    const circleRadius = avatarSize / 2

    ctx.beginPath()
    ctx.arc(cx, cy - 8, circleRadius + 6, 0, Math.PI * 2)
    ctx.fillStyle = BRAND_COLORS.border
    ctx.fill()

    ctx.beginPath()
    ctx.arc(cx, cy - 8, circleRadius, 0, Math.PI * 2)
    ctx.fillStyle = '#FFF5EC'
    ctx.fill()
    ctx.strokeStyle = BRAND_COLORS.accent
    ctx.lineWidth = 3
    ctx.stroke()

    ctx.font = `${Math.round(avatarSize * 0.5)}px sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(member.emoji, cx, cy - 8)

    ctx.fillStyle = BRAND_COLORS.text
    ctx.font = 'bold 24px sans-serif'
    ctx.textBaseline = 'top'
    ctx.fillText(member.name, cx, cy + circleRadius + 6)

    if (member.role) {
      ctx.fillStyle = BRAND_COLORS.gold
      ctx.font = '20px sans-serif'
      ctx.fillText(member.role, cx, cy + circleRadius + 34)
    }
  })

  ctx.restore()
  return frameTop + frameHeight + 30
}

function drawFooter(ctx: CanvasRenderingContext2D): void {
  ctx.save()

  const footerY = CANVAS_HEIGHT - 100
  ctx.strokeStyle = BRAND_COLORS.border
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(80, footerY)
  ctx.lineTo(CANVAS_WIDTH - 80, footerY)
  ctx.stroke()

  ctx.fillStyle = BRAND_COLORS.textLight
  ctx.font = '20px sans-serif'
  ctx.textAlign = 'center'
  ctx.fillText('星河宠记 · 记录毛孩子的温暖时光', CANVAS_WIDTH / 2, footerY + 40)
  ctx.fillText('长按保存 · 分享给家人', CANVAS_WIDTH / 2, footerY + 70)

  ctx.restore()
}

export function drawFamilyPhoto(ctx: CanvasRenderingContext2D, data: FamilyPhotoData): void {
  drawGradientBg(ctx)
  drawDecorativeCircles(ctx)
  drawHeader(ctx, data)
  drawFamilyFrame(ctx, data)
  drawFooter(ctx)
}

export async function renderFamilyPhoto(
  data: FamilyPhotoData,
  options: {
    canvasId: string
    pixelRatio?: number
    width?: number
    height?: number
  },
): Promise<FamilyPhotoResult> {
  const pixelRatio = options.pixelRatio || 2
  const canvasWidth = options.width || CANVAS_WIDTH
  const canvasHeight = options.height || CANVAS_HEIGHT

  return new Promise<FamilyPhotoResult>((resolve, reject) => {
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

        drawFamilyPhoto(ctx, data)

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

export async function saveFamilyPhoto(tempFilePath: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    Taro.saveImageToPhotosAlbum({
      filePath: tempFilePath,
      success: () => {
        Taro.showToast({ title: '全家福已保存到相册', icon: 'success' })
        resolve()
      },
      fail: (err: { errMsg: string }) => {
        reject(new Error(`Save failed: ${err.errMsg}`))
      },
    })
  })
}

export async function shareFamilyPhoto(tempFilePath: string): Promise<void> {
  try {
    await Taro.showShareImageMenu({ path: tempFilePath })
  } catch {
    Taro.previewImage({
      urls: [tempFilePath],
      current: tempFilePath,
    })
  }
}
