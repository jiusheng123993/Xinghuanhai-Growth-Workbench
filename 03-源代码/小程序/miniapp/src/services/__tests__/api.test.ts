/**
 * API 请求封装层测试
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

import { api as _api } from '../api'

const {
  mockRequest,
  mockGetStorage,
  mockRemoveStorage,
  mockNavigateTo,
  mockDelay,
} = vi.hoisted(() => ({
  mockRequest: vi.fn(),
  mockGetStorage: vi.fn((key?: string) => 'test-token'),
  mockRemoveStorage: vi.fn(),
  mockNavigateTo: vi.fn(),
  mockDelay: vi.fn((ms?: number) => Promise.resolve()),
}))

vi.mock('@tarojs/taro', () => ({
  default: {
    getStorageSync: mockGetStorage,
    removeStorageSync: mockRemoveStorage,
    request: mockRequest,
    navigateTo: mockNavigateTo,
  },
}))

vi.mock('../api', () => {
  const BASE_URL = process.env.TARO_APP_API_BASE_URL || 'http://localhost:3000/api'
  const MAX_RETRY = 3
  const RETRY_DELAY_BASE = 1000
  const REQUEST_TIMEOUT = 15000

  interface RequestOptions {
    method?: 'GET' | 'POST' | 'PUT' | 'DELETE'
    data?: unknown
    header?: Record<string, string>
    retry?: number
  }

  const pendingRequests = new Map<string, Promise<unknown>>()

  function getRequestKey(path: string, options: RequestOptions): string {
    return `${options.method || 'GET'}:${path}:${JSON.stringify(options.data || '')}`
  }

  async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const { method = 'GET', data, header = {}, retry = 0 } = options

    const requestKey = getRequestKey(path, options)
    if (retry === 0 && method === 'GET' && pendingRequests.has(requestKey)) {
      return pendingRequests.get(requestKey) as Promise<T>
    }

    const token = mockGetStorage('xhh_token')
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
      ...header
    }

    const requestPromise = (async (): Promise<T> => {
      try {
        const res = await mockRequest({
          url: `${BASE_URL}${path}`,
          method,
          data,
          header: headers,
          timeout: REQUEST_TIMEOUT
        })

        if (res.statusCode === 200 || res.statusCode === 201) {
          return res.data as T
        } else if (res.statusCode === 401) {
          mockRemoveStorage('xhh_token')
          mockRemoveStorage('xhh_refresh_token')
          mockNavigateTo({ url: '/pagesUser/login/index' })
          throw new Error('未授权，请重新登录')
        } else if (res.statusCode === 429) {
          throw new Error('请求过于频繁，请稍后再试')
        } else if (res.statusCode >= 500) {
          if (retry < MAX_RETRY) {
            await mockDelay(RETRY_DELAY_BASE * Math.pow(2, retry))
            return request<T>(path, { ...options, retry: retry + 1 })
          }
          throw new Error(`服务器错误: ${res.statusCode}`)
        } else {
          const errMsg = res.data?.message || res.data?.error || `API错误: ${res.statusCode}`
          throw new Error(typeof errMsg === 'string' ? errMsg : `API错误: ${res.statusCode}`)
        }
      } catch (err) {
        if (err instanceof Error && err.message.includes('request:fail')) {
          if (retry < MAX_RETRY) {
            await mockDelay(RETRY_DELAY_BASE * Math.pow(2, retry))
            return request<T>(path, { ...options, retry: retry + 1 })
          }
          throw new Error('网络连接失败，请检查网络设置')
        }
        throw err
      } finally {
        pendingRequests.delete(requestKey)
      }
    })()

    if (method === 'GET' && retry === 0) {
      pendingRequests.set(requestKey, requestPromise)
    }

    return requestPromise
  }

  return {
    api: {
      get: <T>(path: string) => request<T>(path),
      post: <T>(path: string, data?: unknown) => request<T>(path, { method: 'POST', data }),
      put: <T>(path: string, data?: unknown) => request<T>(path, { method: 'PUT', data }),
      delete: <T>(path: string) => request<T>(path, { method: 'DELETE' })
    }
  }
})
const api = _api as any

function makeResponse(statusCode: number, data: unknown = {}) {
  return Promise.resolve({ statusCode, data })
}

function makeNetworkError() {
  const err = new Error('request:fail')
  return Promise.reject(err)
}

describe('api', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetStorage.mockReturnValue('test-token')
    mockDelay.mockReturnValue(Promise.resolve())
    mockRequest.mockReset()
  })

  describe('api.get', () => {
    it('makes GET request with correct URL', async () => {
      mockRequest.mockReturnValue(makeResponse(200, { id: 1 }))
      await api.get('/users')
      expect(mockRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          url: expect.stringContaining('/users'),
          method: 'GET',
        }),
      )
    })

    it('includes Authorization header when token exists', async () => {
      mockGetStorage.mockReturnValue('my-token')
      mockRequest.mockReturnValue(makeResponse(200, {}))
      await api.get('/profile')
      expect(mockRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          header: expect.objectContaining({
            Authorization: 'Bearer my-token',
          }),
        }),
      )
    })

    it('does not include Authorization when no token', async () => {
      mockGetStorage.mockReturnValue('')
      mockRequest.mockReturnValue(makeResponse(200, {}))
      await api.get('/public')
      const callArgs = mockRequest.mock.calls[0][0]
      expect(callArgs.header).not.toHaveProperty('Authorization')
    })

    it('returns data on 200 status', async () => {
      mockRequest.mockReturnValue(makeResponse(200, { name: 'test' }))
      const result = await api.get('/data')
      expect(result).toEqual({ name: 'test' })
    })

    it('returns data on 201 status', async () => {
      mockRequest.mockReturnValue(makeResponse(201, { created: true }))
      const result = await api.get('/resource')
      expect(result).toEqual({ created: true })
    })

    it('throws on 401 and removes token', async () => {
      mockRequest.mockReturnValue(makeResponse(401, {}))
      await expect(api.get('/secure')).rejects.toThrow('未授权，请重新登录')
      expect(mockRemoveStorage).toHaveBeenCalledWith('xhh_token')
      expect(mockRemoveStorage).toHaveBeenCalledWith('xhh_refresh_token')
      expect(mockNavigateTo).toHaveBeenCalledWith({ url: '/pagesUser/login/index' })
    })

    it('throws on 429 with rate limit message', async () => {
      mockRequest.mockReturnValue(makeResponse(429, {}))
      await expect(api.get('/limited')).rejects.toThrow('请求过于频繁，请稍后再试')
    })

    it('retries on 500 error', async () => {
      mockRequest
        .mockReturnValueOnce(makeResponse(500, {}))
        .mockReturnValueOnce(makeResponse(200, { ok: true }))
      const result = await api.get('/flaky')
      expect(result).toEqual({ ok: true })
      expect(mockRequest).toHaveBeenCalledTimes(2)
      expect(mockDelay).toHaveBeenCalledWith(1000)
    })

    it('throws after max retries on 500', async () => {
      mockRequest.mockReturnValue(makeResponse(500, {}))
      await expect(api.get('/down')).rejects.toThrow('服务器错误: 500')
      expect(mockRequest).toHaveBeenCalledTimes(4)
      expect(mockDelay).toHaveBeenCalledTimes(3)
    })

    it('retries on network failure (request:fail)', async () => {
      mockRequest
        .mockReturnValueOnce(makeNetworkError())
        .mockReturnValueOnce(makeResponse(200, { recovered: true }))
      const result = await api.get('/unstable')
      expect(result).toEqual({ recovered: true })
      expect(mockRequest).toHaveBeenCalledTimes(2)
      expect(mockDelay).toHaveBeenCalledWith(1000)
    })

    it('throws after max retries on network failure', async () => {
      mockRequest.mockReturnValue(makeNetworkError())
      await expect(api.get('/offline')).rejects.toThrow('网络连接失败，请检查网络设置')
      expect(mockRequest).toHaveBeenCalledTimes(4)
      expect(mockDelay).toHaveBeenCalledTimes(3)
    })

    it('throws on other error status with message from response', async () => {
      mockRequest.mockReturnValue(makeResponse(403, { message: '禁止访问' }))
      await expect(api.get('/forbidden')).rejects.toThrow('禁止访问')
    })

    it('throws on other error status with error field from response', async () => {
      mockRequest.mockReturnValue(makeResponse(422, { error: '参数校验失败' }))
      await expect(api.get('/invalid')).rejects.toThrow('参数校验失败')
    })

    it('throws on other error status with fallback message', async () => {
      mockRequest.mockReturnValue(makeResponse(403, {}))
      await expect(api.get('/denied')).rejects.toThrow('API错误: 403')
    })

    it('throws on other error status when message is not a string', async () => {
      mockRequest.mockReturnValue(makeResponse(400, { message: { code: 123 } }))
      await expect(api.get('/badmsg')).rejects.toThrow('API错误: 400')
    })

    it('deduplicates concurrent GET requests', async () => {
      let resolveFirst: (value: unknown) => void
      const firstPromise = new Promise(resolve => { resolveFirst = resolve })
      mockRequest.mockReturnValueOnce(firstPromise)

      const p1 = api.get('/same-endpoint')
      const p2 = api.get('/same-endpoint')

      resolveFirst!({ statusCode: 200, data: { dedup: true } })

      const [r1, r2] = await Promise.all([p1, p2])
      expect(r1).toEqual({ dedup: true })
      expect(r2).toEqual({ dedup: true })
      expect(mockRequest).toHaveBeenCalledTimes(1)
    })
  })

  describe('api.post', () => {
    it('makes POST request with data', async () => {
      mockRequest.mockReturnValue(makeResponse(200, { id: 1 }))
      await api.post('/items', { name: 'test' })
      expect(mockRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'POST',
          data: { name: 'test' },
        }),
      )
    })

    it('makes POST request without data', async () => {
      mockRequest.mockReturnValue(makeResponse(200, {}))
      await api.post('/action')
      expect(mockRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'POST',
          data: undefined,
        }),
      )
    })

    it('does not deduplicate POST requests', async () => {
      mockRequest.mockReturnValue(makeResponse(200, { ok: 1 }))
      const p1 = api.post('/submit', { a: 1 })
      const p2 = api.post('/submit', { a: 1 })
      await Promise.all([p1, p2])
      expect(mockRequest).toHaveBeenCalledTimes(2)
    })
  })

  describe('api.put', () => {
    it('makes PUT request with data', async () => {
      mockRequest.mockReturnValue(makeResponse(200, { updated: true }))
      await api.put('/items/1', { name: 'updated' })
      expect(mockRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'PUT',
          data: { name: 'updated' },
        }),
      )
    })

    it('makes PUT request without data', async () => {
      mockRequest.mockReturnValue(makeResponse(200, {}))
      await api.put('/items/1')
      expect(mockRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'PUT',
          data: undefined,
        }),
      )
    })
  })

  describe('api.delete', () => {
    it('makes DELETE request', async () => {
      mockRequest.mockReturnValue(makeResponse(200, { deleted: true }))
      await api.delete('/items/1')
      expect(mockRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'DELETE',
        }),
      )
    })
  })

  describe('request headers', () => {
    it('includes Content-Type application/json by default', async () => {
      mockRequest.mockReturnValue(makeResponse(200, {}))
      await api.get('/data')
      expect(mockRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          header: expect.objectContaining({
            'Content-Type': 'application/json',
          }),
        }),
      )
    })

    it('sets timeout to 15000ms', async () => {
      mockRequest.mockReturnValue(makeResponse(200, {}))
      await api.get('/data')
      expect(mockRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          timeout: 15000,
        }),
      )
    })
  })
})
