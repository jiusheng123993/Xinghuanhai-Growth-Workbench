import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

import { parseJwt, isTokenExpired, getTokenExpiry, isTokenExpiringSoon, verifyToken } from '../jwt'

vi.mock('../../crypto', () => ({
  CryptoJS: {
    enc: {
      Utf8: {
        stringify: vi.fn((input: string) => input),
      },
      Base64: {
        parse: vi.fn((str: string) => {
          const base64 = str.replace(/-/g, '+').replace(/_/g, '/')
          try {
            return decodeURIComponent(escape(atob(base64)))
          } catch {
            return ''
          }
        }),
      },
    },
  },
}))

function createTestToken(payload: Record<string, unknown>): string {
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).replace(/=/g, '')
  const body = btoa(JSON.stringify(payload)).replace(/=/g, '')
  const sig = 'test-signature'
  return `${header}.${body}.${sig}`
}

describe('jwt', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-20T10:00:00'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('parseJwt', () => {
    it('returns parsed payload for valid token', () => {
      const token = createTestToken({ sub: 'user1', name: 'Test User' })
      const result = parseJwt(token)
      expect(result).not.toBeNull()
      expect(result!.sub).toBe('user1')
      expect(result!.name).toBe('Test User')
    })

    it('returns null for token with wrong number of parts', () => {
      expect(parseJwt('only.one')).toBeNull()
      expect(parseJwt('a.b.c.d')).toBeNull()
      expect(parseJwt('')).toBeNull()
      expect(parseJwt('single')).toBeNull()
    })

    it('returns null for invalid base64 in payload', () => {
      const token = `header.!!!invalid!!!.signature`
      expect(parseJwt(token)).toBeNull()
    })

    it('extracts exp, sub, iat correctly', () => {
      const payload = { sub: 'user123', exp: 1735689600, iat: 1735603200 }
      const token = createTestToken(payload)
      const result = parseJwt(token)
      expect(result).not.toBeNull()
      expect(result!.sub).toBe('user123')
      expect(result!.exp).toBe(1735689600)
      expect(result!.iat).toBe(1735603200)
    })
  })

  describe('isTokenExpired', () => {
    it('returns true for expired token', () => {
      const token = createTestToken({ exp: Math.floor(Date.now() / 1000) - 3600 })
      expect(isTokenExpired(token)).toBe(true)
    })

    it('returns false for valid token with future exp', () => {
      const token = createTestToken({ exp: Math.floor(Date.now() / 1000) + 3600 })
      expect(isTokenExpired(token)).toBe(false)
    })

    it('returns true for token without exp field', () => {
      const token = createTestToken({ sub: 'user1' })
      expect(isTokenExpired(token)).toBe(true)
    })

    it('returns true when parseJwt returns null', () => {
      expect(isTokenExpired('invalid')).toBe(true)
    })
  })

  describe('getTokenExpiry', () => {
    it('returns correct ms value', () => {
      const expSeconds = 1735689600
      const token = createTestToken({ exp: expSeconds })
      expect(getTokenExpiry(token)).toBe(expSeconds * 1000)
    })

    it('returns null for token without exp', () => {
      const token = createTestToken({ sub: 'user1' })
      expect(getTokenExpiry(token)).toBeNull()
    })

    it('returns null when parseJwt returns null', () => {
      expect(getTokenExpiry('invalid')).toBeNull()
    })
  })

  describe('isTokenExpiringSoon', () => {
    it('returns true if expiring within 30 minutes', () => {
      const token = createTestToken({ exp: Math.floor(Date.now() / 1000) + 600 })
      expect(isTokenExpiringSoon(token)).toBe(true)
    })

    it('returns false if not expiring soon', () => {
      const token = createTestToken({ exp: Math.floor(Date.now() / 1000) + 7200 })
      expect(isTokenExpiringSoon(token)).toBe(false)
    })

    it('returns true if no expiry info', () => {
      const token = createTestToken({ sub: 'user1' })
      expect(isTokenExpiringSoon(token)).toBe(true)
    })

    it('returns true for already expired token', () => {
      const token = createTestToken({ exp: Math.floor(Date.now() / 1000) - 60 })
      expect(isTokenExpiringSoon(token)).toBe(true)
    })
  })

  describe('verifyToken', () => {
    it('returns true for valid non-expired token', () => {
      const token = createTestToken({ exp: Math.floor(Date.now() / 1000) + 3600 })
      expect(verifyToken(token)).toBe(true)
    })

    it('returns false for expired token', () => {
      const token = createTestToken({ exp: Math.floor(Date.now() / 1000) - 3600 })
      expect(verifyToken(token)).toBe(false)
    })

    it('returns false for malformed token', () => {
      expect(verifyToken('')).toBe(false)
      expect(verifyToken('a.b')).toBe(false)
      expect(verifyToken('a.b.c.d')).toBe(false)
    })

    it('returns false for empty string', () => {
      expect(verifyToken('')).toBe(false)
    })
  })
})
