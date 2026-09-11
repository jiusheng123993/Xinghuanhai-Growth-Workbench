import { describe, it, expect, vi, beforeEach } from 'vitest'

import {
  getStorage,
  getStorageArray,
  setStorage,
  removeStorage,
  clearAllStorage,
  setStorageUserId,
} from '../storage'

const mockStore: Record<string, string> = {}

vi.mock('@tarojs/taro', () => {
  const taroMock = {
    getStorageSync: vi.fn((key: string) => mockStore[key] ?? ''),
    setStorageSync: vi.fn((key: string, value: string) => { mockStore[key] = value }),
    removeStorageSync: vi.fn((key: string) => { delete mockStore[key] }),
    getStorageInfoSync: vi.fn(() => ({ keys: Object.keys(mockStore) })),
  }
  return { default: taroMock, ...taroMock }
})

describe('storage', () => {
  beforeEach(() => {
    Object.keys(mockStore).forEach(k => delete mockStore[k])
    setStorageUserId('')
  })

  describe('getStorage', () => {
    it('returns null for missing key', () => {
      expect(getStorage('nonexistent')).toBeNull()
    })

    it('returns parsed JSON for existing key', () => {
      mockStore['settings'] = '{"theme":"dark"}'
      expect(getStorage('settings')).toEqual({ theme: 'dark' })
    })

    it('returns null for invalid JSON', () => {
      mockStore['bad'] = '{invalid json'
      expect(getStorage('bad')).toBeNull()
    })

    it('returns null for empty string value', () => {
      mockStore['empty'] = ''
      expect(getStorage('empty')).toBeNull()
    })

    it('handles numeric values stored as JSON', () => {
      mockStore['count'] = '42'
      expect(getStorage<number>('count')).toBe(42)
    })

    it('handles array values stored as JSON', () => {
      mockStore['items'] = '[1,2,3]'
      expect(getStorage<number[]>('items')).toEqual([1, 2, 3])
    })

    it('uses userId prefix when set', () => {
      setStorageUserId('user123')
      mockStore['user123_health_entries'] = '{"heartRate":72}'
      expect(getStorage('health_entries')).toEqual({ heartRate: 72 })
    })

    it('returns null when userId set but key without prefix', () => {
      setStorageUserId('user123')
      mockStore['health_entries'] = '{"heartRate":72}'
      expect(getStorage('health_entries')).toBeNull()
    })
  })

  describe('getStorageArray', () => {
    it('returns empty array for missing key', () => {
      expect(getStorageArray('nonexistent')).toEqual([])
    })

    it('returns stored array', () => {
      mockStore['items'] = '[1,2,3]'
      expect(getStorageArray<number>('items')).toEqual([1, 2, 3])
    })

    it('returns empty array when stored value is null', () => {
      mockStore['missing'] = ''
      expect(getStorageArray('missing')).toEqual([])
    })
  })

  describe('setStorage', () => {
    it('stores JSON string without prefix when no userId', () => {
      setStorage('settings', { theme: 'light' })
      expect(mockStore['settings']).toBe('{"theme":"light"}')
    })

    it('stores with userId prefix when userId is set', () => {
      setStorageUserId('user123')
      setStorage('health_entries', { heartRate: 72 })
      expect(mockStore['user123_health_entries']).toBe('{"heartRate":72}')
    })

    it('stores string values as JSON', () => {
      setStorage('token', 'abc123')
      expect(mockStore['token']).toBe('"abc123"')
    })

    it('stores null value as JSON', () => {
      setStorage('nullable', null)
      expect(mockStore['nullable']).toBe('null')
    })

    it('stores array as JSON', () => {
      setStorage('items', [1, 2, 3])
      expect(mockStore['items']).toBe('[1,2,3]')
    })
  })

  describe('removeStorage', () => {
    it('removes key without prefix when no userId', () => {
      mockStore['settings'] = '{"theme":"dark"}'
      removeStorage('settings')
      expect(mockStore['settings']).toBeUndefined()
    })

    it('removes key with userId prefix', () => {
      setStorageUserId('user123')
      mockStore['user123_settings'] = '{"theme":"dark"}'
      removeStorage('settings')
      expect(mockStore['user123_settings']).toBeUndefined()
    })

    it('does not affect keys without prefix when userId is set', () => {
      setStorageUserId('user123')
      mockStore['other_key'] = 'value'
      removeStorage('other_key')
      expect(mockStore['other_key']).toBe('value')
      expect(mockStore['user123_other_key']).toBeUndefined()
    })
  })

  describe('clearAllStorage', () => {
    it('removes all keys with userId prefix', () => {
      setStorageUserId('user123')
      mockStore['user123_a'] = '1'
      mockStore['user123_b'] = '2'
      mockStore['user123_c'] = '3'
      clearAllStorage()
      expect(mockStore['user123_a']).toBeUndefined()
      expect(mockStore['user123_b']).toBeUndefined()
      expect(mockStore['user123_c']).toBeUndefined()
    })

    it('keeps keys without userId prefix', () => {
      setStorageUserId('user123')
      mockStore['user123_a'] = '1'
      mockStore['other_key'] = 'value'
      clearAllStorage()
      expect(mockStore['user123_a']).toBeUndefined()
      expect(mockStore['other_key']).toBe('value')
    })

    it('handles empty storage', () => {
      expect(() => clearAllStorage()).not.toThrow()
    })
  })

  describe('setStorageUserId', () => {
    it('switches key namespace when userId changes', () => {
      setStorage('data', { value: 'before' })
      expect(mockStore['data']).toBe('{"value":"before"}')

      setStorageUserId('user456')
      setStorage('data', { value: 'after' })
      expect(mockStore['user456_data']).toBe('{"value":"after"}')
      // Old data still exists under old key
      expect(mockStore['data']).toBe('{"value":"before"}')
    })

    it('reads with new userId prefix after switching', () => {
      setStorageUserId('user789')
      mockStore['user789_data'] = '{"value":1}'
      expect(getStorage('data')).toEqual({ value: 1 })
    })
  })
})