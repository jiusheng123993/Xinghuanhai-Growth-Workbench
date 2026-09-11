import { describe, it, expect, vi, beforeEach } from 'vitest'

import { encrypt, decrypt, generateId, CryptoJS } from '../crypto'

// 注意：vi.hoisted 工厂内的局部变量不能与解构出的外层同名（会触发 @typescript-eslint/no-shadow），
// 故内部一律用 xxxFn / utf8Symbol 命名，返回时再映射成对外的 mock 名
const { mockEncrypt, mockDecrypt, mockSHA256, mockUtf8 } = vi.hoisted(() => {
  const SEP = '|||'
  const PREFIX_LEN = 3 + SEP.length
  const encryptFn = vi.fn((data: string, key: string) => ({
    toString: () => `ENC${SEP}${key}${SEP}${data}`,
  }))
  const decryptFn = vi.fn((data: string, key: string) => {
    const result = {
      toString: (enc?: unknown) => {
        if (data.startsWith('ENC' + SEP)) {
          const withoutPrefix = data.slice(PREFIX_LEN)
          const firstSep = withoutPrefix.indexOf(SEP)
          if (firstSep === -1) throw new Error('invalid format')
          const k = withoutPrefix.substring(0, firstSep)
          const rest = withoutPrefix.substring(firstSep + SEP.length)
          if (k !== key) throw new Error('key mismatch')
          return rest
        }
        throw new Error('decrypt failed')
      },
    }
    return result
  })
  const sha256Fn = vi.fn((input: string) => ({
    toString: () => `hash_${input}`,
  }))
  const utf8Symbol = Symbol('Utf8')
  return { mockEncrypt: encryptFn, mockDecrypt: decryptFn, mockSHA256: sha256Fn, mockUtf8: utf8Symbol }
})

vi.mock('crypto-js/aes', () => ({
  default: { encrypt: mockEncrypt, decrypt: mockDecrypt },
}))

vi.mock('crypto-js/sha256', () => ({
  default: mockSHA256,
}))

vi.mock('crypto-js/enc-utf8', () => ({
  default: mockUtf8,
}))

vi.mock('crypto-js/enc-base64', () => ({
  default: 'Base64',
}))

const DEV_SALT = 'xhh-v2-aes-salt-2026-dev'

describe('crypto', () => {
  beforeEach(() => {
    mockEncrypt.mockClear()
    mockDecrypt.mockClear()
    mockSHA256.mockClear()
  })

  describe('encrypt', () => {
    it('returns a string', () => {
      const result = encrypt('hello', 'user1')
      expect(typeof result).toBe('string')
    })

    it('calls AES.encrypt with data and derived key', () => {
      encrypt('hello', 'user1')
      expect(mockSHA256).toHaveBeenCalledWith(`${DEV_SALT}:user1`)
      expect(mockEncrypt).toHaveBeenCalledWith('hello', `hash_${DEV_SALT}:user1`)
    })

    it('produces different output for different userId', () => {
      const r1 = encrypt('hello', 'user1')
      const r2 = encrypt('hello', 'user2')
      expect(r1).not.toBe(r2)
    })

    it('produces same output for same data and userId', () => {
      const r1 = encrypt('hello', 'user1')
      const r2 = encrypt('hello', 'user1')
      expect(r1).toBe(r2)
    })

    it('derives key using SHA256 with salt and userId', () => {
      encrypt('test', 'abc')
      expect(mockSHA256).toHaveBeenCalledWith(`${DEV_SALT}:abc`)
    })
  })

  describe('decrypt', () => {
    it('successfully decrypts encrypted data', () => {
      const encrypted = encrypt('secret', 'user1')
      const result = decrypt(encrypted, 'user1')
      expect(result).toBe('secret')
    })

    it('returns empty string for invalid data', () => {
      const result = decrypt('not-encrypted', 'user1')
      expect(result).toBe('')
    })

    it('returns empty string for wrong userId', () => {
      const encrypted = encrypt('secret', 'user1')
      const result = decrypt(encrypted, 'user2')
      expect(result).toBe('')
    })

    it('calls AES.decrypt with encrypted string and derived key', () => {
      decrypt('ENC|||somekey|||somedata', 'user1')
      expect(mockSHA256).toHaveBeenCalledWith(`${DEV_SALT}:user1`)
      expect(mockDecrypt).toHaveBeenCalledWith('ENC|||somekey|||somedata', `hash_${DEV_SALT}:user1`)
    })

    it('returns empty string when decrypt throws', () => {
      const result = decrypt('garbage-data', 'user1')
      expect(result).toBe('')
    })
  })

  describe('encrypt/decrypt roundtrip', () => {
    it('encrypt then decrypt returns original data', () => {
      const original = 'my-secret-data'
      const encrypted = encrypt(original, 'user1')
      const decrypted = decrypt(encrypted, 'user1')
      expect(decrypted).toBe(original)
    })

    it('roundtrip works with empty string', () => {
      const original = ''
      const encrypted = encrypt(original, 'user1')
      const decrypted = decrypt(encrypted, 'user1')
      expect(decrypted).toBe(original)
    })

    it('roundtrip works with special characters', () => {
      const original = '你好世界!@#$%^&*()'
      const encrypted = encrypt(original, 'user1')
      const decrypted = decrypt(encrypted, 'user1')
      expect(decrypted).toBe(original)
    })
  })

  describe('generateId', () => {
    it('returns a string with underscore separator', () => {
      const id = generateId()
      expect(id).toContain('_')
    })

    it('returns unique values on successive calls', () => {
      const ids = new Set<string>()
      for (let i = 0; i < 100; i++) {
        ids.add(generateId())
      }
      expect(ids.size).toBe(100)
    })

    it('contains timestamp and random part', () => {
      const before = Date.now()
      const id = generateId()
      const after = Date.now()
      const [timestampStr, randomPart] = id.split('_')
      const timestamp = Number(timestampStr)
      expect(timestamp).toBeGreaterThanOrEqual(before)
      expect(timestamp).toBeLessThanOrEqual(after)
      expect(randomPart.length).toBeGreaterThan(0)
    })
  })

  describe('CryptoJS re-export', () => {
    it('is accessible', () => {
      expect(CryptoJS).toBeDefined()
      expect(CryptoJS.AES).toBeDefined()
      expect(CryptoJS.SHA256).toBeDefined()
      expect(CryptoJS.enc).toBeDefined()
    })
  })
})
