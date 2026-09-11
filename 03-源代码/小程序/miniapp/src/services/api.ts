/**
 * API 请求封装层
 *
 * 统一 HTTP 请求入口，支持 Mock 模式切换、自动鉴权注入、统一错误处理
 */
import Taro from '@tarojs/taro'
import { CONFIG } from '../config'
import { storage } from '../utils/storage'
import { localDateString } from '../utils/date'
import { mockApi } from './mock'
import type { ApiResponse, User, Pet, Checkin, Membership, LoginResponse } from '../types'

/**
 * 将服务端返回的可能为相对路径的头像 URL 补全为绝对地址
 * 坑点：上传头像接口返回 `/uploads/user-avatars/...` 这种相对路径，微信小程序 <Image>
 * 对相对路径无法加载（缺少 scheme/host）。这里对以单个 `/` 开头、且非完整 URL 的路径，
 * 用 API_BASE_URL 拼出绝对地址；已是 http(s):// 或 data: 等完整地址则原样返回。
 * @param avatar - 服务端返回的头像值
 * @returns 可直接用于 <Image> 的绝对 URL（空值原样返回）
 */
export function resolveAvatarUrl(avatar: string | undefined | null): string {
  if (!avatar) return ''
  // 已是绝对地址（含协议）或相对协议的 //host 形式，直接可用
  if (/^(https?:)?\/\//i.test(avatar)) return avatar
  // 单个 `/` 开头的站内相对路径（如 /uploads/...），拼上 API_BASE_URL
  if (avatar.startsWith('/')) return `${CONFIG.API_BASE_URL}${avatar}`
  // 其他（dataURI、blob、纯文件名等）原样返回
  return avatar
}

/**
 * 服务端用户字段统一映射：avatarUrl/avatar_url → 前端 User.avatar
 * 服务端统一返回 camelCase（avatarUrl），历史兼容 snake_case（avatar_url）
 */
function normalizeUser(raw: any): User {
  return {
    id: raw.id,
    nickname: raw.nickname || '',
    avatar: resolveAvatarUrl(raw.avatarUrl || raw.avatar_url || raw.avatar || ''),
    phone: raw.phone,
    createdAt: raw.createdAt || raw.created_at || '',
  }
}

/**
 * 服务端打卡记录统一映射（2026-08-23 前后端契约修复）
 * 服务端 pet_health_entries 返回 createdAt + spiritLevel/appetiteLevel/poopLevel 等 level 字段，
 * 前端 Checkin 类型使用 date/mood/appetite/stool —— 在此按 level 语义映射：
 *   - date    = createdAt 落在的**本地日历日**（YYYY-MM-DD）
 *   - mood    = spiritLevel ≤2 → 'sad'（精神差），否则 'happy'
 *   - appetite= appetiteLevel ≤2 → 'poor'，否则 'good'
 *   - stool   = poopLevel ≤2 → 'loose'（软便），≥4 → 'hard'（硬便），否则 'normal'
 * 保留服务端原始字段（riskLevel/hasAnomaly/anomalyItems 等）供扩展使用
 */
/** 服务端打卡记录归一化（导出供单测；见函数注释契约说明） */
export function normalizeCheckin(raw: any): Checkin {
  const createdAt = String(raw.createdAt || '')
  return {
    ...raw,                        // 保留原始字段（riskLevel/hasAnomaly/levels 等）
    id: String(raw.id || ''),
    petId: String(raw.petId || ''),
    userId: String(raw.userId || ''),
    // 服务端无 date 字段，由 created_at 派生；必须取**本地日历日**（2026-09-11 统一口径）：
    // 原实现 `createdAt.slice(0, 10)` 取的是 **UTC 日期**，东八区 00:00–08:00 打的卡会落到前一天，
    // 而 checkinStore 判定「今天有没有打卡」用的是本地日期 → 清晨打完卡仍显示今天还没打卡。
    date: localDateString(raw.createdAt) ?? '',
    ...deriveCheckinView(raw),
    weight: raw.weight != null && raw.weight !== '' ? Number(raw.weight) : undefined,
    createdAt,
  } as Checkin
}

/**
 * 由「等级字段」派生前端视图字段（mood / appetite / stool）
 *
 * 【为什么要抽成唯一实现】打卡有**两条写路径**（checkinService 落库、checkinStore 的乐观写入）
 * 和**一条读路径**（normalizeCheckin）。三处若各写一份映射，同一条记录会出现
 * 「刚提交时显示 A、刷新之后显示 B」——2026-09-11 P0 修复时把该映射收敛到这里，读写共用。
 *
 * 注意这是**有损**映射（5 档压成 3 档）：落库与统计一律用 level 字段，
 * 视图字段只服务于「今日已打卡」结果卡、异常判定与趋势文案。
 *
 * @param levels - 服务端/本地记录的等级字段（容忍缺字段、null 与字符串）
 * @returns 与 Checkin 同名的三个视图字段
 */
export function deriveCheckinView(levels: {
  spiritLevel?: number | string | null
  appetiteLevel?: number | string | null
  poopLevel?: number | string | null
}): Pick<Checkin, 'mood' | 'appetite' | 'stool'> {
  // Number(undefined) = NaN，而 NaN 参与的比较恒为 false → 缺字段时兜底成 happy/good/normal
  // （与历史实现一致：不能因为后端漏字段就把未知渲染成精神差/食欲差）
  const spirit = Number(levels.spiritLevel)
  const appetite = Number(levels.appetiteLevel)
  const poop = Number(levels.poopLevel)
  return {
    mood: spirit <= 2 ? 'sad' : 'happy',
    appetite: appetite <= 2 ? 'poor' : 'good',
    stool: poop <= 2 ? 'loose' : poop >= 4 ? 'hard' : 'normal',
  }
}

/**
 * 通用请求方法
 * @param path - API 路径
 * @param options - 请求配置（方法/数据/查询参数）
 * @returns 泛型响应数据
 */
async function request<T>(path: string, options?: { method?: string; data?: any; params?: Record<string, string> }): Promise<T> {
  if (isMockMode()) {
    const method = options?.method || 'GET'

    if (method === 'GET' && path.includes('/trends')) {
      const urlParams = new URLSearchParams(options?.params || {})
      if (path.includes('/trends/summary')) {
        const petId = path.match(/\/pets\/([^/]+)\/trends/)![1]
        const period = urlParams.get('period') || 'week'
        return mockApi.getTrendSummary(petId, period) as unknown as T
      }
      if (path.includes('/trends/report')) {
        const petId = path.match(/\/pets\/([^/]+)\/trends/)![1]
        const month = urlParams.get('month') || new Date().toISOString().slice(0, 7)
        return mockApi.getMonthlyReport(petId, month) as unknown as T
      }
      const petId = path.match(/\/pets\/([^/]+)\/trends/)![1]
      const startDate = urlParams.get('startDate') || new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10)
      const endDate = urlParams.get('endDate') || new Date().toISOString().slice(0, 10)
      return mockApi.getTrendData(petId, startDate, endDate) as unknown as T
    }

    if (method === 'GET' && path.includes('/checkins') && (path.includes('startDate') || path.includes('endDate') || (options?.params && (options.params.startDate || options.params.endDate)))) {
      const petId = path.match(/\/pets\/([^/]+)\/checkins/)![1]
      const urlParams = new URLSearchParams(options?.params || {})
      const startDate = urlParams.get('startDate') || '2020-01-01'
      const endDate = urlParams.get('endDate') || new Date().toISOString().slice(0, 10)
      return mockApi.getHealthCheckinsByDateRange(petId, startDate, endDate) as unknown as T
    }

    console.warn(`[Mock] API ${method} ${path} - 返回 mock 空数据`)
    if (method === 'GET') return [] as unknown as T
    if (method === 'POST' || method === 'PUT') return (options?.data || {}) as unknown as T
    return undefined as unknown as T
  }
  const token = storage.getToken()
  let url = CONFIG.API_BASE_URL + path
  if (options?.params) {
    const searchParams = new URLSearchParams(options.params)
    url += '?' + searchParams.toString()
  }
  try {
    const res = await Taro.request({
      url,
      method: (options?.method as any) || 'GET',
      data: options?.data,
      timeout: 15000,
      header: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    })
    // 401 统一处理（2026-09 审查 P1 修复）：token 过期/无效时清理本地会话并引导重登，
    // 防止此前「会话不清理 + authStore 仍 isAuthenticated=true → 全接口静默失败」的死局
    if (res.statusCode === 401) {
      await handleUnauthorized()
      throw new Error('登录已过期，请重新登录')
    }
    const body = res.data as ApiResponse<T> & { success?: boolean; code?: unknown; missingMembers?: unknown }
    if (body.success) return body.data as T
    if (body.code === 0) return body.data
    // 业务错误：把后端业务错误码（如 MEMBER_NO_REAL_IMAGE）与附加数据挂到 Error 上，
    // 供调用方（如全家福引导）做差异化处理；message 保持原样。
    // statusCode 一并挂上（如 404=无任务/资源不存在，调用方可与网络失败区分——审查 P0 修复）
    const err = new Error(body.message || '请求失败') as Error & { code?: string; missingMembers?: unknown; statusCode?: number }
    err.statusCode = res.statusCode
    if (body.code && typeof body.code === 'string') err.code = body.code
    if (body.missingMembers) err.missingMembers = body.missingMembers
    throw err
  } catch (err: any) {
    if (err.message === 'request:fail') {
      throw new Error('网络异常，请检查网络连接')
    }
    throw err
  }
}

/**
 * 判断是否启用 Mock 模式
 *
 * 命名说明：原名 `useMock` 以 "use" 开头，会被 eslint 的 react-hooks/rules-of-hooks
 * 误判成 React Hook（它只是普通工具函数，不是 Hook），2026-09-11 与 familyService
 * 口径统一改名为 isMockMode。
 */
function isMockMode(): boolean {
  return CONFIG.USE_MOCK
}

/** 启动期空栈轮询间隔（ms） */
const FIRST_PAGE_POLL_MS = 100

/**
 * 空栈轮询次数上限：100ms × 80 = 8s，与 routeGuard.ts 分包占位窗
 * SUBPACK_PENDING_HOLD_MS（8s，覆盖 pagesPet/pagesUser 分包首载下载）对齐
 * （审查 P2 对齐）：冷启动深链可直达分包页、分包首载可达 8s，等待上限短于
 * 该窗口会让超时兜底 reLaunch 仍可能撞上分包首载路由。用次数上限而非
 * Date.now 时间差：墙钟受系统回拨/前跳影响会延长/提前终止等待（routeGuard
 * 同类场景已有显式防护先例），轮询次数天然单调、零平台依赖。
 */
const FIRST_PAGE_MAX_POLLS = 80

/** 就绪收尾缓冲（ms）：与 routeGuard.ts SETTLE_BUFFER_MS 同语义 */
const FIRST_PAGE_SETTLE_MS = 300

/**
 * 等待首屏页面就绪（页面栈非空 + 路由收尾缓冲）
 *
 * 用途：启动期收到 401 时，首屏路由往往尚未完成（页面栈为空），此时立即
 * reLaunch 会销毁路由中的首屏 webview，微信基础库随后收到该 webview 的
 * routeDone 消息时找不到实例，报「Page route 错误(system error)：routeDone
 * with a webviewId N is not found」（2026-09-09 修复「打开即 401 + 路由错误」）。
 *
 * 边界说明（2026-09-09 审查 P1-1）：「栈非空」是必要非充分条件——首屏 onLoad
 * 前后栈即非空，而竞态窗口持续到首屏 routeDone（约 onReady）才关闭；此处无法
 * 直接探测 onReady，故栈非空后追加 FIRST_PAGE_SETTLE_MS 固定收尾缓冲，覆盖
 * 「栈已非空但路由消息尚未走完」的窗口。等待期间用户看到的是分包/首屏自身的
 * 加载态，无额外等待感知。
 */
async function waitForFirstPage(): Promise<void> {
  for (let poll = 0; poll < FIRST_PAGE_MAX_POLLS; poll++) {
    if (Taro.getCurrentPages().length > 0) {
      // 栈已非空：再等一个收尾缓冲，让首屏 routeDone 消息走完再放行跳转
      await new Promise(resolve => setTimeout(resolve, FIRST_PAGE_SETTLE_MS))
      return
    }
    await new Promise(resolve => setTimeout(resolve, FIRST_PAGE_POLL_MS))
  }
  // 超时放弃等待（栈始终为空 = 路由异常卡死）：由调用方兜底跳转，宁可此时
  // 一次性竞态噪音，不可让用户滞留在已清空的登录态
}

/**
 * 401 统一处理（2026-09 审查 P1 修复）
 * 复用 authStore.logout：断开 WebSocket + 清空本地存储（含认证与业务数据）+ 重置登录态，
 * 然后跳转登录页。用动态 import 避免 api.ts ↔ authStore 的静态循环依赖；
 * handling401 防止并发请求同时收到 401 时重复登出/跳转。
 *
 * 启动期路由竞态防护（2026-09-09 补充）：页面栈为空（首屏路由未完成）时，
 * 先等待首屏就绪再跳转，避免 reLaunch 与启动路由并发触发 webviewId not found；
 * 等待超时仍兜底跳转（宁可一次竞态噪音，不可让用户滞留在已清空的登录态）。
 *
 * ⚠️ 依赖约束（审查双向注释固化）：本兜底跳转依赖 routeGuard「刻意不包装
 * reLaunch」的决策——若未来 routeGuard 扩展包装 reLaunch，本跳转会被其冷却
 * 锁静默吞掉（返回假成功 ok 形态），用户将滞留在已清空的登录态。见
 * routeGuard.ts 顶部「安全性论证」；扩展 reLaunch 前必须先处理本调用点。
 */
let handling401 = false
async function handleUnauthorized(): Promise<void> {
  if (handling401) return
  handling401 = true
  try {
    const { useAuthStore } = await import('../stores/authStore')
    await useAuthStore.getState().logout()
    // 启动期（页面栈为空）：等首屏路由完成（含收尾缓冲）后再跳，规避 webviewId 竞态
    if (Taro.getCurrentPages().length === 0) {
      await waitForFirstPage()
    }
    // 已在登录页则不重复跳转（登录页在 pagesUser 分包；等待期间用户可能已手动到登录页，故复查）
    const pages = Taro.getCurrentPages()
    const current = pages[pages.length - 1]
    if (!current || !current.route?.includes('login')) {
      Taro.reLaunch({ url: '/pagesUser/login/index' }).catch((err) => {
        // 兜底跳转失败留痕 + toast（审查 P2）：等待超时后跳转仍失败属极端路由态，
        // 用户滞留在已清空会话的首屏，至少给出可感知提示
        console.warn('[Api] 401 兜底跳转登录页失败:', err)
        Taro.showToast({ title: '登录已过期，请重新进入', icon: 'none' }).catch(() => {})
      })
    }
  } catch (err) {
    console.warn('[Api] 401 会话清理失败:', err)
  } finally {
    handling401 = false
  }
}

/** API 实例 - 封装 GET/POST/PUT/DELETE 及专用接口 */
export const api = {
  /** GET 请求 */
  get: <T = any>(path: string, params?: Record<string, string>): Promise<T> => {
    return request<T>(path, { method: 'GET', params })
  },
  /** POST 请求 */
  post: <T = any>(path: string, data?: any): Promise<T> => {
    return request<T>(path, { method: 'POST', data })
  },
  /** PUT 请求 */
  put: <T = any>(path: string, data?: any): Promise<T> => {
    return request<T>(path, { method: 'PUT', data })
  },
  /** PATCH 请求 */
  patch: <T = any>(path: string, data?: any): Promise<T> => {
    return request<T>(path, { method: 'PATCH', data })
  },
  /** DELETE 请求 */
  delete: <T = any>(path: string): Promise<T> => {
    return request<T>(path, { method: 'DELETE' })
  },
  /** 微信登录：使用 code 换取登录态 */
  login: async (code: string): Promise<LoginResponse> => {
    if (isMockMode()) return mockApi.login(code)
    const res = await request<LoginResponse>('/api/auth/login', { method: 'POST', data: { provider: 'wechat', code } })
    return { ...res, user: normalizeUser(res.user) }
  },
  /** 获取当前登录用户信息 */
  getUser: async (): Promise<User> => {
    if (isMockMode()) return mockApi.getUser()
    // 服务端真实路由为 /api/auth/profile（旧 /session 不存在，会导致登录态无法恢复）
    return normalizeUser(await request<any>('/api/auth/profile'))
  },
  /** 更新用户资料（昵称 + 头像），跟随微信的资料以用户选择为准 */
  updateProfile: async (nickname: string, avatarUrl: string): Promise<User> => {
    if (isMockMode()) return mockApi.updateProfile(nickname, avatarUrl)
    const raw = await request<any>('/api/auth/profile', {
      method: 'PUT',
      data: { nickname, avatar_url: avatarUrl },
    })
    return normalizeUser(raw)
  },
  /** 上传用户头像（微信 chooseAvatar 返回的临时文件 → 服务器） */
  uploadAvatar: (filePath: string): Promise<{ url: string }> => {
    const token = storage.getToken()
    return new Promise((resolve, reject) => {
      Taro.uploadFile({
        url: `${CONFIG.API_BASE_URL}/api/auth/avatar`,
        filePath,
        name: 'avatar',
        header: token ? { Authorization: `Bearer ${token}` } : {},
        success: (res) => {
          try {
            const body = JSON.parse(res.data)
            if (body.success && body.data?.url) {
              // 补全相对路径头像为绝对地址，避免 <Image> 无法加载
              resolve({ url: resolveAvatarUrl(body.data.url) })
            } else {
              reject(new Error(body.message || '头像上传失败'))
            }
          } catch {
            reject(new Error('头像上传失败'))
          }
        },
        fail: () => reject(new Error('头像上传失败，请重试')),
      })
    })
  },
  /** 获取用户的所有宠物列表 */
  getPets: async (userId: string): Promise<Pet[]> => {
    if (isMockMode()) return mockApi.getPets(userId)
    return request<Pet[]>('/pets', { params: { userId } })
  },
  /** 获取单个宠物详情 */
  getPet: async (petId: string): Promise<Pet | null> => {
    if (isMockMode()) return mockApi.getPet(petId)
    return request<Pet>(`/pets/${petId}`)
  },
  /** 创建新宠物 */
  createPet: async (data: Partial<Pet>): Promise<Pet> => {
    if (isMockMode()) return mockApi.createPet(data)
    return request<Pet>('/pets', { method: 'POST', data })
  },
  /** 更新宠物信息 */
  updatePet: async (petId: string, data: Partial<Pet>): Promise<Pet> => {
    if (isMockMode()) return mockApi.updatePet(petId, data)
    return request<Pet>(`/pets/${petId}`, { method: 'PUT', data })
  },
  /** 删除宠物 */
  deletePet: async (petId: string): Promise<void> => {
    if (isMockMode()) return mockApi.deletePet(petId)
    return request<void>(`/pets/${petId}`, { method: 'DELETE' })
  },
  /** 获取宠物的打卡列表（归一化为前端 Checkin 结构） */
  getCheckins: async (petId: string): Promise<Checkin[]> => {
    if (isMockMode()) return mockApi.getCheckins(petId)
    const rows = await request<Checkin[]>(`/api/pets/${petId}/checkins`)
    return rows.map(normalizeCheckin)
  },
  /** 创建打卡记录（返回归一化结构） */
  createCheckin: async (data: Partial<Checkin>): Promise<Checkin> => {
    if (isMockMode()) return mockApi.createCheckin(data)
    const row = await request<Checkin>(`/api/pets/${data.petId}/checkins`, { method: 'POST', data })
    return normalizeCheckin(row)
  },
  /** 获取用户的会员信息 */
  getMembership: async (userId: string): Promise<Membership | null> => {
    if (isMockMode()) return mockApi.getMembership(userId)
    return request<Membership | null>(`/membership/status`, { params: { userId } })
  },
}
