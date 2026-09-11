/**
 * 健康打卡页「单只提交」接口契约回归测试（2026-09-11 P0 修复）
 *
 * 【为什么必须单独立这个文件，且刻意不 mock 被测链路】
 * 用户报「健康打卡显示打卡失败，请重试」。根因是三条打卡入口里**只有单只提交**这一条
 * 把前端视图字段（mood / appetite / stool）原样当 POST body 发了出去；而服务端
 * createCheckinSchema 必填的是 poop_level / appetite_level / spirit_level / exercise_level /
 * risk_level（见 03-源代码/server/src/schemas/index.ts）→ validate 中间件返回 400 / code 100001
 * → 页面 catch 兜底弹「打卡失败，请重试」（该文案前端写死，后端从不产这句）。
 *
 * 原有测试都碰不到它，因为它们把出事的那一层 mock 掉了：
 *   · pagesPet/checkin/__tests__/index.test.tsx 把 useCheckin 整体 mock，只测纯函数；
 *   · stores/__tests__/checkinStore.test.ts 把 services/api mock，只断言 store 状态。
 * 所以本文件**不 mock** useCheckin / checkinStore / checkinService / api 这条真实链路，
 * 只替掉 Taro 宿主能力与宠物、登录态来源，直接断言「真正发出去的 HTTP 请求体」。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, fireEvent, waitFor } from '@testing-library/react'

// 被测页面 + 它真实的协作层（这几层一律不 mock）
import PetCheckin, { APPETITE_OPTIONS } from '../index'
import { useCheckinStore } from '../../../stores/checkinStore'
import { normalizeCheckin } from '../../../services/api'
import type { CheckinInput } from '../../../services/checkinService'

// ============================================================
// vi.hoisted：mock 工厂里要引用的可变状态与 spy
// ============================================================
const { mockRequest, mockShowToast, mockShowModal, taroStorage, petState } = vi.hoisted(() => ({
  /** 抓包用：api 层最终就是调 Taro.request，断言它的 body 最贴近「线上真正发出去的东西」 */
  mockRequest: vi.fn(),
  mockShowToast: vi.fn(),
  mockShowModal: vi.fn(),
  /** 内存版 Storage：requirePetOwnership 要读 `pets_<userId>` 校验归属，必须给得出 */
  taroStorage: new Map<string, string>(),
  /** 宠物来源（页面依赖 usePet，属于外部数据源，允许替身） */
  petState: { pets: [] as unknown[], currentPet: null as unknown },
}))

// ============================================================
// Taro 宿主替身（只替「宿主能力」，不替业务链路）
// ============================================================
// 组件替身：全局 setup.ts 的 @tarojs/components 替身少了 Textarea（本页用它做备注输入），
// 这里补一份本文件专用的版本，避免整页渲染在备注区崩掉
vi.mock('@tarojs/components', async () => {
  const { createElement } = await import('react')
  const mapTag = (tag: string) =>
    ({ children, className, style, onClick, value, placeholder, ...rest }: any) =>
      createElement(tag, { className, style, onClick, value, placeholder, ...rest }, children)
  return {
    View: mapTag('div'),
    Text: mapTag('span'),
    Input: mapTag('input'),
    Textarea: mapTag('textarea'),
    ScrollView: mapTag('div'),
    Image: mapTag('img'),
    Button: mapTag('button'),
  }
})

vi.mock('@tarojs/taro', () => ({
  default: {
    request: mockRequest,
    showToast: mockShowToast,
    showModal: mockShowModal,
    navigateTo: vi.fn(),
    showShareMenu: vi.fn(),
    getEnv: () => 'WEAPP',
    getStorageSync: (key: string) => taroStorage.get(key) ?? '',
    setStorageSync: (key: string, value: string) => { taroStorage.set(key, value) },
    removeStorageSync: (key: string) => { taroStorage.delete(key) },
    getStorageInfoSync: () => ({ keys: [...taroStorage.keys()] }),
    eventCenter: { on: vi.fn(), off: vi.fn(), trigger: vi.fn() },
  },
  useShareAppMessage: vi.fn(),
  useShareTimeline: vi.fn(),
  useDidShow: vi.fn(),
}))

// ============================================================
// 页面外围依赖：主题 / 宠物来源 / 登录态 / 纯展示组件（与打卡契约无关）
// ============================================================
vi.mock('../../../hooks/useThemeClass', () => ({
  useThemeClass: () => '',
  useThemeKey: () => 'autumn',
  usePetWallpaper: () => null,
}))
vi.mock('../../../components/PageBackground', () => ({ default: () => null }))
vi.mock('../../../stores/authStore', () => ({
  useAuthStore: (selector: (s: { user: { id: string } }) => unknown) => selector({ user: { id: 'user_1' } }),
}))
vi.mock('../../../stores/shareStore', () => ({
  useShareStore: (selector: (s: { inviteCode: string }) => unknown) => selector({ inviteCode: '' }),
}))
vi.mock('../../../hooks/usePet', () => ({
  usePet: () => ({
    pets: petState.pets,
    currentPet: petState.currentPet,
    switchPet: vi.fn(),
    isLoading: false,
  }),
}))
vi.mock('../../../components/PetSwitcher', () => ({ default: () => null }))
vi.mock('../../../components', () => ({
  Icon: () => null,
  emojiToIcon: () => null,
  PageLoading: () => null,
  PageError: () => null,
  PetAvatar: () => null,
  AchievementCard: () => null,
  AchievementShareCard: () => null,
  EmergencyAlert: () => null,
  CarePlanCard: () => null,
}))
vi.mock('../../../components/CrisisReferralCard', () => ({ default: () => null }))
vi.mock('../../../stores/subscribeStore', () => ({
  // isAccepted 恒为真：跳过「开启每日提醒」弹窗，避免测试被无关交互打断
  useSubscribeStore: (selector: (s: { isAccepted: () => boolean; requestAll: () => void }) => unknown) =>
    selector({ isAccepted: () => true, requestAll: vi.fn() }),
}))
vi.mock('../../../services/achievementService', () => ({ checkAllAchievements: () => [] }))
vi.mock('../../../hooks/useEmotionTracking', () => ({
  useEmotionTracking: () => ({
    showCrisisReferral: false,
    crisisSeverity: 'mild',
    trackEvent: vi.fn(),
    dismissCrisisReferral: vi.fn(),
    handleFollowUp: vi.fn(),
  }),
}))
vi.mock('../../../engines/petAvatar/diaryEngine', () => ({ generateDiaryForToday: () => null }))
vi.mock('../../../engines/emotion', () => ({ getCrisisMessage: () => '' }))
vi.mock('../../../engines/petSafety/MedicalDisclaimer', () => ({
  MedicalDisclaimer: class { getCheckinDisclaimer() { return '' } },
}))
vi.mock('../../../services/churnDetectionService', () => ({ updateLastCheckinDate: vi.fn() }))
vi.mock('../../../hooks/useAnalytics', () => ({
  useAnalytics: () => ({ trackPageView: vi.fn(), trackEvent: vi.fn(), trackFunnelStep: vi.fn() }),
  usePageView: vi.fn(),
}))
vi.mock('../../../constants/analyticsEvents', () => ({ EVENT: {} }))

// ============================================================
// 常量与工具
// ============================================================
const USER_ID = 'user_1'
const PET_ID = 'pet_1'
/**
 * 服务端回包用的建档时间：**必须落在「本地日历日的今天」**，且与后端 created_at 同形（UTC ISO）。
 *
 * 【为什么不能写死一个常量（2026-09-12 修）】
 *   原实现写死 `'2026-09-11T02:00:00.000Z'`，注释理由是"保证断言可复现"——实际效果正相反。
 *   `checkinStore.fetchCheckins` 是按**本地日历日**找"今天那条"：
 *   `const todayStr = localDateString(parseLocalDate(new Date()))`，再 `checkins.find(c => c.date === todayStr)`。
 *   而写死的 `02:00Z` = 东八区 10:00，**本地日被钉死在 2026-09-11**：
 *   只要真实日期不是 09-11，这条记录就永远 find 不到 → `todayCheckin` 被覆写成 null →
 *   本用例第 ⑤ 步（"store 立即反映为今日已打卡"）必红。
 *   即这是一个**"过了当天就自爆"的测试**：2026-09-12 01:40 实测单跑 3/3 全红，
 *   而前一日运行时是绿的——不是回归，是时间炸弹。
 *
 * 【现在的做法】取**当天本地正午**再转成 ISO：
 *   · 正午离本地日两端各有 12 小时余量，任何时区偏移都不会让它跨日 → "本地日 = 今天"恒成立；
 *   · 同一运行日内取值确定（不像 Date.now() 每次都变），断言依旧可复现。
 *
 * ⚠️ 别把本文件里那个把回包钉在 `'2026-09-10T17:30:00.000Z'`（东八区 09-11 01:30）的用例一起改：
 *    它是**故意**钉住东八区清晨边界来验归一化的，属于被测行为本身。
 */
const CREATED_AT = (() => {
  const noon = new Date()
  noon.setHours(12, 0, 0, 0)
  return noon.toISOString()
})()
const API_BASE = 'https://api.xinghuanhai.com'
/** 服务端 createCheckinSchema 允许的 risk_level 值域（含 legacy 值） */
const VALID_RISK_LEVELS = ['low', 'medium', 'high', 'emergency', 'normal', 'caution', 'warning']

/**
 * 假服务端的「库表」：POST 落库、GET 列表读回
 *
 * 页面在提交成功后会立即 `fetchCheckins` 刷新（用服务端数据覆盖乐观值），
 * 所以 GET 必须回放已落库的行，否则测出来的是提交成功但列表为空的假象。
 */
const serverRows: any[] = []
/** 本条 POST 落库用的 created_at（用例可改，用于构造东八区清晨边界） */
let postCreatedAt = CREATED_AT

/** 构造一只宠物（含本地归属校验所需的 id） */
function makePet() {
  return {
    id: PET_ID, name: '旺财', species: 'dog', breed: '金毛',
    birthDate: '2023-03-15', createdAt: '', updatedAt: '',
  }
}

/**
 * 把提交体折算成服务端回包行
 *
 * 与 routes/checkins.ts 里 `res.json({ data: toCamelCase(row) })` 同形：
 * 后端把 snake_case 落库后按 camelCase 返回，前端再由 api.normalizeCheckin 归一成 Checkin。
 * 回包里 echo 请求体（而不是写死一份 fixture），才能让「写路径发什么、读路径读回什么」互相印证。
 */
function serverRowFromBody(body: any) {
  return {
    id: 'ck_1',
    petId: PET_ID,
    userId: USER_ID,
    poopLevel: body?.poop_level,
    appetiteLevel: body?.appetite_level,
    spiritLevel: body?.spirit_level,
    exerciseLevel: body?.exercise_level,
    weight: body?.weight ?? null,
    hasAnomaly: !!body?.has_anomaly,
    anomalyItems: body?.anomaly_items ?? [],
    aiFeedback: body?.ai_feedback ?? '',
    riskLevel: body?.risk_level,
    note: body?.note ?? null,
    createdAt: CREATED_AT,
  }
}

/** 取出所有 POST 抓包记录 */
function postCalls() {
  return mockRequest.mock.calls.filter((call: any[]) => call[0]?.method === 'POST')
}

/** 等待打卡表单渲染出来，并返回提交按钮 */
async function waitForSubmit(container: HTMLElement) {
  return await waitFor(() => {
    const el = container.querySelector<HTMLElement>('.pet-checkin__submit')
    if (!el) throw new Error('打卡表单未渲染完成（未找到 .pet-checkin__submit）')
    return el
  })
}

/** 点击某一指标区块里的选项（同一文案如「正常」在多个区块都有，必须限定区块） */
function clickOptionInSection(container: HTMLElement, sectionIndex: number, label: string) {
  const section = container.querySelectorAll('.pet-checkin__section')[sectionIndex]
  expect(section, `未找到第 ${sectionIndex} 个指标区块`).toBeTruthy()
  const option = Array.from(section!.querySelectorAll('.pet-checkin__option'))
    .find(o => o.textContent === label)
  expect(option, `第 ${sectionIndex} 个区块里没找到选项「${label}」`).toBeTruthy()
  fireEvent.click(option!)
}

/** 按文案点击某类元素（如体重快捷预设） */
function clickByText(container: HTMLElement, selector: string, text: string) {
  const el = Array.from(container.querySelectorAll(selector)).find(x => x.textContent === text)
  expect(el, `未找到 ${selector} 里文案为「${text}」的元素`).toBeTruthy()
  fireEvent.click(el!)
}

// ============================================================
// 用例
// ============================================================
describe('健康打卡页单只提交 · 接口契约', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    taroStorage.clear()
    serverRows.length = 0
    postCreatedAt = CREATED_AT
    // 本地归属校验（requirePetOwnership）读的是 `pets_<userId>`
    const pet = makePet()
    taroStorage.set(`pets_${USER_ID}`, JSON.stringify([pet]))
    petState.pets = [pet]
    petState.currentPet = pet
    useCheckinStore.setState({
      checkins: [], checkinsPetId: null, todayCheckin: null, streakDays: 0, isLoading: false,
    })

    // 默认应答：GET 打卡列表空、今日未打卡；POST 成功并 echo 请求体
    mockRequest.mockImplementation((opts: any) => {
      const url: string = opts?.url ?? ''
      if (opts?.method === 'POST') {
        const row = { ...serverRowFromBody(opts.data), createdAt: postCreatedAt }
        serverRows.unshift(row)
        return Promise.resolve({
          statusCode: 201,
          data: { success: true, data: row },
        })
      }
      if (url.includes('/checkins/today')) {
        return Promise.resolve({ statusCode: 200, data: { success: true, data: null } })
      }
      if (url.includes('/checkins')) {
        return Promise.resolve({ statusCode: 200, data: { success: true, data: serverRows } })
      }
      return Promise.resolve({ statusCode: 200, data: { success: true, data: null } })
    })
  })

  it('正常提交：body 是后端契约的 snake_case（5 个必填齐全），且不再出现 mood/appetite/stool', async () => {
    const { container } = render(<PetCheckin />)
    const submit = await waitForSubmit(container)
    // 体重走真实表单路径（点 12.0kg 快捷预设），用于验证「表单值真的上了线」
    clickByText(container, '.pet-checkin__weight-preset', '12.0 kg')

    fireEvent.click(submit)
    await waitFor(() => expect(postCalls()).toHaveLength(1))

    const [req] = postCalls()[0]
    const body = req.data

    // ① 打到对的后端路由
    expect(req.url).toBe(`${API_BASE}/api/pets/${PET_ID}/checkins`)
    // ② 5 个必填字段齐全（缺任何一个都会被 validate 中间件判 400/100001）
    expect(body).toMatchObject({
      poop_level: 3, appetite_level: 3, spirit_level: 3, exercise_level: 2,
    })
    expect(VALID_RISK_LEVELS).toContain(body.risk_level)
    // ③ 非法字段名一律不得出现：这几个正是页面视图字段，后端 schema 里根本没有
    for (const illegal of ['mood', 'appetite', 'stool', 'date', 'petId', 'userId']) {
      expect(body, `提交体不应再包含视图字段 ${illegal}`).not.toHaveProperty(illegal)
    }
    // ④ 表单真实值原样上送（体重）
    expect(body.weight).toBe(12)

    // ⑤ 成功后页面给「打卡成功」，且 store 立即反映为「今日已打卡」
    await waitFor(() => {
      expect(mockShowToast).toHaveBeenCalledWith(expect.objectContaining({ title: '打卡成功' }))
    })
    const today = useCheckinStore.getState().todayCheckin
    expect(today).not.toBeNull()
    // ⑥ 页面提交后会拉取服务端列表覆盖状态：最终状态必须与「回包经 normalizeCheckin 归一化」完全一致
    //    （否则同一条记录会出现刚提交一种状态、刷新后另一种状态）
    await waitFor(() => {
      expect(useCheckinStore.getState().todayCheckin).toEqual(normalizeCheckin(serverRows[0]))
    })
  })

  it('异常项：表单里选出的异常指标必须原样上送，且 anomaly_items / risk_level 合法', async () => {
    const { container } = render(<PetCheckin />)
    const submit = await waitForSubmit(container)
    // 便便区块（第 0 个）选「带血」= poopLevel 1；食欲区块（第 1 个）选「不吃」= appetiteLevel 1
    clickOptionInSection(container, 0, '带血')
    clickOptionInSection(container, 1, '不吃')

    fireEvent.click(submit)
    await waitFor(() => expect(postCalls()).toHaveLength(1))

    const body = postCalls()[0][0].data
    // 表单真实值（而不是从 mood/appetite/stool 反推出来的臆造映射）
    expect(body).toMatchObject({
      poop_level: 1, appetite_level: 1, spirit_level: 3, exercise_level: 2,
    })
    expect(body.has_anomaly).toBe(true)
    expect(body.anomaly_items).toEqual(expect.arrayContaining(['poop', 'appetite']))
    expect(VALID_RISK_LEVELS).toContain(body.risk_level)
  })

  it('边界：云端不可达时不把错误抛给用户，仍落一条本地兜底记录（离线打卡语义）', async () => {
    // 覆盖「云端写失败」分支：checkinService 的设计是先写云端、失败写本地 + 入同步队列
    mockRequest.mockRejectedValue(new Error('request:fail'))
    const { container } = render(<PetCheckin />)
    const submit = await waitForSubmit(container)

    fireEvent.click(submit)
    await waitFor(() => expect(useCheckinStore.getState().todayCheckin).not.toBeNull())

    // 本地缓存（checkins_<petId>_<userId>）里确实落了记录，供后续同步补写
    const localRaw = taroStorage.get(`checkins_${PET_ID}_${USER_ID}`)
    expect(localRaw).toBeTruthy()
    expect(JSON.parse(localRaw as string)).toHaveLength(1)
    // 页面仍按「打卡完成」收尾，不弹「打卡失败，请重试」
    expect(mockShowToast).toHaveBeenCalledWith(expect.objectContaining({ title: '打卡成功' }))
  })

  it('store 层：doCheckin 返回的 Checkin 与读路径同形，且日期取本地日历日（东八区清晨边界）', async () => {
    // 服务端落库时间落在东八区 00:00–08:00：此刻 UTC 日期还是前一天，
    // 若按 UTC 取日期，就会在清晨打完卡后仍显示「今天还没打卡」（本次顺带修的同类缺陷）
    postCreatedAt = '2026-09-10T17:30:00.000Z' // = 东八区 2026-09-11 01:30
    const input: CheckinInput = {
      petId: PET_ID,
      userId: USER_ID,
      poopLevel: 4, // ≥4 → 'hard'：5 档里有损映射最容易写错的一档
      // 食欲取 5（呕吐）——服务端 createCheckinSchema 的上限就是 5。
      // 这里**不能**用 6：6 在服务端是非法值（zod max(5) → 400/100001），拿它当"合法输入"
      // 断言通过，等于把一个不成立的契约固化进测试（2026-09-11 审查 P2-1）
      appetiteLevel: 5,
      spiritLevel: 2,
      exerciseLevel: 2,
      hasAnomaly: true,
      anomalyItems: ['poop', 'appetite', 'spirit'],
      note: '呕吐 1 次，精神差',
    }

    const checkin = await useCheckinStore.getState().doCheckin(input)
    const viaReadPath = normalizeCheckin(serverRows[0])

    // ① 键集合必须**完全相同**：写路径与读路径产出的 Checkin 是同一个形状。
    //    历史 P1-1 那种白名单构造（只回 10 个契约字段）会在这里立刻变红 ——
    //    它丢掉的是 poopLevel/appetiteLevel/spiritLevel/exerciseLevel/
    //    hasAnomaly/anomalyItems/aiFeedback/riskLevel，而 diaryEngine 真的在读 hasAnomaly
    expect(Object.keys(checkin).sort()).toEqual(Object.keys(viaReadPath).sort())
    // ② 逐字段相等（比 toEqual 严格：值为 undefined 的键位与原型都参与比较）
    expect(checkin).toStrictEqual(viaReadPath)
    // ③ 真正被下游消费的异常字段必须在（diaryEngine 读 entry.hasAnomaly / entry.anomalyItems）。
    //    Checkin 类型没声明这两个字段（历史遗留：读路径靠 `...raw` 带出来，日记页用 `as any` 消费），
    //    这里与实际消费方同口径取值，避免测试比类型更"干净"而放过回归
    expect((checkin as any).hasAnomaly).toBe(true)
    expect((checkin as any).anomalyItems).toEqual(input.anomalyItems)
    // ④ 等级字段也要在：趋势 / 统计 / 记忆引擎都按 level 消费，
    //    只剩三档视图字段的话，趋势里的档位信息就永久丢了
    expect((checkin as any).poopLevel).toBe(4)
    expect(typeof (checkin as any).riskLevel).toBe('string')
    // ⑤ 日期取**本地日历日**，且视图档位与既有口径一致
    expect(checkin.date).toBe('2026-09-11')
    expect(checkin.stool).toBe('hard')
    expect(checkin.mood).toBe('sad')
    // 注意：视图三档是有损映射——食欲 5（呕吐）按既有口径落在 'good'，与食欲好无法区分
    // （历史行为，本次只统一读写口径、不改档位语义，已登记待办）
    expect(checkin.appetite).toBe('good')
    // ⑥ store 内的乐观值同样同形（页面在刷新前先渲染的就是它）
    expect(useCheckinStore.getState().todayCheckin).toStrictEqual(checkin)
    expect(useCheckinStore.getState().checkinsPetId).toBe(PET_ID)
  })

  it('离线兜底路径：本地落库记录写进 store 后，字段集与"服务端读回"同样一致', async () => {
    // 云端不可达时 createCheckin 返回的是**本地构造的 PetHealthEntry**（不是服务端回包）：
    // 两条写路径里就数这一条最容易与读路径分叉，因为它连 createdAt 都是 Date 对象
    mockRequest.mockRejectedValue(new Error('request:fail'))
    const input: CheckinInput = {
      petId: PET_ID,
      userId: USER_ID,
      poopLevel: 1,
      appetiteLevel: 5,
      spiritLevel: 3,
      exerciseLevel: 2,
      weight: 12,
      hasAnomaly: true,
      anomalyItems: ['poop'],
    }

    const checkin = await useCheckinStore.getState().doCheckin(input)
    // 参照物：同一条记录若由服务端回包并经读路径归一化，会是这个字段集
    const referenceRow = serverRowFromBody({
      poop_level: input.poopLevel,
      appetite_level: input.appetiteLevel,
      spirit_level: input.spiritLevel,
      exercise_level: input.exerciseLevel,
      weight: input.weight,
      has_anomaly: input.hasAnomaly,
      anomaly_items: input.anomalyItems,
      ai_feedback: '（服务端生成）',
      risk_level: 'emergency',
      note: undefined,
    })
    const viaReadPath = normalizeCheckin(referenceRow)

    expect(Object.keys(checkin).sort()).toEqual(Object.keys(viaReadPath).sort())
    expect((checkin as any).hasAnomaly).toBe(true)
    expect((checkin as any).anomalyItems).toEqual(['poop'])
    // createdAt 统一成 ISO 串：本地兜底记录原本是 Date，若直接 String(Date) 会得到
    // 本地化长串（"Fri Sep 11 2026 …"），让离线记录与刷新后的记录不同形
    expect(checkin.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
    expect(checkin.weight).toBe(12)
  })

  it('契约边界：食欲档位产出方上限 = 服务端 createCheckinSchema 的 max(5)，6 不是合法输入', async () => {
    // 服务端 createCheckinSchema：appetite_level = z.number().int().min(1).max(5)
    // （03-源代码/server/src/schemas/index.ts）。而 CheckinInput.appetiteLevel 的类型仍写着
    // `1|2|3|4|5|6`（services/checkinService.ts，本轮改动范围外，已登记待办）——
    // 那个 6 是历史遗留的"呕吐=6"档位，服务端从不接受：发出去会被 validate 中间件判
    // 400/100001，而 createCheckin 的云端失败分支会**静默落本地兜底**，结果是
    // "本地有一条、服务端永远没有 + 同步队列反复重试"。
    // 所以这里钉死**产出方**：页面食欲选项的最大值只能是 5，上线时 appetite_level 也只能是 5。
    expect(Math.max(...APPETITE_OPTIONS.map(o => o.value))).toBe(5)

    const { container } = render(<PetCheckin />)
    const submit = await waitForSubmit(container)
    clickOptionInSection(container, 1, '呕吐') // 食欲区块（第 1 个）的最大档位
    fireEvent.click(submit)
    await waitFor(() => expect(postCalls()).toHaveLength(1))

    const body = postCalls()[0][0].data
    expect(body.appetite_level).toBe(5)
    expect(body.appetite_level).toBeLessThanOrEqual(5)
  })
})
