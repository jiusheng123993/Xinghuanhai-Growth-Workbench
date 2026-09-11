/**
 * resolveAvatarUrl 头像 URL 补全纯函数测试
 * 覆盖：空值、完整绝对 URL、协议相对 //host、站内相对路径 /uploads、其他 blob/文件名
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

import { resolveAvatarUrl } from '../api'

// 固定 API 前缀，用于断言相对路径拼接结果。
// 必须放进 vi.hoisted：vi.mock 的工厂会被提升到文件顶部执行，普通 const 此时还没初始化。
const { BASE } = vi.hoisted(() => ({ BASE: 'https://api.xinghuanhai.com' }))

// mock 掉 Taro 与 config，只暴露 resolveAvatarUrl，避免加载 api.ts 时触发 Taro 副作用
vi.mock('@tarojs/taro', () => ({ default: {} }))
vi.mock('../../config', () => ({
  CONFIG: { API_BASE_URL: BASE, USE_MOCK: false },
}))

describe('resolveAvatarUrl', () => {
  // 每测前清理，保证无状态污染
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should return empty string for empty / null / undefined', () => {
    // 边界：空串
    expect(resolveAvatarUrl('')).toBe('')
    // 边界：null
    expect(resolveAvatarUrl(null)).toBe('')
    // 边界：undefined
    expect(resolveAvatarUrl(undefined)).toBe('')
  })

  it('should prepend API base to single-slash relative path', () => {
    // 正常：上传头像接口返回的站内相对路径，应拼出绝对地址
    expect(resolveAvatarUrl('/uploads/user-avatars/u1/a.jpg')).toBe(`${BASE}/uploads/user-avatars/u1/a.jpg`)
  })

  it('should keep absolute http(s) URL unchanged', () => {
    // 正常：微信授权返回的完整 https 地址
    expect(resolveAvatarUrl('https://thirdwx.qlogo.cn/mmopen/123')).toBe('https://thirdwx.qlogo.cn/mmopen/123')
    // 正常：http 地址
    expect(resolveAvatarUrl('http://cdn.example.com/a.png')).toBe('http://cdn.example.com/a.png')
  })

  it('should keep protocol-relative URL unchanged', () => {
    // 边界：//host 形式（继承页面协议）
    expect(resolveAvatarUrl('//cdn.example.com/a.png')).toBe('//cdn.example.com/a.png')
  })

  it('should return data URI and plain filenames unchanged', () => {
    // 异常：dataURI 不该被当成站内路径拼接
    expect(resolveAvatarUrl('data:image/png;base64,iVBOR')).toBe('data:image/png;base64,iVBOR')
    // 异常：纯文件名（无前缀）不加 BASE
    expect(resolveAvatarUrl('a.png')).toBe('a.png')
  })
})