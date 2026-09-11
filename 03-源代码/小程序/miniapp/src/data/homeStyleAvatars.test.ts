/**
 * 家庭页小动物头像映射测试
 * 覆盖：breedId 精确匹配、品种关键词匹配（含大小写）、物种兜底、远程 URL 契约（含 species 子目录）
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

import {
  getHomeStyleAvatarKey,
  getHomeStyleAvatarUrl,
  getHomeStyleAvatarUrlByKey,
  resolvePetAvatarUrl,
} from './homeStyleAvatars'

// 先 mock api 模块（resolveAvatarUrl 依赖 CONFIG.API_BASE_URL）
vi.mock('../services/api', () => ({
  resolveAvatarUrl: (path: string) => `https://mock-api.example.com${path}`,
}))

// 构造最小宠物档案（PetProfile 的 Pick 类型所需字段 + 可选头像字段）
function makePet(overrides: Partial<{
  species: 'dog' | 'cat'
  breed: string
  breedId: string
  avatarPhotoUrl?: string | null
  avatarCartoonUrl?: string | null
}>) {
  return {
    species: overrides.species ?? 'cat',
    breed: overrides.breed ?? '',
    breedId: overrides.breedId ?? '',
    ...('avatarPhotoUrl' in overrides ? { avatarPhotoUrl: overrides.avatarPhotoUrl } : {}),
    ...('avatarCartoonUrl' in overrides ? { avatarCartoonUrl: overrides.avatarCartoonUrl } : {}),
  }
}

// 期望的 10 猫 + 10 狗 key（与 server/uploads/avatars/home-style 目录一一对应）
const EXPECTED_CAT_KEYS = [
  'cat-01-orange-tabby', 'cat-02-british-blue', 'cat-03-cow', 'cat-04-calico', 'cat-05-black',
  'cat-06-white-blue-eye', 'cat-07-siamese', 'cat-08-ragdoll', 'cat-09-chinese-tabby', 'cat-10-american-shorthair',
]
const EXPECTED_DOG_KEYS = [
  'dog-01-golden', 'dog-02-shiba', 'dog-03-corgi', 'dog-04-husky', 'dog-05-samoyed',
  'dog-06-french-bulldog', 'dog-07-bichon', 'dog-08-border-collie', 'dog-09-labrador', 'dog-10-poodle',
]

describe('家庭页小动物头像映射', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('猫狗各有 10 个可选头像 key，且每个 key 都能被对应品种命中', () => {
    // 每个期望 key 配一个能命中的品种（breedId 或中文名），验证 20 张全覆盖
    const catProbes: Array<[string, string]> = [
      ['cat-01-orange-tabby', '橘猫'],
      ['cat-02-british-blue', '英短蓝猫'],
      ['cat-03-cow', '奶牛猫'],
      ['cat-04-calico', '三花猫'],
      ['cat-05-black', '黑猫'],
      ['cat-06-white-blue-eye', '白猫'],
      ['cat-07-siamese', '暹罗猫'],
      ['cat-08-ragdoll', '布偶猫'],
      ['cat-09-chinese-tabby', '狸花猫'],
      ['cat-10-american-shorthair', '美短'],
    ]
    const dogProbes: Array<[string, string]> = [
      ['dog-01-golden', '金毛'],
      ['dog-02-shiba', '柴犬'],
      ['dog-03-corgi', '柯基'],
      ['dog-04-husky', '哈士奇'],
      ['dog-05-samoyed', '萨摩耶'],
      ['dog-06-french-bulldog', '法斗'],
      ['dog-07-bichon', '比熊'],
      ['dog-08-border-collie', '边牧'],
      ['dog-09-labrador', '拉布拉多'],
      ['dog-10-poodle', '泰迪'],
    ]
    // 每个 key 都应在期望清单里且能命中
    for (const [key, probe] of [...catProbes, ...dogProbes]) {
      const species = key.startsWith('cat-') ? 'cat' : 'dog'
      expect(getHomeStyleAvatarKey(makePet({ species, breed: probe }))).toBe(key)
    }
    // 期望清单恰好 10 猫 + 10 狗，无重复
    expect(catProbes.map(([k]) => k)).toEqual(EXPECTED_CAT_KEYS)
    expect(dogProbes.map(([k]) => k)).toEqual(EXPECTED_DOG_KEYS)
  })

  it('breedId 精确匹配：golden_retriever → dog-01', () => {
    const key = getHomeStyleAvatarKey(makePet({ species: 'dog', breedId: 'golden_retriever' }))
    expect(key).toBe('dog-01-golden')
  })

  it('breedId 精确匹配：british_shorthair → cat-02', () => {
    const key = getHomeStyleAvatarKey(makePet({ species: 'cat', breedId: 'british_shorthair' }))
    expect(key).toBe('cat-02-british-blue')
  })

  it('breedId 大小写不敏感：GOLDEN_RETRIEVER → dog-01', () => {
    const key = getHomeStyleAvatarKey(makePet({ species: 'dog', breedId: 'GOLDEN_RETRIEVER' }))
    expect(key).toBe('dog-01-golden')
  })

  it('品种关键词匹配：breed="金毛寻回犬"（无 breedId）→ dog-01', () => {
    const key = getHomeStyleAvatarKey(makePet({ species: 'dog', breed: '金毛寻回犬', breedId: '' }))
    expect(key).toBe('dog-01-golden')
  })

  it('品种关键词匹配：breed="英短蓝猫" → cat-02', () => {
    const key = getHomeStyleAvatarKey(makePet({ species: 'cat', breed: '英短蓝猫' }))
    expect(key).toBe('cat-02-british-blue')
  })

  it('英文品种关键词大小写不敏感：breed="Golden Retriever" → dog-01', () => {
    const key = getHomeStyleAvatarKey(makePet({ species: 'dog', breed: 'Golden Retriever' }))
    expect(key).toBe('dog-01-golden')
  })

  it('物种兜底：未知品种的猫 → cat-01，狗 → dog-01', () => {
    expect(getHomeStyleAvatarKey(makePet({ species: 'cat', breed: '未知品种' }))).toBe('cat-01-orange-tabby')
    expect(getHomeStyleAvatarKey(makePet({ species: 'dog', breed: '未知品种' }))).toBe('dog-01-golden')
  })

  it('空档案兜底：无品种无 breedId 的猫 → cat-01', () => {
    expect(getHomeStyleAvatarKey(makePet({ species: 'cat' }))).toBe('cat-01-orange-tabby')
  })

  it('URL 契约：含 species 子目录 + .png 后缀（服务器文件真实布局）', () => {
    // 猫：ragdoll → cat 子目录
    expect(getHomeStyleAvatarUrl(makePet({ species: 'cat', breedId: 'ragdoll' })))
      .toBe('https://mock-api.example.com/uploads/avatars/home-style/cat/cat-08-ragdoll.png')
    // 狗：golden_retriever → dog 子目录
    expect(getHomeStyleAvatarUrl(makePet({ species: 'dog', breedId: 'golden_retriever' })))
      .toBe('https://mock-api.example.com/uploads/avatars/home-style/dog/dog-01-golden.png')
  })

  it('关键词匹配不跨物种：猫的"金毛"关键词不会命中狗的 dog-01', () => {
    // 猫品种里含"金毛"字样时仍应兜底为猫头像
    const key = getHomeStyleAvatarKey(makePet({ species: 'cat', breed: '金毛色短毛猫' }))
    expect(key.startsWith('cat-')).toBe(true)
  })

  it('长词优先：含单字"白"的长品种名应命中更长关键词的条目而非单字条目', () => {
    // "白毛英短"同时含单字"白"（cat-06）和长词"英短"（cat-02），应命中 cat-02
    const key = getHomeStyleAvatarKey(makePet({ species: 'cat', breed: '白毛英短' }))
    expect(key).toBe('cat-02-british-blue')
  })

  it('长词优先：中文长词优先于英文短词', () => {
    // "白色贵宾犬" 含 "贵宾"（dog-10）与 "白"（cat-06 但跨物种不比较），狗侧应命中 dog-10
    const key = getHomeStyleAvatarKey(makePet({ species: 'dog', breed: '白色贵宾犬' }))
    expect(key).toBe('dog-10-poodle')
  })

  it('URL 按 key 直拼：getHomeStyleAvatarUrlByKey 带物种子目录 + .png 后缀', () => {
    // 猫：cat-08 → cat 子目录
    expect(getHomeStyleAvatarUrlByKey('cat-08-ragdoll', 'cat'))
      .toBe('https://mock-api.example.com/uploads/avatars/home-style/cat/cat-08-ragdoll.png')
    // 狗：dog-01 → dog 子目录
    expect(getHomeStyleAvatarUrlByKey('dog-01-golden', 'dog'))
      .toBe('https://mock-api.example.com/uploads/avatars/home-style/dog/dog-01-golden.png')
  })

  it('getHomeStyleAvatarUrl 与 getHomeStyleAvatarUrlByKey 输出一致（同源不漂移）', () => {
    // 预设形象库用 ByKey 直拼、家庭页用品种匹配，两者必须指向同一张图
    const pet = makePet({ species: 'cat', breedId: 'ragdoll' })
    expect(getHomeStyleAvatarUrl(pet)).toBe(getHomeStyleAvatarUrlByKey('cat-08-ragdoll', 'cat'))
    const dog = makePet({ species: 'dog', breedId: 'golden_retriever' })
    expect(getHomeStyleAvatarUrl(dog)).toBe(getHomeStyleAvatarUrlByKey('dog-01-golden', 'dog'))
  })

  // ===== resolvePetAvatarUrl：全站宠物头像统一口径 =====

  it('resolvePetAvatarUrl：真实照片优先于 AI 形象与品牌头像', () => {
    const pet = makePet({
      species: 'cat',
      breedId: 'ragdoll',
      avatarPhotoUrl: 'https://cdn.example.com/photo.png',
      avatarCartoonUrl: 'https://cdn.example.com/cartoon.png',
    })
    expect(resolvePetAvatarUrl(pet)).toBe('https://cdn.example.com/photo.png')
  })

  it('resolvePetAvatarUrl：无照片时用 AI 形象', () => {
    const pet = makePet({
      species: 'cat',
      breedId: 'ragdoll',
      avatarPhotoUrl: null,
      avatarCartoonUrl: 'https://cdn.example.com/cartoon.png',
    })
    expect(resolvePetAvatarUrl(pet)).toBe('https://cdn.example.com/cartoon.png')
  })

  it('resolvePetAvatarUrl：都没有时回退品种品牌头像（永不返回空串）', () => {
    // 回归（2026-09-10 用户反馈「头像没显示」）：新建宠物没设头像，
    // 档案页此前只剩空渐变圆 —— 统一口径必须给出按品种匹配的小动物头像
    const cat = makePet({ species: 'cat', breedId: 'ragdoll', avatarPhotoUrl: null, avatarCartoonUrl: null })
    expect(resolvePetAvatarUrl(cat))
      .toBe('https://mock-api.example.com/uploads/avatars/home-style/cat/cat-08-ragdoll.png')
    const dog = makePet({ species: 'dog', breedId: 'golden_retriever', avatarPhotoUrl: undefined, avatarCartoonUrl: undefined })
    expect(resolvePetAvatarUrl(dog))
      .toBe('https://mock-api.example.com/uploads/avatars/home-style/dog/dog-01-golden.png')
  })

  it('resolvePetAvatarUrl：品种未知时按物种兜底，仍返回品牌头像', () => {
    const pet = makePet({ species: 'cat', breed: '', breedId: '', avatarPhotoUrl: null, avatarCartoonUrl: null })
    expect(resolvePetAvatarUrl(pet)).toContain('/uploads/avatars/home-style/cat/')
  })
})
