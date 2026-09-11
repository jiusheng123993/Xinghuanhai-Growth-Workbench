/**
 * 安全审计 E2E 测试
 *
 * 覆盖六大维度：
 * 1. 输入验证边界条件（ruleGuard）
 * 2. 认证边界测试（authGuard）
 * 3. 数据归属隔离（petOwnership）
 * 4. 输出净化（ruleGuard sanitizeOutput）
 * 5. 频率控制（frequencyControlService）
 *
 * 策略：mock 底层依赖（storage / Taro / config / jwt），
 * 导入真实模块进行测试，验证安全边界是否牢固。
 */
/**
 * E2E 测试：安全审计
 * 验证应用安全性，包含数据隔离、越权防护和敏感信息处理
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import Taro from '@tarojs/taro'

// ============================================================
// 导入真实模块
// ============================================================
import { checkInput, sanitizeOutput } from '../utils/ruleGuard'
import {
  getAuthenticatedUserId,
  isAuthenticated,
  requireAuth,
  requireAuthAsync,
  AuthenticationError,
} from '../utils/authGuard'
import { isPetOwnerLocal, requirePetOwnership } from '../utils/petOwnership'
import {
  checkFrequency,
  recordSend,
  setDoNotDisturb,
  clearSendHistory,
  resetToDefaultRules,
  getFrequencyRule,
  setFrequencyRule,
} from '../services/frequencyControlService'

// ============================================================
// 共享 mockStorage — 所有模块共享的存储后端
// ============================================================
const mockStorage: Record<string, string> = {}

// ============================================================
// Mock 层
// ============================================================
vi.mock('../utils/storage', () => ({
  getStorage: vi.fn((key: string) => {
    const raw = mockStorage[key]
    if (!raw) return null
    try {
      return JSON.parse(raw)
    } catch {
      return null
    }
  }),
  setStorage: vi.fn((key: string, value: unknown) => {
    mockStorage[key] = JSON.stringify(value)
  }),
  removeStorage: vi.fn((key: string) => {
    delete mockStorage[key]
  }),
  getStorageArray: vi.fn((key: string) => {
    const raw = mockStorage[key]
    if (!raw) return []
    try {
      const data = JSON.parse(raw)
      return Array.isArray(data) ? data : []
    } catch {
      return []
    }
  }),
  // authGuard 依赖 storage 命名导出（utils/storage.ts 的 storage 对象）
  storage: {
    getToken: vi.fn(() => {
      const raw = mockStorage['xhh_token']
      return raw !== undefined && raw !== '' ? raw : null
    }),
    setToken: vi.fn((token: string) => {
      mockStorage['xhh_token'] = token
    }),
    removeToken: vi.fn(() => {
      delete mockStorage['xhh_token']
    }),
    getUser: vi.fn(() => {
      const raw = mockStorage['xhh_user']
      if (!raw) return null
      try {
        return JSON.parse(raw)
      } catch {
        return null
      }
    }),
    setUser: vi.fn((user: unknown) => {
      mockStorage['xhh_user'] = JSON.stringify(user)
    }),
    removeUser: vi.fn(() => {
      delete mockStorage['xhh_user']
    }),
    getRefreshToken: vi.fn(() => {
      const raw = mockStorage['xhh_refresh_token']
      return raw !== undefined && raw !== '' ? raw : null
    }),
    setRefreshToken: vi.fn((token: string) => {
      mockStorage['xhh_refresh_token'] = token
    }),
    removeRefreshToken: vi.fn(() => {
      delete mockStorage['xhh_refresh_token']
    }),
    clear: vi.fn(() => {
      delete mockStorage['xhh_token']
      delete mockStorage['xhh_user']
      delete mockStorage['xhh_refresh_token']
    }),
  },
}))

vi.mock('@tarojs/taro', () => ({
  default: {
    getStorageSync: vi.fn((key: string) => {
      const raw = mockStorage[key]
      return raw !== undefined ? raw : ''
    }),
    setStorageSync: vi.fn(),
    removeStorageSync: vi.fn((key: string) => {
      delete mockStorage[key]
    }),
    navigateTo: vi.fn(),
    request: vi.fn(),
  },
}))

vi.mock('../config', () => ({
  CONFIG: {
    STORAGE_KEYS: {
      TOKEN: 'xhh_token',
      REFRESH_TOKEN: 'xhh_refresh_token',
      USER: 'xhh_user',
    },
    API_BASE_URL: 'https://api.test.com',
    USE_MOCK: false,
  },
}))

vi.mock('../utils/jwt', () => ({
  isTokenFormatValid: vi.fn((token: string) => {
    if (!token || token === '') return false
    if (token === 'invalid-token') return false
    // 模拟 JWT 格式：三段 base64url
    return token.startsWith('eyJ') && token.split('.').length === 3
  }),
}))

// ============================================================
// 辅助函数
// ============================================================
function setAuthState(token: string, userId: string) {
  mockStorage['xhh_token'] = token
  mockStorage['xhh_user'] = JSON.stringify({ id: userId })
}

function clearAuthState() {
  delete mockStorage['xhh_token']
  delete mockStorage['xhh_user']
  delete mockStorage['xhh_refresh_token']
}

function setPetData(userId: string, pets: Array<{ id: string; name: string }>) {
  mockStorage[`pets_${userId}`] = JSON.stringify(pets)
}

function clearAllMockStorage() {
  Object.keys(mockStorage).forEach((k) => delete mockStorage[k])
}

// ============================================================
// 正文
// ============================================================

describe('安全审计', () => {
  // ----------------------------------------------------------
  // 第一部分：输入验证 - 边界条件
  // ----------------------------------------------------------
  describe('输入验证 - 边界条件', () => {
    describe('自伤关键词检测', () => {
      it('应检测到精确匹配的自伤关键词', () => {
        const result = checkInput('我觉得不想活了')
        expect(result.blocked).toBe(true)
        expect(result.isCrisis).toBe(true)
        expect(result.action).toBe('crisis_intervention')
        expect(result.reason).toBe('检测到自我伤害倾向')
      })

      it('应检测到"自杀"关键词', () => {
        const result = checkInput('我想自杀')
        expect(result.blocked).toBe(true)
        expect(result.isCrisis).toBe(true)
        expect(result.action).toBe('crisis_intervention')
      })

      it('应检测到"自残"关键词', () => {
        const result = checkInput('我有自残倾向')
        expect(result.blocked).toBe(true)
        expect(result.isCrisis).toBe(true)
      })

      it('大小写变体不再绕过 — normalizeInput 已做预处理', () => {
        const result = checkInput('不想活了')
        expect(result.blocked).toBe(true)
        const spaced = checkInput('不 想 活 了')
        expect(spaced.blocked).toBe(true)
      })

      it('标点/空格分隔不再绕过 — normalizeInput 已去除空白和标点', () => {
        const result = checkInput('不想 活了')
        expect(result.blocked).toBe(true)
        const result2 = checkInput('不·想·活·了')
        expect(result2.blocked).toBe(true)
      })
    })

    describe('动物虐待关键词检测', () => {
      it('应检测到精确匹配的虐待关键词', () => {
        const result = checkInput('如何虐待宠物')
        expect(result.blocked).toBe(true)
        expect(result.isCrisis).toBe(false)
        expect(result.action).toBe('block')
        expect(result.reason).toBe('检测到虐待动物倾向')
      })

      it('应检测到"杀猫"关键词', () => {
        const result = checkInput('怎么杀猫')
        expect(result.blocked).toBe(true)
      })

      it('应检测到"杀狗"关键词', () => {
        const result = checkInput('我想杀狗')
        expect(result.blocked).toBe(true)
      })

      it('应检测到"毒杀"关键词', () => {
        const result = checkInput('怎么毒杀动物')
        expect(result.blocked).toBe(true)
      })

      it('应检测到"打死"关键词', () => {
        const result = checkInput('把狗打死')
        expect(result.blocked).toBe(true)
      })
    })

    describe('隐私信息检测', () => {
      it('应检测到单个手机号', () => {
        const result = checkInput('我的手机是13812345678')
        expect(result.blocked).toBe(true)
        expect(result.reason).toBe('检测到疑似隐私信息')
      })

      it('应检测到文本中多个手机号', () => {
        const result = checkInput('紧急联系人：13812345678，备用：13987654321')
        expect(result.blocked).toBe(true)
      })

      it('应检测到身份证号', () => {
        const result = checkInput('110101199001011234')
        expect(result.blocked).toBe(true)
      })

      it('应检测到邮箱地址', () => {
        const result = checkInput('我的邮箱是test@example.com')
        expect(result.blocked).toBe(true)
      })

      it('应检测到复杂格式的邮箱', () => {
        const result = checkInput('联系user.name+tag@mail.example.co.uk')
        expect(result.blocked).toBe(true)
      })

      it('不应误报不完整的手机号', () => {
        // 10 位数字不匹配 11 位手机号正则
        const result = checkInput('1381234567')
        expect(result.blocked).toBe(false)
      })

      it('不应误报不完整的邮箱（无有效 TLD）', () => {
        const result = checkInput('user@test')
        expect(result.blocked).toBe(false)
      })
    })

    describe('XSS 注入尝试', () => {
      it('应通过 <script> 标签（无自伤/虐待/隐私关键词时放行）', () => {
        // ruleGuard 不负责 XSS 过滤，仅检测隐私和违规关键词
        const result = checkInput('<script>alert(1)</script>')
        // 不含关键词，应放行（XSS 防御在输出层）
        expect(result.blocked).toBe(false)
      })

      it('应通过 HTML 注入尝试', () => {
        const result = checkInput('<img src=x onerror=alert(1)>')
        expect(result.blocked).toBe(false)
      })

      it('应通过事件处理器注入', () => {
        const result = checkInput('<div onmouseover="alert(1)">hello</div>')
        expect(result.blocked).toBe(false)
      })
    })

    describe('SQL 注入尝试', () => {
      it('应通过 SQL 注入字符串（无关键词时放行）', () => {
        const result = checkInput("'; DROP TABLE users; --")
        expect(result.blocked).toBe(false)
      })

      it('应通过 UNION SELECT 注入', () => {
        const result = checkInput("' UNION SELECT * FROM users --")
        expect(result.blocked).toBe(false)
      })
    })

    describe('超长输入', () => {
      it('超长输入应被拦截', () => {
        const longText = '正常宠物喂养内容'.repeat(1000) // ~10000 chars
        const result = checkInput(longText)
        expect(result.blocked).toBe(true)
        expect(result.action).toBe('block')
      })

      it('应检测超长文本中的关键词', () => {
        const prefix = '正常内容'.repeat(500)
        const text = prefix + '自杀'
        const result = checkInput(text)
        expect(result.blocked).toBe(true)
      })

      it('应检测超长文本中的手机号', () => {
        const prefix = '正常内容'.repeat(500)
        const text = prefix + '13812345678'
        const result = checkInput(text)
        expect(result.blocked).toBe(true)
      })
    })

    describe('Unicode / Emoji 绕过尝试', () => {
      it('应正常处理 emoji 输入', () => {
        const result = checkInput('🐱🐶 今天很开心 😊')
        expect(result.blocked).toBe(false)
      })

      it('应检测到 emoji 中夹杂的关键词', () => {
        const result = checkInput('😊不想活了😢')
        expect(result.blocked).toBe(true)
      })

      it('应正常处理全角字符', () => {
        const result = checkInput('宠物今天食欲不太好，可能需要调整饮食')
        expect(result.blocked).toBe(false)
      })

      it('应正常处理零宽字符 — normalizeInput 已去除零宽字符', () => {
        const result = checkInput('不\u200B想\u200B活\u200B了')
        expect(result.blocked).toBe(true)
      })
    })

    describe('Null 字节攻击', () => {
      it('应正常处理包含 null 字节的输入', () => {
        const result = checkInput('hello\u0000world')
        expect(result.blocked).toBe(false)
      })

      it('应检测 null 字节后跟关键词', () => {
        // null 字节可能导致某些后端截断，但前端 includes 会遍历全部
        const result = checkInput('\u0000自杀')
        expect(result.blocked).toBe(true)
      })
    })

    describe('特殊字符', () => {
      it('应正常处理换行符', () => {
        const result = checkInput('宠物\n今天\n食欲\n不好')
        expect(result.blocked).toBe(false)
      })

      it('应正常处理制表符', () => {
        const result = checkInput('宠物\t今天\t食欲\t不好')
        expect(result.blocked).toBe(false)
      })

      it('应正常处理 HTML 实体', () => {
        const result = checkInput('&lt;script&gt;alert(1)&lt;/script&gt;')
        // HTML 实体本身不是关键词也不是隐私信息
        expect(result.blocked).toBe(false)
      })

      it('应正常处理空字符串', () => {
        const result = checkInput('')
        expect(result.blocked).toBe(false)
        expect(result.action).toBe('pass')
      })
    })
  })

  // ----------------------------------------------------------
  // 第二部分：认证边界测试
  // ----------------------------------------------------------
  describe('认证边界测试', () => {
    beforeEach(() => {
      clearAllMockStorage()
    })

    describe('getAuthenticatedUserId', () => {
      it('无 token 时应抛出 AuthenticationError', () => {
        expect(() => getAuthenticatedUserId()).toThrow(AuthenticationError)
        expect(() => getAuthenticatedUserId()).toThrow('未登录')
      })

      it('token 格式无效时应抛出并清除存储', () => {
        mockStorage['xhh_token'] = 'invalid-token'
        mockStorage['xhh_user'] = JSON.stringify({ id: 'user-1' })
        expect(() => getAuthenticatedUserId()).toThrow('登录已过期')
        // 应清除 token 和 user
        expect(mockStorage['xhh_token']).toBeUndefined()
        expect(mockStorage['xhh_user']).toBeUndefined()
      })

      it('token 有效但 user 缺失时应抛出', () => {
        mockStorage['xhh_token'] = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dummy'
        expect(() => getAuthenticatedUserId()).toThrow('用户信息缺失')
      })

      it('user 对象无 id 字段时应抛出', () => {
        mockStorage['xhh_token'] = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dummy'
        mockStorage['xhh_user'] = JSON.stringify({ name: 'test' })
        expect(() => getAuthenticatedUserId()).toThrow('用户ID缺失')
      })

      it('正常认证应返回 userId', () => {
        setAuthState(
          'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dummy',
          'user-123',
        )
        expect(getAuthenticatedUserId()).toBe('user-123')
      })
    })

    describe('isAuthenticated', () => {
      it('无 token 时应返回 false', () => {
        expect(isAuthenticated()).toBe(false)
      })

      it('token 为空字符串时应返回 false', () => {
        mockStorage['xhh_token'] = ''
        expect(isAuthenticated()).toBe(false)
      })

      it('token 为纯空格时应返回 false', () => {
        mockStorage['xhh_token'] = '   '
        expect(isAuthenticated()).toBe(false)
      })

      it('token 格式无效时应返回 false', () => {
        mockStorage['xhh_token'] = 'some-random-string'
        expect(isAuthenticated()).toBe(false)
      })

      it('token 有效时应返回 true', () => {
        mockStorage['xhh_token'] = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.sig'
        expect(isAuthenticated()).toBe(true)
      })
    })

    describe('requireAuth', () => {
      it('未认证时应导航到登录页并抛出', () => {
        expect(() => requireAuth()).toThrow(AuthenticationError)
        expect(Taro.navigateTo).toHaveBeenCalledWith({ url: '/pagesUser/login/index' })
      })

      it('token 仅一段（非 JWT 格式）应被拒绝', () => {
        mockStorage['xhh_token'] = 'not-a-jwt-token-at-all'
        expect(() => requireAuth()).toThrow(AuthenticationError)
        expect(Taro.navigateTo).toHaveBeenCalled()
      })

      it('token 为两段格式应被拒绝', () => {
        mockStorage['xhh_token'] = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0'
        expect(() => requireAuth()).toThrow(AuthenticationError)
      })

      it('token 为四段格式应被拒绝', () => {
        mockStorage['xhh_token'] = 'a.b.c.d'
        expect(() => requireAuth()).toThrow(AuthenticationError)
      })

      it('正常认证应返回 userId 和 token', () => {
        setAuthState(
          'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.sig',
          'user-789',
        )
        const result = requireAuth()
        expect(result.userId).toBe('user-789')
        expect(result.token).toBe('eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.sig')
      })
    })

    describe('requireAuthAsync', () => {
      it('token 无效时应导航到登录页', async () => {
        mockStorage['xhh_token'] = 'bad-token'
        await expect(requireAuthAsync()).rejects.toThrow(AuthenticationError)
        expect(Taro.navigateTo).toHaveBeenCalledWith({ url: '/pagesUser/login/index' })
      })

      it('正常认证应返回 userId 和 token', async () => {
        setAuthState(
          'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.sig',
          'user-async',
        )
        const result = await requireAuthAsync()
        expect(result.userId).toBe('user-async')
        expect(result.token).toBe('eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.sig')
      })
    })

    describe('并发认证请求', () => {
      it('多个快速 requireAuth 调用应保持一致', () => {
        setAuthState(
          'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.sig',
          'user-concurrent',
        )
        const results = Array.from({ length: 5 }, () => requireAuth())
        results.forEach((r) => {
          expect(r.userId).toBe('user-concurrent')
          expect(r.token).toBe('eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.sig')
        })
      })

      it('多个快速 requireAuthAsync 调用应保持一致', async () => {
        setAuthState(
          'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.sig',
          'user-async-multi',
        )
        const promises = Array.from({ length: 5 }, () => requireAuthAsync())
        const results = await Promise.all(promises)
        results.forEach((r) => {
          expect(r.userId).toBe('user-async-multi')
          expect(r.token).toBe('eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.sig')
        })
      })
    })

    describe('AuthenticationError', () => {
      it('应正确设置 name 属性', () => {
        const err = new AuthenticationError('测试错误')
        expect(err.name).toBe('AuthenticationError')
        expect(err.message).toBe('测试错误')
        expect(err).toBeInstanceOf(Error)
        expect(err).toBeInstanceOf(AuthenticationError)
      })
    })
  })

  // ----------------------------------------------------------
  // 第三部分：数据归属隔离
  // ----------------------------------------------------------
  describe('数据归属隔离', () => {
    beforeEach(() => {
      clearAllMockStorage()
    })

    describe('isPetOwnerLocal', () => {
      it('petId 为空时应返回 false', () => {
        expect(isPetOwnerLocal('', 'user-1')).toBe(false)
      })

      it('userId 为空时应返回 false', () => {
        expect(isPetOwnerLocal('pet-1', '')).toBe(false)
      })

      it('两个参数都为空时应返回 false', () => {
        expect(isPetOwnerLocal('', '')).toBe(false)
      })

      it('用户无宠物数据时应返回 false', () => {
        expect(isPetOwnerLocal('pet-1', 'user-1')).toBe(false)
      })

      it('用户拥有该宠物时应返回 true', () => {
        setPetData('user-1', [{ id: 'pet-1', name: '青橘' }])
        expect(isPetOwnerLocal('pet-1', 'user-1')).toBe(true)
      })

      it('用户不拥有该宠物时应返回 false', () => {
        setPetData('user-1', [{ id: 'pet-1', name: '青橘' }])
        expect(isPetOwnerLocal('pet-999', 'user-1')).toBe(false)
      })

      it('跨用户访问 — 用户 A 不能访问用户 B 的宠物', () => {
        setPetData('user-a', [{ id: 'pet-a', name: '小A的宠物' }])
        setPetData('user-b', [{ id: 'pet-b', name: '小B的宠物' }])
        // 用户 A 尝试访问用户 B 的宠物
        expect(isPetOwnerLocal('pet-b', 'user-a')).toBe(false)
        // 用户 B 尝试访问用户 A 的宠物
        expect(isPetOwnerLocal('pet-a', 'user-b')).toBe(false)
      })

      it('同一用户拥有多个宠物时，应正确区分', () => {
        setPetData('user-1', [
          { id: 'pet-1', name: '青橘' },
          { id: 'pet-2', name: '小黄' },
          { id: 'pet-3', name: '花花' },
        ])
        expect(isPetOwnerLocal('pet-1', 'user-1')).toBe(true)
        expect(isPetOwnerLocal('pet-2', 'user-1')).toBe(true)
        expect(isPetOwnerLocal('pet-3', 'user-1')).toBe(true)
        expect(isPetOwnerLocal('pet-4', 'user-1')).toBe(false)
      })

      it('不同用户拥有同名宠物 ID 时应隔离', () => {
        setPetData('user-a', [{ id: 'shared-id', name: 'A的宠物' }])
        setPetData('user-b', [{ id: 'shared-id', name: 'B的宠物' }])
        // 各自只能访问自己的
        expect(isPetOwnerLocal('shared-id', 'user-a')).toBe(true)
        expect(isPetOwnerLocal('shared-id', 'user-b')).toBe(true)
        // 但存储 key 是隔离的，互不影响
      })
    })

    describe('requirePetOwnership', () => {
      it('userId 为空时应抛出错误', () => {
        expect(() => requirePetOwnership('pet-1', '')).toThrow('[PetOwnership] userId is required')
      })

      it('petId 为空时应抛出错误', () => {
        expect(() => requirePetOwnership('', 'user-1')).toThrow('[PetOwnership] petId is required')
      })

      it('无权限时应抛出错误', () => {
        setPetData('user-1', [{ id: 'pet-1', name: '青橘' }])
        expect(() => requirePetOwnership('pet-999', 'user-1')).toThrow('无权访问该宠物数据')
      })

      it('有权限时不应抛出', () => {
        setPetData('user-1', [{ id: 'pet-1', name: '青橘' }])
        expect(() => requirePetOwnership('pet-1', 'user-1')).not.toThrow()
      })

      it('跨用户 require 应抛出', () => {
        setPetData('user-a', [{ id: 'pet-a', name: 'A的宠物' }])
        setPetData('user-b', [{ id: 'pet-b', name: 'B的宠物' }])
        expect(() => requirePetOwnership('pet-b', 'user-a')).toThrow('无权访问该宠物数据')
      })
    })
  })

  // ----------------------------------------------------------
  // 第四部分：输出净化
  // ----------------------------------------------------------
  describe('输出净化', () => {
    describe('sanitizeOutput 基础行为', () => {
      it('不应修改短文本', () => {
        const input = '宠物今天状态良好'
        expect(sanitizeOutput(input)).toBe(input)
      })

      it('应使用默认 maxLength=150', () => {
        const longText = 'x'.repeat(200)
        const result = sanitizeOutput(longText)
        expect(result.length).toBe(153) // 150 + '...'
        expect(result.endsWith('...')).toBe(true)
      })

      it('自定义 maxLength 应生效', () => {
        const text = 'x'.repeat(100)
        const result = sanitizeOutput(text, 50)
        expect(result.length).toBe(53) // 50 + '...'
        expect(result.endsWith('...')).toBe(true)
      })

      it('恰好等于 maxLength 的文本不应截断', () => {
        const text = 'x'.repeat(150)
        const result = sanitizeOutput(text, 150)
        expect(result).toBe(text)
        expect(result.endsWith('...')).toBe(false)
      })
    })

    describe('sanitizeOutput 对 HTML 的处理', () => {
      it('sanitizeOutput 应转义 HTML 标签', () => {
        const input = '<div>宠物状态</div>'
        const result = sanitizeOutput(input)
        expect(result).toBe('&lt;div&gt;宠物状态&lt;/div&gt;')
      })

      it('sanitizeOutput 应转义 script 标签', () => {
        const input = '<script>alert("xss")</script>'
        const result = sanitizeOutput(input)
        expect(result).toBe('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;')
      })

      it('超长 HTML 文本应被截断', () => {
        const input = '<div>' + 'x'.repeat(200) + '</div>'
        const result = sanitizeOutput(input, 150)
        expect(result.endsWith('...')).toBe(true)
        expect(result.length).toBeLessThanOrEqual(153)
      })
    })

    describe('sanitizeOutput 边界', () => {
      it('空字符串应原样返回', () => {
        expect(sanitizeOutput('')).toBe('')
      })

      it('maxLength=0 时仍追加省略号', () => {
        const result = sanitizeOutput('hello', 0)
        expect(result).toBe('...')
      })

      it('maxLength=1 时正常截断', () => {
        const result = sanitizeOutput('hello', 1)
        expect(result).toBe('h...')
      })
    })
  })

  // ----------------------------------------------------------
  // 第五部分：频率控制
  // ----------------------------------------------------------
  describe('频率控制', () => {
    beforeEach(() => {
      clearAllMockStorage()
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-07-20T10:00:00'))
      resetToDefaultRules()
      setDoNotDisturb({ enabled: false, startHour: 22, startMinute: 0, endHour: 8, endMinute: 0 })
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    const TEMPLATE_ID = 'FOLLOWUP_TEMPLATE_ID_PLACEHOLDER'

    describe('基础频率检查', () => {
      it('首次发送应允许', () => {
        const result = checkFrequency(TEMPLATE_ID)
        expect(result.allowed).toBe(true)
        expect(result.remainingToday).toBeGreaterThan(0)
      })

      it('最小间隔内重复发送应被阻止', () => {
        recordSend(TEMPLATE_ID, true)
        const result = checkFrequency(TEMPLATE_ID)
        expect(result.allowed).toBe(false)
        expect(result.reason).toContain('频繁')
      })

      it('超过最小间隔后应允许发送', () => {
        recordSend(TEMPLATE_ID, true)
        vi.advanceTimersByTime(61 * 60 * 1000) // 61 分钟
        const result = checkFrequency(TEMPLATE_ID)
        expect(result.allowed).toBe(true)
      })

      it('【快速连续调用】多次快速 checkFrequency 应返回一致结果', () => {
        const results = Array.from({ length: 5 }, () => checkFrequency(TEMPLATE_ID))
        results.forEach((r) => {
          expect(r.allowed).toBe(true)
        })
      })
    })

    describe('每日限制', () => {
      it('达到每日上限后应阻止', () => {
        const rule = getFrequencyRule(TEMPLATE_ID)
        for (let i = 0; i < rule.dailyLimit; i++) {
          recordSend(TEMPLATE_ID, true)
          vi.advanceTimersByTime(61 * 60 * 1000)
        }
        const result = checkFrequency(TEMPLATE_ID)
        expect(result.allowed).toBe(false)
        expect(result.reason).toContain('今日')
        expect(result.remainingToday).toBe(0)
      })

      it('每日上限前最后一次应允许', () => {
        const rule = getFrequencyRule(TEMPLATE_ID)
        for (let i = 0; i < rule.dailyLimit - 1; i++) {
          recordSend(TEMPLATE_ID, true)
          vi.advanceTimersByTime(61 * 60 * 1000)
        }
        const result = checkFrequency(TEMPLATE_ID)
        expect(result.allowed).toBe(true)
      })

      it('跨天后应重置每日限制', () => {
        const rule = getFrequencyRule(TEMPLATE_ID)
        for (let i = 0; i < rule.dailyLimit; i++) {
          recordSend(TEMPLATE_ID, true)
          vi.advanceTimersByTime(61 * 60 * 1000)
        }
        // 进入下一天
        vi.setSystemTime(new Date('2026-07-21T10:00:00'))
        const result = checkFrequency(TEMPLATE_ID)
        expect(result.allowed).toBe(true)
      })
    })

    describe('免打扰时段', () => {
      it('免打扰时段内应阻止发送', () => {
        // 设置全天免打扰
        setDoNotDisturb({ enabled: true, startHour: 0, startMinute: 0, endHour: 23, endMinute: 59 })
        const result = checkFrequency(TEMPLATE_ID)
        expect(result.allowed).toBe(false)
        expect(result.reason).toContain('免打扰')
      })

      it('免打扰时段外应允许发送', () => {
        // 当前时间 10:00，免打扰 22:00-08:00，不在范围内
        setDoNotDisturb({ enabled: true, startHour: 22, startMinute: 0, endHour: 8, endMinute: 0 })
        const result = checkFrequency(TEMPLATE_ID)
        expect(result.allowed).toBe(true)
      })

      it('跨天免打扰（22:00-08:00）在夜间应阻止', () => {
        vi.setSystemTime(new Date('2026-07-20T23:00:00'))
        setDoNotDisturb({ enabled: true, startHour: 22, startMinute: 0, endHour: 8, endMinute: 0 })
        const result = checkFrequency(TEMPLATE_ID)
        expect(result.allowed).toBe(false)
        expect(result.reason).toContain('免打扰')
      })

      it('跨天免打扰（22:00-08:00）在凌晨应阻止', () => {
        vi.setSystemTime(new Date('2026-07-21T03:00:00'))
        setDoNotDisturb({ enabled: true, startHour: 22, startMinute: 0, endHour: 8, endMinute: 0 })
        const result = checkFrequency(TEMPLATE_ID)
        expect(result.allowed).toBe(false)
      })

      it('关闭免打扰后应允许发送', () => {
        setDoNotDisturb({ enabled: false })
        const result = checkFrequency(TEMPLATE_ID)
        expect(result.allowed).toBe(true)
      })
    })

    describe('全局限制', () => {
      it('全局每日上限应生效（多模板交叉发送）', () => {
        // 创建一个自定义模板规则，单模板限制设高，避免触发单模板限制
        const CUSTOM_ID = 'CUSTOM_GLOBAL_TEST_TEMPLATE'
        setFrequencyRule(CUSTOM_ID, {
          dailyLimit: 100,
          weeklyLimit: 100,
          monthlyLimit: 200,
          minInterval: 1,
          enabled: true,
        })
        // 发送 10 条消息，达到全局每日限制
        for (let i = 0; i < 10; i++) {
          recordSend(CUSTOM_ID, true)
          vi.advanceTimersByTime(2 * 60 * 1000) // 2 分钟间隔
        }
        // 全局每日限制为 10，现在应已耗尽
        const result = checkFrequency(CUSTOM_ID)
        expect(result.allowed).toBe(false)
        expect(result.reason).toContain('总消息数')
      })
    })

    describe('clearSendHistory / resetToDefaultRules', () => {
      it('清除历史后应允许发送', () => {
        recordSend(TEMPLATE_ID, true)
        const blocked = checkFrequency(TEMPLATE_ID)
        expect(blocked.allowed).toBe(false)

        clearSendHistory()
        const result = checkFrequency(TEMPLATE_ID)
        expect(result.allowed).toBe(true)
      })

      it('重置为默认规则后应恢复初始状态', () => {
        recordSend(TEMPLATE_ID, true)
        vi.advanceTimersByTime(61 * 60 * 1000)
        recordSend(TEMPLATE_ID, true)

        resetToDefaultRules()
        const result = checkFrequency(TEMPLATE_ID)
        expect(result.allowed).toBe(true)
      })
    })
  })
})