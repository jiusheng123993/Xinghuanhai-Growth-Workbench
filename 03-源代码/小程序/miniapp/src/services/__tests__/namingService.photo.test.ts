/**
 * 取名照片链路单元测试（2026-09-10 审查 P1 补齐）
 *
 * 背景：聊天内取名"上传照片"这一步此前**必然失败**——前端 `uploadNamingPhoto` 从不传
 * `petId`，而服务端 `/api/naming/photo/upload` 强校验 petId 并做归属校验（缺失即 400），
 * 失败又被 catch 静默成"照片上传失败，我们跳过这一步继续吧～"，于是照片从未真正参与取名。
 * 该缺陷在原有测试中不可见（Hook 测试把整个 namingService mock 掉了），因此这里单独锁契约。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

import { uploadNamingPhoto, extractNamingAppearance } from '../namingService'

const { mockUploadFile, mockRequest } = vi.hoisted(() => ({
  mockUploadFile: vi.fn(),
  mockRequest: vi.fn(),
}))

vi.mock('@tarojs/taro', () => ({
  default: {
    uploadFile: (...args: unknown[]) => mockUploadFile(...args),
    request: (...args: unknown[]) => mockRequest(...args),
  },
}))
vi.mock('../../utils/storage', () => ({
  storage: { getToken: () => 'test-token' },
}))

describe('uploadNamingPhoto', () => {
  beforeEach(() => {
    mockUploadFile.mockReset()
    mockRequest.mockReset()
  })

  it('should send petId as form data when uploading', async () => {
    mockUploadFile.mockResolvedValue({
      statusCode: 200,
      data: JSON.stringify({ success: true, data: { url: '/uploads/pet-photos/u1/p1/a.jpg' } }),
    })

    const url = await uploadNamingPhoto('/tmp/a.jpg', 'p1')

    expect(url).toBe('/uploads/pet-photos/u1/p1/a.jpg')
    const call = mockUploadFile.mock.calls[0][0] as { formData?: Record<string, string>; name: string }
    // petId 是服务端归属校验的必填项，缺失即 400（本用例是这条链路的回归锁）
    expect(call.formData).toEqual({ petId: 'p1' })
    expect(call.name).toBe('photo')
  })

  it('should not call the API when petId is missing', async () => {
    const url = await uploadNamingPhoto('/tmp/a.jpg', '')

    expect(url).toBeNull()
    expect(mockUploadFile).not.toHaveBeenCalled()
  })

  it('should return null when server responds with failure', async () => {
    mockUploadFile.mockResolvedValue({
      statusCode: 400,
      data: JSON.stringify({ success: false, message: '宠物不存在或无权操作' }),
    })

    await expect(uploadNamingPhoto('/tmp/a.jpg', 'p1')).resolves.toBeNull()
  })
})

describe('extractNamingAppearance', () => {
  beforeEach(() => {
    mockRequest.mockReset()
  })

  it('should return the appearance text on success', async () => {
    mockRequest.mockResolvedValue({
      statusCode: 200,
      data: { success: true, data: { appearance: '橘白相间，圆脸，琥珀色大眼睛' } },
    })

    await expect(extractNamingAppearance('/uploads/pet-photos/u1/p1/a.jpg', 'p1')).resolves.toBe(
      '橘白相间，圆脸，琥珀色大眼睛'
    )
    // 归属校验要求：petId 必须随请求上送（服务端只放行自己宠物目录下的照片）
    const body = mockRequest.mock.calls[0][0] as { data: Record<string, unknown> }
    expect(body.data).toEqual({ photoUrl: '/uploads/pet-photos/u1/p1/a.jpg', petId: 'p1' })
  })

  it('should skip the request when photoUrl or petId is missing', async () => {
    await expect(extractNamingAppearance('', 'p1')).resolves.toBeNull()
    await expect(extractNamingAppearance('/uploads/a.jpg', '')).resolves.toBeNull()
    expect(mockRequest).not.toHaveBeenCalled()
  })

  it('should degrade to null on 502 / 401 / network error without throwing', async () => {
    // 视觉识别失败或登录过期都不应打断取名流程（调用方按"未识别"降级）
    mockRequest.mockResolvedValue({ statusCode: 502, data: { success: false } })
    await expect(extractNamingAppearance('/uploads/pet-photos/u1/p1/a.jpg', 'p1')).resolves.toBeNull()

    mockRequest.mockResolvedValue({ statusCode: 401, data: {} })
    await expect(extractNamingAppearance('/uploads/pet-photos/u1/p1/a.jpg', 'p1')).resolves.toBeNull()

    mockRequest.mockRejectedValue(new Error('network'))
    await expect(extractNamingAppearance('/uploads/pet-photos/u1/p1/a.jpg', 'p1')).resolves.toBeNull()
  })

  it('should return null when appearance is blank', async () => {
    mockRequest.mockResolvedValue({ statusCode: 200, data: { success: true, data: { appearance: '   ' } } })
    await expect(extractNamingAppearance('/uploads/pet-photos/u1/p1/a.jpg', 'p1')).resolves.toBeNull()
  })
})
