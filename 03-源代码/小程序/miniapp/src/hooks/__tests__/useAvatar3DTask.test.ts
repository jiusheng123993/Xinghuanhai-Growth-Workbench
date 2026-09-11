/**
 * useAvatar3DTask 测试
 * 验证 3D 形象生成任务 Hook 的轮询、状态管理和重试功能
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

import { useAvatar3DTask } from '../useAvatar3DTask'
import type { GenerationTask, Avatar3DResult } from '../../types/avatarTypes'

const {
  mockGetTaskProgress,
  mockGetAvatar3DModel,
  mockIncrement3DGenerationCount,
  mockGenerate3DAvatar,
} = vi.hoisted(() => ({
  mockGetTaskProgress: vi.fn(),
  mockGetAvatar3DModel: vi.fn(),
  mockIncrement3DGenerationCount: vi.fn(),
  mockGenerate3DAvatar: vi.fn(),
}))

vi.mock('@tarojs/taro', () => ({
  default: {
    showToast: vi.fn(),
    getStorageSync: vi.fn(() => ''),
  },
}))

vi.mock('../../services/avatarService', () => ({
  getTaskProgress: mockGetTaskProgress,
  getAvatar3DModel: mockGetAvatar3DModel,
  increment3DGenerationCount: mockIncrement3DGenerationCount,
  generate3DAvatar: mockGenerate3DAvatar,
}))

const makeTask = (overrides: Partial<GenerationTask> = {}): GenerationTask => ({
  id: 'task-3d-1',
  userId: 'user-1',
  petId: 'pet-1',
  taskType: '3d',
  status: 'pending',
  progress: 0,
  referencePhotoUrl: null,
  resultData: null,
  error: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  ...overrides,
})

describe('useAvatar3DTask', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    mockGetTaskProgress.mockResolvedValue(null)
    mockGetAvatar3DModel.mockResolvedValue({ task: null, model: null })
    mockGenerate3DAvatar.mockResolvedValue({ success: true, data: { taskId: 'new-3d-task', status: 'pending' } })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('初始状态正确', () => {
    const { result } = renderHook(() => useAvatar3DTask('pet-1'))
    expect(result.current.taskId).toBeNull()
    expect(result.current.progress).toBe(0)
    expect(result.current.status).toBe('pending')
    expect(result.current.error).toBeNull()
    expect(result.current.result).toEqual({ task: null, model: null })
    expect(result.current.isGenerating).toBe(false)
    expect(result.current.isProcessing).toBe(true)
    expect(result.current.isComplete).toBe(false)
    expect(result.current.isFailed).toBe(false)
  })

  it('startPolling 设置 taskId 和 isGenerating', () => {
    const { result } = renderHook(() => useAvatar3DTask('pet-1'))
    act(() => {
      result.current.startPolling('new-3d-task')
    })
    expect(result.current.taskId).toBe('new-3d-task')
    expect(result.current.status).toBe('pending')
    expect(result.current.isGenerating).toBe(true)
  })

  it('轮询检测到 completed 时更新状态并关闭 isGenerating', async () => {
    const completedTask = makeTask({ status: 'completed', progress: 100 })
    const modelResult: Avatar3DResult = {
      task: completedTask,
      model: { id: 'model-1', modelUrl: 'https://example.com/model.glb', thumbnailUrl: null, createdAt: new Date().toISOString() },
    }
    mockGetTaskProgress.mockResolvedValue(completedTask)
    mockGetAvatar3DModel.mockResolvedValue(modelResult)

    const { result } = renderHook(() => useAvatar3DTask('pet-1'))
    act(() => {
      result.current.startPolling('task-3d-1')
    })

    await act(async () => {
      vi.advanceTimersByTime(3000)
    })

    expect(result.current.isComplete).toBe(true)
    expect(result.current.isGenerating).toBe(false)
    expect(result.current.result.model?.modelUrl).toBe('https://example.com/model.glb')
    expect(mockIncrement3DGenerationCount).toHaveBeenCalled()
  })

  it('轮询检测到 failed 时设置错误并关闭 isGenerating', async () => {
    const failedTask = makeTask({ status: 'failed', error: '3D 生成失败' })
    mockGetTaskProgress.mockResolvedValue(failedTask)

    const { result } = renderHook(() => useAvatar3DTask('pet-1'))
    act(() => {
      result.current.startPolling('task-3d-1')
    })

    await act(async () => {
      vi.advanceTimersByTime(3000)
    })

    expect(result.current.isFailed).toBe(true)
    expect(result.current.error).toBe('3D 生成失败')
    expect(result.current.isGenerating).toBe(false)
  })

  it('reset 重置状态并关闭 isGenerating', () => {
    const { result } = renderHook(() => useAvatar3DTask('pet-1'))
    act(() => {
      result.current.startPolling('task-3d-1')
    })
    act(() => {
      result.current.reset()
    })
    expect(result.current.status).toBe('pending')
    expect(result.current.progress).toBe(0)
    expect(result.current.error).toBeNull()
    expect(result.current.isGenerating).toBe(false)
  })

  it('restoreFromTask 恢复已有任务状态', () => {
    const existingTask = makeTask({
      id: 'existing-3d-task',
      status: 'completed',
      progress: 100,
    })
    const modelResult: Avatar3DResult = {
      task: existingTask,
      model: { id: 'model-1', modelUrl: 'https://example.com/model.glb', thumbnailUrl: null, createdAt: new Date().toISOString() },
    }

    const { result } = renderHook(() => useAvatar3DTask('pet-1'))
    act(() => {
      result.current.restoreFromTask(existingTask, modelResult)
    })

    expect(result.current.taskId).toBe('existing-3d-task')
    expect(result.current.status).toBe('completed')
    expect(result.current.progress).toBe(100)
    expect(result.current.result).toEqual(modelResult)
  })

  it('restoreFromTask 对进行中任务恢复轮询并设置 isGenerating', () => {
    const processingTask = makeTask({
      id: 'processing-3d-task',
      status: 'processing',
      progress: 50,
    })

    const { result } = renderHook(() => useAvatar3DTask('pet-1'))
    act(() => {
      result.current.restoreFromTask(processingTask)
    })

    expect(result.current.taskId).toBe('processing-3d-task')
    expect(result.current.status).toBe('pending')
    expect(result.current.isProcessing).toBe(true)
    expect(result.current.isGenerating).toBe(true)
  })

  it('retry 调用 generate3DAvatar 并开始轮询', async () => {
    mockGenerate3DAvatar.mockResolvedValue({
      success: true,
      data: { taskId: 'retry-task-id', status: 'pending' },
    })

    const { result } = renderHook(() => useAvatar3DTask('pet-1'))
    await act(async () => {
      await result.current.retry('pet-1', '2d-task-id')
    })

    expect(mockGenerate3DAvatar).toHaveBeenCalledWith('pet-1', '2d-task-id')
    expect(result.current.taskId).toBe('retry-task-id')
    expect(result.current.isGenerating).toBe(true)
  })
})
