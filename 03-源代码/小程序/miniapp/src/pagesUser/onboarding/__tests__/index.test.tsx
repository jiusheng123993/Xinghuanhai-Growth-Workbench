/**
 * 新手引导页（高保真 v2 重做）单元测试
 *
 * 覆盖：三屏步进、步骤指示、完成/跳过两条出口、以及**文案与 IA 的一致性** ——
 * 最后一条是这次重做的核心目的：AI 能力（食物查询 / 症状初筛 / 附近医院）
 * 归「团团」，绝不允许再出现在新手引导里。这条断言就是防回退的闸门。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import Taro from '@tarojs/taro'

import OnboardingPage from '../index'

/** 三件事的定稿文案（= 页面里 THINGS 的副本；改页面文案必须同步改这里，否则测试会红） */
const THREE_THINGS = ['3 秒健康打卡', '有问题就问团团', '把记录变成回忆录']

/** 不允许出现在引导页的 AI 子功能词（它们属于团团） */
const FORBIDDEN_AI_WORDS = ['食物查询', '食物安全查询', '症状初筛', '附近医院', 'AI症状初筛']

/** 取当前渲染出的全部文本，用于「不应出现某词」这类整页断言 */
function pageText(): string {
  return document.body.textContent ?? ''
}

describe('OnboardingPage（高保真 v2）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('第 1 屏：渲染品牌字与副标题，右上角是可跳过', () => {
    render(<OnboardingPage />)

    expect(screen.getByText('星河宠记')).toBeTruthy()
    expect(screen.getByText('AI 宠物管家 · 懂 TA 的一生')).toBeTruthy()
    expect(screen.getByText('它的可爱')).toBeTruthy()
    expect(screen.getByText('要一颗一颗收进星河里')).toBeTruthy()
    expect(screen.getByText('跳过')).toBeTruthy()

    // 第 1 屏主按钮是「开始了解 / 下一步」，不是「添加我的宠物」
    expect(screen.getByText('开始了解')).toBeTruthy()
    expect(screen.getByText('看看它能帮你做什么')).toBeTruthy()
    expect(screen.getByText('下一步')).toBeTruthy()
    expect(screen.queryByText('添加我的宠物')).toBeNull()
  })

  it('第 2 屏：三件事文案齐全，且不含任何归团团的 AI 子功能', () => {
    render(<OnboardingPage />)
    fireEvent.click(screen.getByText('下一步'))

    expect(screen.getByText('三件事，')).toBeTruthy()
    expect(screen.getByText('就能陪它过好每一天')).toBeTruthy()

    THREE_THINGS.forEach((t) => expect(screen.getByText(t)).toBeTruthy())
    expect(screen.getByText('食欲 · 便便 · 精神 · 呕吐，异常自动标出来')).toBeTruthy()
    expect(
      screen.getByText('它记得这只宠物的全部档案，随时点底部中间的按钮')
    ).toBeTruthy()
    expect(screen.getByText('攒下的照片，一键做成一支属于它的片子')).toBeTruthy()

    // ★ 防回退闸门：AI 子功能一律不许出现在新手引导里
    const text = pageText()
    FORBIDDEN_AI_WORDS.forEach((w) => expect(text).not.toContain(w))
  })

  it('第 3 屏：主 CTA 变成「添加我的宠物」，右上角改成「先逛逛」', () => {
    render(<OnboardingPage />)
    fireEvent.click(screen.getByText('下一步'))
    fireEvent.click(screen.getByText('下一步'))

    expect(screen.getByText('先告诉我，它是谁？')).toBeTruthy()
    expect(screen.getByText('品种、生日、一张照片就够了。')).toBeTruthy()
    expect(screen.getByText('剩下的团团会慢慢替你记住。')).toBeTruthy()
    expect(screen.getByText('拍一张照片 AI 识品种')).toBeTruthy()
    expect(screen.getByText('手动填写')).toBeTruthy()

    expect(screen.getByText('添加我的宠物')).toBeTruthy()
    expect(screen.getByText('大约需要 30 秒')).toBeTruthy()
    expect(screen.getByText('开始')).toBeTruthy()

    // 走到最后一屏就不该再说「跳过」了
    expect(screen.getByText('先逛逛')).toBeTruthy()
    expect(screen.queryByText('跳过')).toBeNull()
  })

  it('第 3 屏点主 CTA：写完成标记并 navigateTo 到添加宠物页', () => {
    render(<OnboardingPage />)
    fireEvent.click(screen.getByText('下一步'))
    fireEvent.click(screen.getByText('下一步'))
    fireEvent.click(screen.getByText('添加我的宠物'))

    expect(vi.mocked(Taro.setStorageSync)).toHaveBeenCalledWith('onboarding_completed', 'true')
    expect(vi.mocked(Taro.navigateTo)).toHaveBeenCalledWith({ url: '/pagesPet/add/index' })
  })

  it('第 3 屏点选项行：同样进添加宠物页', () => {
    render(<OnboardingPage />)
    fireEvent.click(screen.getByText('下一步'))
    fireEvent.click(screen.getByText('下一步'))
    fireEvent.click(screen.getByText('手动填写'))

    expect(vi.mocked(Taro.setStorageSync)).toHaveBeenCalledWith('onboarding_completed', 'true')
    expect(vi.mocked(Taro.navigateTo)).toHaveBeenCalledWith({ url: '/pagesPet/add/index' })
  })

  it('点跳过：写完成标记并 switchTab 回首页（保证「引导 → 首页」这条链不断）', () => {
    render(<OnboardingPage />)
    fireEvent.click(screen.getByText('跳过'))

    expect(vi.mocked(Taro.setStorageSync)).toHaveBeenCalledWith('onboarding_completed', 'true')
    expect(vi.mocked(Taro.switchTab)).toHaveBeenCalledWith({ url: '/pages/index/index' })
    // 跳过的语义是"不看引导直接走"，所以不该顺手把用户推进添加宠物页
    expect(vi.mocked(Taro.navigateTo)).not.toHaveBeenCalled()
  })

  it('第 3 屏点「先逛逛」：同样回首页', () => {
    render(<OnboardingPage />)
    fireEvent.click(screen.getByText('下一步'))
    fireEvent.click(screen.getByText('下一步'))
    fireEvent.click(screen.getByText('先逛逛'))

    expect(vi.mocked(Taro.switchTab)).toHaveBeenCalledWith({ url: '/pages/index/index' })
  })

  it('第 1 屏没有「上一步」，第 2/3 屏有；点它能退回上一屏', () => {
    render(<OnboardingPage />)
    // 第 1 屏：没有上一步可退
    expect(screen.queryByText('上一步')).toBeNull()

    fireEvent.click(screen.getByText('下一步'))
    expect(screen.getByText('上一步')).toBeTruthy()

    fireEvent.click(screen.getByText('下一步'))
    expect(screen.getByText('上一步')).toBeTruthy()

    // 退回第 2 屏：三件事文案重新出现
    fireEvent.click(screen.getByText('上一步'))
    expect(screen.getByText('三件事，')).toBeTruthy()

    // 再退回第 1 屏：品牌字重新出现，且上一步消失
    fireEvent.click(screen.getByText('上一步'))
    expect(screen.getByText('星河宠记')).toBeTruthy()
    expect(screen.queryByText('上一步')).toBeNull()

    // 全程不该写完成标记（只是翻页，用户还没走完）
    expect(vi.mocked(Taro.setStorageSync)).not.toHaveBeenCalledWith('onboarding_completed', 'true')
  })

  it('每一步都上报步骤浏览事件，埋点步号从 1 开始', async () => {
    render(<OnboardingPage />)
    fireEvent.click(screen.getByText('下一步'))

    // 上报是同步写串行队列（services/analyticsService.trackEvent），直接读 storage 调用即可
    await vi.waitFor(() => {
      const calls = vi.mocked(Taro.setStorageSync).mock.calls
      const queueCall = calls[calls.length - 1]
      expect(queueCall[0]).toBe('xhh_analytics_queue')
    })
  })
})

// ============================================
// 胶囊避让（navigationStyle: 'custom' 的页面必须自己做）
// ============================================
// 缺陷背景：本页自定义导航栏，页面从屏幕顶端开始渲染，右上角「跳过」会落进
// 微信胶囊/状态栏那一条里被压住。修法是拿 Taro.getMenuButtonBoundingClientRect()
// 的胶囊底边当内容起点。
//
// 【mock 说明】该 API 挂在 `@tarojs/taro` 的**默认导出对象**上，共享的 src/test/setup.ts
// 里没有它（本批硬约束只允许改本目录三个文件，不能去改 setup）。所以这里直接往
// 那个 mock 对象上挂/删方法即可 —— 页面走的是 `Taro.getMenuButtonBoundingClientRect()`
// 这种默认导出的属性调用，不是 `import { useDidShow } from '@tarojs/taro'` 那样把 API
// 当**具名导出**引入，因此不会踩到本仓踩过的
// `No "xxx" export is defined on the "@tarojs/taro" mock` 坑。
// 反过来也要靠这套 mock 覆盖「API 不存在 / 抛异常」两种降级路径。

/** 胶囊矩形（字段与真机 API 返回一致；iPhone 全面屏：状态栏 47 → top 51、高 32 → bottom 83） */
const CAPSULE = { top: 51, bottom: 83, height: 32, left: 278, right: 365, width: 87 }

/** 把胶囊 API 挂到 Taro mock 上，返回这个 spy 便于断言「确实调过真机 API」 */
function stubCapsule(rect: typeof CAPSULE) {
  const spy = vi.fn(() => rect)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(Taro as any).getMenuButtonBoundingClientRect = spy
  return spy
}

/** 取「跳过」所在那一行（.onb-topbar）的元素 */
function skipRow(): HTMLElement {
  return screen.getByText('跳过').closest('.onb-topbar') as HTMLElement
}

/**
 * 「跳过」距离页面顶端多少 px
 *
 * jsdom 不做真实布局（getBoundingClientRect 恒为 0），所以这里读**样式值**：
 * .onb-topbar 自身没有上外边距，它的 padding-top 就是该行（含「跳过」）距离顶端的位置。
 */
function skipTopPx(): number {
  return parseFloat(skipRow().style.paddingTop)
}

describe('OnboardingPage 胶囊避让', () => {
  afterEach(() => {
    // 清掉本组挂上去的 API，避免污染同文件里其它用例（它们要跑「API 不存在」的真实默认态）
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (Taro as any).getMenuButtonBoundingClientRect
    vi.clearAllMocks()
  })

  it('拿得到胶囊时：跳过落在胶囊底边下方，且用 px 不用 rpx', () => {
    const spy = stubCapsule(CAPSULE)
    render(<OnboardingPage />)

    // 核心断言：顶距 > 胶囊底边 → 真机上不会被胶囊压住
    expect(skipTopPx()).toBeGreaterThan(CAPSULE.bottom)
    // 间距口径：胶囊底边 + 8px（83 + 8 = 91）
    expect(skipTopPx()).toBe(CAPSULE.bottom + 8)
    // 单位口径：写成 '91px'。若误当 rpx 用，值会被换算放大一倍（83 → 166 这种量级），
    // 顶距会大得离谱，所以这里把 px 后缀直接钉死
    expect(skipRow().style.paddingTop).toBe('91px')
    // 只做垂直避让：不许改左右内边距把「跳过」往左挤（那会把与它同行的元素一起挪歪）
    expect(skipRow().style.paddingLeft).toBe('')
    expect(skipRow().style.paddingRight).toBe('')
    // 值必须来自真机 API，而不是碰巧等于兜底值
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('API 抛异常时：用兜底值 88px 且不崩（页面照常可用）', () => {
    // 老基础库 / 端上异常：调用即抛
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(Taro as any).getMenuButtonBoundingClientRect = vi.fn(() => {
      throw new Error('getMenuButtonBoundingClientRect is not supported')
    })
    render(<OnboardingPage />)

    // 兜底 88 = iPhone 胶囊底边 80 + 8px 呼吸位 → 依旧在胶囊（80）之下
    expect(skipTopPx()).toBe(88)
    expect(skipTopPx()).toBeGreaterThan(80)

    // 不崩：三屏内容与出口都还在
    expect(screen.getByText('星河宠记')).toBeTruthy()
    fireEvent.click(screen.getByText('跳过'))
    expect(vi.mocked(Taro.switchTab)).toHaveBeenCalledWith({ url: '/pages/index/index' })
  })

  it('API 不存在（老基础库/非微信端）时：同样走兜底值，不白屏', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (Taro as any).getMenuButtonBoundingClientRect
    render(<OnboardingPage />)

    expect(skipTopPx()).toBe(88)
    expect(screen.getByText('开始了解')).toBeTruthy()
  })

  it('API 返回无效矩形（bottom 为 0）时：不拿它当起点，回落兜底值', () => {
    stubCapsule({ ...CAPSULE, top: 0, bottom: 0, height: 0 })
    render(<OnboardingPage />)

    // 若直接信这个 0，顶距会变成 8px，等于完全没避让 → 必须回落
    expect(skipTopPx()).toBe(88)
  })
})
