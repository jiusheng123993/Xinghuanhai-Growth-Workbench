/**
 * PageHero 组件测试（2026-09-12 新建，配合「插画比例错配」修复）
 *
 * 【这个组件为什么必须有测试】全站 3 个页面在用（创作 / 时光 / 家庭），
 * 而它 2026-09-12 之前犯过一个**只在真机上看得出来**的错：假设插画是 16:9，
 * 按 156rpx 横幅高反推出插画宽 = 卡片宽 40%，并让卡片渐变的硬拐点也卡在 40%。
 * 但服务器上的插画里**春/秋/冬是 1254×1254 方图、只有夏季是 1536×1024 宽图**
 * （当时的默认主题秋季同样是方图）→ `aspectFit` 让方图在槽里两边各留约 60rpx 空带，
 * 图片右缘与 40% 拐点之间露出一条底色带，真机上是「图片右边多出一条空带 / 硬缝」。
 *
 * 这类"比例耦合"缺陷光看代码看不出来（旧数值自身是自洽的），DOM 快照也看不出来，
 * 所以本文件锁三层：
 *  ① 行为：文案渲染 / 点击回调 / 可选节点不渲染 / className 透传；
 *  ② 结构：插画用 `heightFix`、且插画是卡片里的**第一个**子节点（文案在右侧，不叠在图上）；
 *  ③ 样式约定 + 反回归（读源码文本）：
 *     · 插画块**高度 = 卡片高度（156rpx）**，宽度必须是 `auto`（让图片按比例自算）
 *       —— 只要有人把"由 16:9 反推尺寸"写回来（`40%` 也好、`277rpx` 也好），断言立刻变红；
 *     · 插画块与 TSX 里**不许出现 `aspectFit` / `aspectFill`** —— 这两个一个会留白带、
 *       一个会裁切，正是本组件两轮退掉的方案；
 *     · 卡片固定 156rpx 高、且没有渐变拐点。
 *
 * 【构图迭代史（断言随方案改过两次，但一条都没删）】
 *   · 第 1 版「满宽 + widthFix」→ 页头约 830rpx ≈ 半屏，退掉（当时锁的是 widthFix + height:auto）；
 *   · 第 2 版「固定方框 + aspectFill」→ 夏季宽图裁掉猫头，退掉（当时锁的是 width/height 相等）；
 *   · 第 3 版「高度定死 + heightFix」← 当前，锁定见下。
 *
 * ⚠️ 这里刻意**局部** mock `@tarojs/components`：全局 setup.ts 的 Image mock 会把 `mode`
 *    丢掉，那样就断言不了 heightFix。本文件的 Image mock 把 mode 落到 `data-mode` 上。
 */
import { describe, it, expect, vi } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
// 源码文本用于样式约定 / 反回归锁（vitest 的 cwd = 小程序包根目录）
import { readFileSync } from 'node:fs'

// 把 Taro 组件映射成原生 DOM；Image 额外把 mode 暴露到 data-mode（全局 mock 会丢 mode）
vi.mock('@tarojs/components', () => ({
  View: ({ children, className, onClick }: any) => (
    <div className={className} onClick={onClick}>
      {children}
    </div>
  ),
  Text: ({ children, className }: any) => <span className={className}>{children}</span>,
  // 只取 className / src / mode：hoverClass、lazyLoad、onError 这些非 DOM 属性直接丢掉，
  // 否则 React 会把它们当未知属性渲染出来并刷一屏 warning
  Image: ({ className, src, mode }: any) => <img className={className} src={src} data-mode={mode} />,
}))

// Illustration 组件依赖主题 hook 与服务端 URL 拼接：这里给固定值，
// 让本文件只测 PageHero 自己的构图，不把主题链路拖进来（那条链路由 Illustration.test.tsx 守）
vi.mock('../../hooks/useThemeClass', () => ({
  useThemeKey: () => 'autumn',
}))
vi.mock('../../services/api', () => ({
  resolveAvatarUrl: (path: string) => `https://api.xinghuanhai.com${path}`,
}))

// eslint-disable-next-line import/first
import PageHero from '../PageHero'

/**
 * 剥掉源码里的全部注释。
 *
 * 为什么必须去注释：本次修复的说明性注释里**故意写满了旧数值与退掉的方案**
 * （156rpx / 40% / 16:9 / 277rpx / aspectFill / aspectFit），
 * 那是给后来人看的"别再改回去"的证据。若不断言在"去掉注释的真实代码"上，
 * 断言就会被自己的注释绊倒（要么假红、要么逼着后人删掉这些证据）。
 *
 * @param file - 相对小程序包根目录的源码路径
 * @returns 只剩真实代码的文本
 */
function codeOf(file: string): string {
  return readFileSync(file, 'utf-8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '')
}

/**
 * 从（已去注释的）SCSS 里切出某个选择器的规则块（`选择器 {` 到紧随的 `}`）
 * @param code - 去注释后的 SCSS 文本
 * @param selector - 选择器原文（必须与文件里逐字符一致，含空格）
 * @returns 该规则块的声明文本
 */
function ruleBlock(code: string, selector: string): string {
  const start = code.indexOf(`${selector} {`)
  if (start < 0) throw new Error(`找不到选择器 ${selector}：选择器被改名或删掉了，断言已失效`)
  return code.slice(start, code.indexOf('}', start))
}

/**
 * 取规则块里某个属性的 rpx 数值（不带单位）；取不到直接抛错，避免断言空转
 * @param block - 规则块文本
 * @param prop - 属性名
 * @returns 数值（rpx 前的数字）
 */
function rpxOf(block: string, prop: 'width' | 'height'): number {
  const m = block.match(new RegExp(`${prop}:\\s*([\\d.]+)rpx`))
  if (!m) throw new Error(`规则块里没有 ${prop}: NNNrpx，尺寸写法变了：${block}`)
  return Number(m[1])
}

describe('PageHero · 文案与交互', () => {
  it('渲染 title / subtitle / actionText（三个消费页都靠这些文案）', () => {
    const { container } = render(
      <PageHero
        illustration='page-family'
        title='宠物家庭'
        subtitle='和家人一起，记录毛孩子的每一天'
        actionText='记录'
        onAction={() => {}}
      />,
    )

    expect(container.querySelector('.page-hero')).not.toBeNull()
    expect(container.querySelector('.page-hero__title')?.textContent).toBe('宠物家庭')
    expect(container.querySelector('.page-hero__subtitle')?.textContent).toBe(
      '和家人一起，记录毛孩子的每一天',
    )
    expect(container.querySelector('.page-hero__action-text')?.textContent).toBe('记录')
  })

  it('点击 action 触发 onAction', () => {
    const onAction = vi.fn()
    const { container } = render(
      <PageHero illustration='page-timeline' title='时光' actionText='记录' onAction={onAction} />,
    )

    fireEvent.click(container.querySelector('.page-hero__action')!)
    expect(onAction).toHaveBeenCalledTimes(1)
  })

  it('不传 subtitle / actionText 时不渲染对应节点（页面没要求就不要多出空块）', () => {
    const { container } = render(<PageHero illustration='page-mine' title='我的' />)

    expect(container.querySelector('.page-hero__title')?.textContent).toBe('我的')
    expect(container.querySelector('.page-hero__subtitle')).toBeNull()
    expect(container.querySelector('.page-hero__action')).toBeNull()
  })

  it('className 透传到根节点（消费页靠它做覆盖，类名契约不能破）', () => {
    const { container } = render(
      <PageHero illustration='page-creative' title='你的宠物值得一件作品' className='cve-hero-art' />,
    )

    expect(container.querySelector('.page-hero')?.className).toContain('cve-hero-art')
  })
})

describe('PageHero · 与图片比例无关的构图（回归锁）', () => {
  it('插画用 heightFix —— 1.00 的方图与 1.50 的宽图都零裁切零留白', () => {
    const { container } = render(<PageHero illustration='page-timeline' title='时光' />)

    // 高度定死 156rpx、宽度由图片自身比例算：
    // 方图（春/秋/冬，含默认主题的春季）→ 156rpx 宽；宽图（夏 1.50）→ 234rpx 宽。
    // aspectFit 会给宽图上下留约 26rpx 空带（= 本次要修的缺陷）；aspectFill 会左右各裁 16.7%
    // （实测把猫的头脸整块裁掉）。只有 heightFix / widthFix 这类"一边定死、一边自算"的 mode 两不沾。
    expect(container.querySelector('.page-hero__art')?.getAttribute('data-mode')).toBe('heightFix')
  })

  it('插画是卡片里的第一个子节点（图在左、文案在右，不把文字叠到图上）', () => {
    const { container } = render(
      <PageHero illustration='page-family' title='宠物家庭' subtitle='副标题' actionText='记录' />,
    )

    const card = container.querySelector('.page-hero')!
    expect(card.firstElementChild?.className).toContain('page-hero__art')
    // 文案块跟在插画之后
    expect(card.lastElementChild?.className).toContain('page-hero__body')
  })

  it('插画块高度 = 卡片高度、宽度必须是 auto（宽度交给图片按比例自算）', () => {
    const code = codeOf('src/components/PageHero.scss')
    const card = ruleBlock(code, '.page-hero')
    const art = ruleBlock(code, '.page-hero .page-hero__art')

    // 高度定死且等于横幅高 → 页头总高在任何季节、任何比例下都是 156rpx
    expect(rpxOf(art, 'height')).toBe(rpxOf(card, 'height'))
    // 宽度必须是 auto：不能是百分比（旧缺陷 width: 40%）也不能是死像素宽（旧缺陷 156×16/9 ≈ 277rpx）。
    // `auto` 同时是压过 `.illustration--fill { width: 100% }` 的必要声明（见 scss 注释）。
    expect(art).toMatch(/width:\s*auto/)
    expect(art).not.toMatch(/width:\s*[\d.]+(rpx|%)/)
  })

  it('源码里不许再出现 aspectFit / aspectFill（一个留白带、一个裁主体，都已试过并退掉）', () => {
    // mode 写在 TSX 里，所以这条必须查 TSX（注释已剥离，决策链里提到它们不算违规）
    const tsx = codeOf('src/components/PageHero.tsx')

    expect(tsx).toMatch(/mode=\{?['"]heightFix['"]\}?/)
    expect(tsx).not.toContain('aspectFit')
    expect(tsx).not.toContain('aspectFill')
  })

  it('页头固定 156rpx 紧凑高、无渐变拐点、无任何按比例算出的百分比宽', () => {
    const code = codeOf('src/components/PageHero.scss')
    const card = ruleBlock(code, '.page-hero')

    // 固定高：图与文案同一行，页头总高恒为它（试过的"满宽插画+文案在图下"会涨到约 830rpx ≈ 半屏）
    expect(rpxOf(card, 'height')).toBe(156)
    // 旧渐变（#fbcba4 40% 那一版）的唯一用途是接住插画右缘；插画改成"高度定死+宽度自算"后没有接缝可接
    expect(card).not.toContain('linear-gradient')
    expect(card).not.toContain('%')
    // 全局兜底：整个组件不许有"按比例算出来的百分比宽"（40% / 22.5% 这类都会被抓到）
    expect(code).not.toMatch(/width:\s*(?!100%)[\d.]+%/)
  })
})
