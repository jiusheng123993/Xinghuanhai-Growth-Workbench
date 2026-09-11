/**
 * Icon 组件测试
 *
 * Icon 是全站图标体系的唯一出口（30+ 页面在用），它承担两个关键约定：
 *  1. data URI 渲染（小程序不支持内联 SVG）
 *  2. 自动判别 line/fill 两种风格 + 语义色跟随主题
 * 这里把这两条约定锁住，避免后续改动悄悄破坏（图标不显示属于最难排查的一类问题）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/react'

vi.mock('@tarojs/components', () => ({
  Image: ({ className, src, style }: any) => (
    <img className={className} src={src} style={style} data-testid='icon-img' />
  ),
}))

vi.mock('../../stores/themeStore', () => ({
  useThemeStore: {
    getState: () => ({ current: mockThemeKey.value }),
  },
  THEME_LIST: [
    { key: 'autumn', name: '暖阳珊瑚橙', primaryColor: '#FF6B3D', dark: false },
    { key: 'starry', name: '星空银河', primaryColor: '#7A8CFF', dark: true },
  ],
}))

const mockThemeKey = { value: 'autumn' }

// eslint-disable-next-line import/first
import Icon, { asciiToBase64 } from '../Icon'
// eslint-disable-next-line import/first
import { FILL_ICON_PATHS } from '../icons-fill'

/**
 * 从 data URI 里还原出 SVG 文本，便于断言颜色 / viewBox
 *
 * 必须是 base64 形式：小程序 <image> 只解析 base64 的 data URI，
 * URL 编码形式在开发者工具/真机都不渲染（2026-09-10 全站图标空白事故根因）。
 */
function decodeSrc(src: string): string {
  const base64 = src.replace(/^data:image\/svg\+xml;base64,/, '')
  return decodeURIComponent(escape(atob(base64)))
}

describe('Icon', () => {
  beforeEach(() => {
    mockThemeKey.value = 'autumn'
  })

  it('渲染为 base64 形式的 data URI（小程序 Image 组件只认 base64）', () => {
    const { getByTestId } = render(<Icon name='syringe' />)
    const src = getByTestId('icon-img').getAttribute('src')!
    // 锁住编码形态：URL 编码形式（data:image/svg+xml,<urlencoded>）在小程序里不渲染
    expect(src).toMatch(/^data:image\/svg\+xml;base64,/)
    // 必须能解回合法 SVG（防止编码器写坏、生成一串无效 base64）
    expect(decodeSrc(src)).toContain('<svg')
  })

  it('面性图标用 256 网格 + fill 注入颜色', () => {
    const { getByTestId } = render(<Icon name='syringe' />)
    const svg = decodeSrc(getByTestId('icon-img').getAttribute('src')!)
    expect(svg).toContain('viewBox=\'0 0 256 256\'')
    expect(svg).toContain('fill=')
  })

  it('线性历史图标用 24 网格 + stroke 绘制', () => {
    const { getByTestId } = render(<Icon name='home' variant='line' />)
    const svg = decodeSrc(getByTestId('icon-img').getAttribute('src')!)
    expect(svg).toContain('viewBox=\'0 0 24 24\'')
    expect(svg).toContain('stroke=')
  })

  it('name 在两套表里都存在时，未指定 variant 走面性（新体系优先）', () => {
    // 'star' 线性/面性都有
    const fill = render(<Icon name='star' />).getByTestId('icon-img').getAttribute('src')!
    expect(decodeSrc(fill)).toContain('0 0 256 256')
  })

  it('未收录的图标名不渲染（返回 null，避免画出空白占位）', () => {
    const { container } = render(<Icon name={'not-a-real-icon' as any} />)
    expect(container.querySelector('[data-testid="icon-img"]')).toBeNull()
  })

  it('tone=primary 取当前主题主色', () => {
    const { getByTestId } = render(<Icon name='syringe' tone='primary' />)
    const svg = decodeSrc(getByTestId('icon-img').getAttribute('src')!)
    expect(svg).toContain('#FF6B3D')
  })

  it('深色主题下 tone=ink 自动转为白色（保证深色背景上可见）', () => {
    mockThemeKey.value = 'starry'
    const { getByTestId } = render(<Icon name='syringe' tone='ink' />)
    const svg = decodeSrc(getByTestId('icon-img').getAttribute('src')!)
    expect(svg).toContain('#FFFFFF')
  })

  it('浅色主题下 tone=ink 用深棕正文色', () => {
    const { getByTestId } = render(<Icon name='syringe' tone='ink' />)
    const svg = decodeSrc(getByTestId('icon-img').getAttribute('src')!)
    expect(svg).toContain('#40281C')
  })

  it('显式 color 优先于默认色', () => {
    const { getByTestId } = render(<Icon name='syringe' color='#123456' />)
    const svg = decodeSrc(getByTestId('icon-img').getAttribute('src')!)
    expect(svg).toContain('#123456')
  })

  it('size 支持字符串（em/rpx），用于跟随父容器字号', () => {
    const { getByTestId } = render(<Icon name='syringe' size='1em' />)
    const style = getByTestId('icon-img').getAttribute('style')!
    expect(style).toContain('1em')
  })

  it('size 传数字时按 px 处理', () => {
    const { getByTestId } = render(<Icon name='syringe' size={20} />)
    const style = getByTestId('icon-img').getAttribute('style')!
    expect(style).toContain('20px')
  })

  it('className 透传到根元素（页面靠它控制尺寸/间距）', () => {
    const { getByTestId } = render(<Icon name='syringe' className='my-icon' />)
    expect(getByTestId('icon-img').className).toContain('my-icon')
  })

  it('面性图标表非空，且每个值都是可用的 path 数据', () => {
    const names = Object.keys(FILL_ICON_PATHS)
    expect(names.length).toBeGreaterThan(50)
    for (const n of names) {
      expect(FILL_ICON_PATHS[n as keyof typeof FILL_ICON_PATHS]).toContain('<path')
    }
  })

  it('每个面性图标的 data URI 都能被还原成完整 SVG（编码器不能漏字符）', () => {
    for (const n of Object.keys(FILL_ICON_PATHS) as (keyof typeof FILL_ICON_PATHS)[]) {
      const { container } = render(<Icon name={n} />)
      const src = container.querySelector('[data-testid="icon-img"]')!.getAttribute('src')!
      const svg = decodeSrc(src)
      expect(svg.startsWith('<svg ')).toBe(true)
      expect(svg.endsWith('</svg>')).toBe(true)
    }
  })
})

describe('asciiToBase64（Icon 自带的 base64 编码器，小程序无 btoa）', () => {
  it('输出与 atob 可逆（ASCII 往返一致）', () => {
    const samples = ['', 'f', 'fo', 'foo', 'foob', 'fooba', 'foobar', "<svg viewBox='0 0 24 24'>a</svg>"]
    for (const s of samples) {
      expect(atob(asciiToBase64(s))).toBe(s)
    }
  })

  it('不足 3 字节时按标准补 = 号', () => {
    expect(asciiToBase64('f')).toBe('Zg==')
    expect(asciiToBase64('fo')).toBe('Zm8=')
    expect(asciiToBase64('foo')).toBe('Zm9v')
  })

  it('与标准 base64 向量逐字符一致（长度取模三种情况都覆盖）', () => {
    // 标准测试向量（RFC 4648 §10），等价于 Node Buffer.from(s).toString('base64')
    expect(asciiToBase64('a')).toBe('YQ==')
    expect(asciiToBase64('ab')).toBe('YWI=')
    expect(asciiToBase64('abc')).toBe('YWJj')
    expect(asciiToBase64('abcd')).toBe('YWJjZA==')
    expect(asciiToBase64('abcde')).toBe('YWJjZGU=')
    expect(asciiToBase64('hello world')).toBe('aGVsbG8gd29ybGQ=')
  })
})
