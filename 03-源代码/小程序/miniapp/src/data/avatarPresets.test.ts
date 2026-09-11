/**
 * 预设形象库测试
 * 验证 20 款预设（狗 10 + 猫 10）数据完整、ID 唯一、与家庭页品牌头像同源（key 一致）、按物种筛选正确
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// 头像数据已随资源移到 pagesPet 分包内（主包体积优化），测试改为引用新路径
import { AVATAR_PRESETS, getPresetsBySpecies } from '../pagesPet/avatar-customize/data/avatarPresets'
import { HOME_STYLE_AVATARS } from './homeStyleAvatars'

// mock api 模块（resolveAvatarUrl 依赖 CONFIG.API_BASE_URL），与 homeStyleAvatars.test.ts 同一套约定
vi.mock('../services/api', () => ({
  resolveAvatarUrl: (path: string) => `https://mock-api.example.com${path}`,
}))

describe('预设形象库', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('共 20 款：狗 10 款 + 猫 10 款', () => {
    expect(AVATAR_PRESETS).toHaveLength(20)
    expect(AVATAR_PRESETS.filter((item) => item.species === 'dog')).toHaveLength(10)
    expect(AVATAR_PRESETS.filter((item) => item.species === 'cat')).toHaveLength(10)
  })

  it('ID 唯一且格式为 物种-序号-英文名（与品牌头像 key 一致）', () => {
    const ids = AVATAR_PRESETS.map((item) => item.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const item of AVATAR_PRESETS) {
      expect(item.id).toMatch(/^(dog|cat)-[0-9]{2}-[a-z-]+$/)
    }
  })

  it('与家庭页头像同源：每个预设 key 都存在于品牌头像库，图片为分包内本地资源', () => {
    const homeKeys = new Set(HOME_STYLE_AVATARS.map((item) => item.key))
    for (const item of AVATAR_PRESETS) {
      // 预设 ID = 品牌头像 key，保证"形象"与"头像"是同一张图
      expect(homeKeys.has(item.id)).toBe(true)
      // 2026-08-24：预设形象已改为分包内本地打包资源（见 data/avatarPresets.ts 注释，
      // 避免依赖 downloadFile 域名；原断言服务端 https URL 已随实现变更修正），
      // 这里验证图片来自本地 preset-home 目录且为 PNG（与服务器 home-style 同源同批图）
      expect(item.image).toMatch(/preset-home\/(dog|cat)\/[a-z0-9-]+\.png$/)
    }
  })

  it('每款都有品种展示名', () => {
    for (const item of AVATAR_PRESETS) {
      expect(item.breed).toBeTruthy()
    }
  })

  it('getPresetsBySpecies 按物种筛选', () => {
    expect(getPresetsBySpecies('dog').every((item) => item.species === 'dog')).toBe(true)
    expect(getPresetsBySpecies('cat').every((item) => item.species === 'cat')).toBe(true)
  })
})
