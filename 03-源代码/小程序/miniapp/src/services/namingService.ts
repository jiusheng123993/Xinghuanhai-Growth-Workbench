/**
 * AI 取名服务
 *
 * 调用 AI 为宠物生成名字建议，含本地缓存
 */
import Taro from '@tarojs/taro'
import { chat, guardCheck } from './aiProvider'
import { checkInput } from '../utils/ruleGuard'
import { requireAuth } from '../utils/authGuard'
import { CONFIG } from '../config'
import { storage } from '../utils/storage'

function sanitizeInput(text: string): string {
  return text.replace(/[<>\n\r]/g, '').substring(0, 50)
}

/**
 * 上传宠物照片用于取名分析
 *
 * ⚠️ petId 必传（2026-09-10 修复）：服务端 `/api/naming/photo/upload` 强校验 petId
 * 且做宠物归属校验（缺失即 400「petId 参数不能为空」）。此前前端**从不传** petId，
 * 于是聊天内取名"上传照片"这一步 100% 失败，只是被 catch 静默成
 * "照片上传失败，我们跳过这一步继续吧～" ——照片从未真正参与取名。
 * @param tempFilePath - 本地临时文件路径（chooseImage 返回值）
 * @param petId - 当前宠物 ID（无宠物时调用方不应发起上传）
 * @returns 上传后的照片 URL（形如 /uploads/pet-photos/<userId>/<petId>/xxx.jpg），失败返回 null
 */
export async function uploadNamingPhoto(tempFilePath: string, petId: string): Promise<string | null> {
  // 无 petId 直接短路：避免必然 400 的无效请求（服务端按归属校验，无法省略该参数）
  if (!petId) return null
  try {
    const token = storage.getToken()
    const res = await Taro.uploadFile({
      url: `${CONFIG.API_BASE_URL}/api/naming/photo/upload`,
      filePath: tempFilePath,
      name: 'photo',
      header: token ? { Authorization: `Bearer ${token}` } : {},
      formData: { petId },
    })

    const data = JSON.parse(res.data) as { success: boolean; data?: { url: string }; url?: string }
    if (data.success) {
      return data.data?.url || data.url || null
    }
    return null
  } catch {
    return null
  }
}

/**
 * 提取取名参考照片的宠物外貌描述（"看图取名"）
 *
 * 背景：AI 取名链路走的是纯文本模型（/api/ai/chat），模型**看不到图片**——
 * 此前只把照片 URL 当文本写进提示词，AI 只能凭空编造外貌。此接口让视觉模型
 * 先看照片、输出毛色/花纹/体型/眼睛等外貌描述，再由前端把描述拼进取名提示词。
 * @param photoUrl - 上传接口返回的相对路径（形如 /uploads/pet-photos/<userId>/<petId>/xxx.jpg）
 * @param petId - 当前宠物 ID（服务端做归属校验：只允许分析自己宠物目录下的照片）
 * @returns 外貌描述（≤100 字）；失败返回 null（调用方按"未识别"降级，不阻塞取名）
 */
export async function extractNamingAppearance(photoUrl: string, petId: string): Promise<string | null> {
  if (!photoUrl || !petId) return null
  try {
    const token = storage.getToken()
    const res = await Taro.request({
      url: `${CONFIG.API_BASE_URL}/api/naming/photo/appearance`,
      method: 'POST',
      header: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      data: { photoUrl, petId },
    })
    if (res.statusCode === 200) {
      const body = res.data as { success?: boolean; data?: { appearance?: string } }
      const appearance = body?.data?.appearance
      return typeof appearance === 'string' && appearance.trim() ? appearance.trim() : null
    }
    return null
  } catch {
    return null
  }
}

/**
 * 解读用户提供的名字
 */
export async function interpretName(
  name: string,
  breed: string,
  birthDate: string
): Promise<string> {
  requireAuth()

  const safeName = sanitizeInput(name)
  const safeBreed = sanitizeInput(breed)
  const safeBirthDate = sanitizeInput(birthDate)

  const ruleResult = checkInput(safeName + safeBreed + safeBirthDate)
  if (ruleResult.blocked) {
    return '抱歉，检测到不安全的输入，请使用其他名字重试。'
  }

  const guardResult = await guardCheck(safeName + safeBreed)
  if (guardResult.isHarmful) {
    return '抱歉，检测到不安全的输入，请使用其他名字重试。'
  }

  const { buildInterpretPrompt } = await import('../utils/namingPrompts')
  const prompt = buildInterpretPrompt(safeName, safeBreed, safeBirthDate)
  return await chat({
    messages: [
      { role: 'system', content: '你是一位精通中国传统文化的取名大师。' },
      { role: 'user', content: prompt },
    ],
    temperature: 0.8,
    // 关闭思考模式（2026-09-10 修复）：开启思考时 reasoning_content 会吃满 max_tokens，
    // 服务端返回的 content 是空串 → 前端只能降级成本地套话，AI 解读从未真正生效
    thinking: 'disabled',
  })
}

export interface RecommendNamesParams {
  breed: string
  birthDate: string
  gender: string
  style?: string
  photoUrl?: string
  description?: string
  /** 物种（cat/dog）：独立取名页手动选择 / 聊天内取名取当前宠物档案（2026-09-10 新增） */
  species?: string
  /** 照片外貌描述（视觉模型提取，见 extractNamingAppearance）：让纯文本模型真正"看到"宠物 */
  appearance?: string
  /** 已推荐过的名字，避免重复 */
  excludeNames?: string[]
}

/**
 * AI 推荐宠物名字
 *
 * 支持传入照片外貌描述、照片 URL 和文字描述，AI 会综合所有信息推荐 5 个名字。
 */
export async function recommendNames(params: RecommendNamesParams): Promise<string> {
  requireAuth()

  const { breed, birthDate, gender, style, photoUrl, description, species, appearance, excludeNames } = params

  const safeBreed = sanitizeInput(breed)
  const safeBirthDate = sanitizeInput(birthDate)
  const safeGender = sanitizeInput(gender)
  const safeStyle = style ? sanitizeInput(style) : undefined
  const safeDesc = description ? sanitizeInput(description) : undefined
  // 外貌描述来自视觉模型（≤100 字）：不能用 sanitizeInput（会截断到 50 字丢信息），
  // 单独做同样的字符清洗 + 放宽到 120 字
  const safeAppearance = appearance ? appearance.replace(/[<>\n\r]/g, '').trim().slice(0, 120) : undefined
  const safeExcludeNames = excludeNames?.filter(n => n.length <= 10).map(n => sanitizeInput(n))

  const ruleResult = checkInput(safeBreed + safeGender + (safeDesc || ''))
  if (ruleResult.blocked) {
    return '抱歉，检测到不安全的输入，请使用其他内容重试。'
  }

  const { buildRecommendPrompt } = await import('../utils/namingPrompts')
  const season = getBirthSeason(safeBirthDate)
  const prompt = buildRecommendPrompt({
    breed: safeBreed,
    birthDate: safeBirthDate,
    gender: safeGender,
    season,
    style: safeStyle,
    photoUrl,
    appearance: safeAppearance,
    description: safeDesc,
    // 物种只接受 cat/dog（白名单），其它值丢弃，避免把自由文本拼进提示词
    species: species === 'cat' || species === 'dog' ? species : undefined,
    excludeNames: safeExcludeNames,
  })

  return await chat({
    messages: [
      { role: 'system', content: '你是一位精通中国文化的宠物取名大师。请严格按JSON格式返回结果。' },
      { role: 'user', content: prompt },
    ],
    temperature: 0.9,
    max_tokens: 2048,
    // 关闭思考模式（2026-09-10 修复，实测：2048 tokens 全被 reasoning 吃掉、content 长度 0，
    // 导致"AI 推荐"实际全部走了本地名字库；关闭后同参数稳定返回 5 个名字的完整 JSON）
    thinking: 'disabled',
  })
}

/**
 * 由出生日期推算季节（提示词用）
 *
 * 2026-09-10 兜底：此前 `new Date('').getMonth()` 得 NaN，比较全 false 会**恒返回"冬"**，
 * 生日留空/输错时 AI 会拿到错误的季节信息（独立取名页的生日是手输文本框，很容易为空）。
 * @returns 季节中文（春/夏/秋/冬）；日期缺失或非法时返回"未知"
 */
function getBirthSeason(dateStr: string): string {
  if (!dateStr) return '未知'
  const d = new Date(dateStr)
  const month = d.getMonth() + 1
  if (Number.isNaN(month)) return '未知'
  if (month >= 3 && month <= 5) return '春'
  if (month >= 6 && month <= 8) return '夏'
  if (month >= 9 && month <= 11) return '秋'
  return '冬'
}

export interface AnalyzeNameDetailParams {
  name: string
  breed: string
  birthDate: string
  gender: string
  wuxing: string
  starMansion: string
  description?: string
}

/**
 * AI 命理深度分析宠物名字
 *
 * 点击名字卡片后调用，返回包含八字、运势、五行、星宿等命理级别的深度分析。
 */
export async function analyzeNameDetail(params: AnalyzeNameDetailParams): Promise<string> {
  requireAuth()

  const { name, breed, birthDate, gender, wuxing, starMansion, description } = params

  const safeName = sanitizeInput(name)
  const safeBreed = sanitizeInput(breed)
  const safeBirthDate = sanitizeInput(birthDate)
  const safeGender = sanitizeInput(gender)
  const safeWuxing = sanitizeInput(wuxing)
  const safeStarMansion = sanitizeInput(starMansion)
  const safeDesc = description ? sanitizeInput(description) : undefined

  const ruleResult = checkInput(safeName + safeBreed + safeGender + (safeDesc || ''))
  if (ruleResult.blocked) {
    return ''
  }

  const { buildDetailPrompt } = await import('../utils/namingPrompts')
  const season = getBirthSeason(safeBirthDate)
  const prompt = buildDetailPrompt({
    name: safeName,
    breed: safeBreed,
    birthDate: safeBirthDate,
    gender: safeGender,
    season,
    wuxing: safeWuxing,
    starMansion: safeStarMansion,
    description: safeDesc,
  })

  return await chat({
    messages: [
      { role: 'system', content: '你是一位精通中国传统命理学的取名大师。请严格按JSON格式返回结果。' },
      { role: 'user', content: prompt },
    ],
    temperature: 0.85,
    max_tokens: 2048,
    // 关闭思考模式（2026-09-10 修复）：命理详情要的是完整 JSON 正文（12 个字段），
    // 开思考时 content 为空 → 前端 parseDetailResult 返回 null → 永远显示本地模板文案
    thinking: 'disabled',
  })
}