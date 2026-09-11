/**
 * useAvatar2DTask 测试
 * 验证 2D 形象生成任务 Hook 的轮询、状态管理和任务恢复
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

import { useAvatar2DTask } from '../useAvatar2DTask'
import type { GenerationTask, Avatar2DPack } from '../../types/avatarTypes'

const {
  mockGetTaskProgress,
  mockGetAvatar2DImages,
  mockIncrementPhotoGenerationCount,
} = vi.hoisted(() => ({
  mockGetTaskProgress: vi.fn(),
  mockGetAvatar2DImages: vi.fn(),
  mockIncrementPhotoGenerationCount: vi.fn(),
}))

vi.mock('@tarojs/taro', () => ({
  default: {
    showToast: vi.fn(),
    getStorageSync: vi.fn(() => ''),
  },
}))

vi.mock('../../services/avatarService', () => ({
  getTaskProgress: mockGetTaskProgress,
  getAvatar2DImages: mockGetAvatar2DImages,
  incrementPhotoGenerationCount: mockIncrementPhotoGenerationCount,
}))

const makeTask = (overrides: Partial<GenerationTask> = {}): GenerationTask => ({
  id: 'task-1',
  userId: 'user-1',
  petId: 'pet-1',
  taskType: '2d',
  status: 'pending',
  progress: 0,
  referencePhotoUrl: null,
  resultData: null,
  error: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  ...overrides,
})

describe('useAvatar2DTask', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    mockGetTaskProgress.mockResolvedValue(null)
    mockGetAvatar2DImages.mockResolvedValue({ task: null, images: [] })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('初始状态正确', () => {
    const { result } = renderHook(() => useAvatar2DTask('pet-1'))
    expect(result.current.taskId).toBeNull()
    expect(result.current.progress).toBe(0)
    expect(result.current.status).toBe('pending')
    expect(result.current.error).toBeNull()
    expect(result.current.pack).toEqual({ task: null, images: [] })
    expect(result.current.isProcessing).toBe(true)
    expect(result.current.isComplete).toBe(false)
    expect(result.current.isFailed).toBe(false)
  })

  it('startPolling 设置 taskId 并开始轮询', () => {
    const { result } = renderHook(() => useAvatar2DTask('pet-1'))
    act(() => {
      result.current.startPolling('new-task-id')
    })
    expect(result.current.taskId).toBe('new-task-id')
    expect(result.current.status).toBe('pending')
    expect(result.current.progress).toBe(0)
  })

  it('轮询检测到 completed 时更新状态', async () => {
    const completedTask = makeTask({ status: 'completed', progress: 100 })
    const pack: Avatar2DPack = { task: completedTask, images: [] }
    mockGetTaskProgress.mockResolvedValue(completedTask)
    mockGetAvatar2DImages.mockResolvedValue(pack)

    const { result } = renderHook(() => useAvatar2DTask('pet-1'))
    act(() => {
      result.current.startPolling('task-1')
    })

    await act(async () => {
      vi.advanceTimersByTime(2000)
    })

    expect(result.current.isComplete).toBe(true)
    expect(result.current.progress).toBe(100)
    expect(mockIncrementPhotoGenerationCount).toHaveBeenCalled()
  })

  it('轮询检测到 failed 时设置错误', async () => {
    const failedTask = makeTask({ status: 'failed', error: '生成失败' })
    mockGetTaskProgress.mockResolvedValue(failedTask)

    const { result } = renderHook(() => useAvatar2DTask('pet-1'))
    act(() => {
      result.current.startPolling('task-1')
    })

    await act(async () => {
      vi.advanceTimersByTime(2000)
    })

    expect(result.current.isFailed).toBe(true)
    expect(result.current.error).toBe('生成失败')
  })

  it('reset 重置状态', () => {
    const { result } = renderHook(() => useAvatar2DTask('pet-1'))
    act(() => {
      result.current.startPolling('task-1')
    })
    act(() => {
      result.current.reset()
    })
    expect(result.current.status).toBe('pending')
    expect(result.current.progress).toBe(0)
    expect(result.current.error).toBeNull()
  })

  it('restoreFromTask 恢复已有任务状态', () => {
    const existingTask = makeTask({
      id: 'existing-task',
      status: 'completed',
      progress: 100,
    })
    const pack: Avatar2DPack = { task: existingTask, images: [] }

    const { result } = renderHook(() => useAvatar2DTask('pet-1'))
    act(() => {
      result.current.restoreFromTask(existingTask, pack)
    })

    expect(result.current.taskId).toBe('existing-task')
    expect(result.current.status).toBe('completed')
    expect(result.current.progress).toBe(100)
    expect(result.current.pack).toEqual(pack)
  })

  it('restoreFromTask 对进行中任务恢复轮询', () => {
    const processingTask = makeTask({
      id: 'processing-task',
      status: 'processing',
      progress: 50,
    })

    const { result } = renderHook(() => useAvatar2DTask('pet-1'))
    act(() => {
      result.current.restoreFromTask(processingTask)
    })

    expect(result.current.taskId).toBe('processing-task')
    expect(result.current.status).toBe('pending')
    expect(result.current.isProcessing).toBe(true)
  })

  it('setTaskId 仅设置 taskId', () => {
    const { result } = renderHook(() => useAvatar2DTask('pet-1'))
    act(() => {
      result.current.setTaskId('manual-id')
    })
    expect(result.current.taskId).toBe('manual-id')
  })
})
