/**
 * 回忆录制流程 Hook 单元测试
 *
 * 2026-09-11 事故回归：保存失败时**绝不能谎报成功**。
 * 原实现在任何失败（网络异常 / 401 / 500）下都回
 * "回忆已保存到本地 ✦ 你可以在「时光」页面查看所有回忆～"，
 * 用户以为记下了、去「时光」却什么都找不到——与"AI 说记了其实没记"是同一类信任事故。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useMemoryFlow } from '../useMemoryFlow'
import type { PetInfo } from '../../types/chatTypes'

const { mockAddMoment, mockAddAiMsg, mockSetIsTyping, mockLoggerError } = vi.hoisted(() => ({
  mockAddMoment: vi.fn(),
  mockAddAiMsg: vi.fn(),
  mockSetIsTyping: vi.fn(),
  mockLoggerError: vi.fn(),
}))

vi.mock('../../services/timelineService', () => ({
  timelineService: {
    addMoment: (...args: unknown[]) => mockAddMoment(...args),
  },
}))

// 选图：直接给一张本地临时路径（照片上传失败分支靠测试环境里 Taro.uploadFile 是空 mock 触发）
vi.mock('../../utils/privacy', () => ({
  chooseImageWithPrivacy: vi.fn(async () => ({ tempFilePaths: ['/tmp/a.jpg'] })),
}))

vi.mock('../../stores/authStore', () => ({
  useAuthStore: {
    getState: () => ({ user: { id: 'user_1' } }),
  },
}))

vi.mock('../../logger', () => ({
  logger: {
    error: (...args: unknown[]) => mockLoggerError(...args),
    warn: vi.fn(),
    info: vi.fn(),
  },
}))

const petInfo: PetInfo = {
  name: '可乐',
  emoji: '🐱',
  breed: '中华田园猫',
  age: '2月',
  hasPet: true,
  isLoading: false,
  activePet: { id: 'pet_1', name: '可乐', species: 'cat' as const } as any,
}

function renderFlow(overrides?: Partial<PetInfo>) {
  return renderHook(() =>
    useMemoryFlow({
      addAiMsg: mockAddAiMsg,
      addUserMsg: vi.fn(),
      setIsTyping: mockSetIsTyping,
      petInfo: { ...petInfo, ...overrides },
    }),
  )
}

describe('useMemoryFlow.handleMemoryRecord', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('保存成功：写入时间线并如实告知已记录', async () => {
    mockAddMoment.mockResolvedValue({ id: 'moment_1' })
    const { result } = renderFlow()

    await result.current.handleMemoryRecord('今天可乐追逗猫棒玩疯了')

    expect(mockAddMoment).toHaveBeenCalledTimes(1)
    const arg = mockAddMoment.mock.calls[0][0] as { petId: string; content: { description: string } }
    expect(arg.petId).toBe('pet_1')
    expect(arg.content.description).toBe('今天可乐追逗猫棒玩疯了')

    const msg = String(mockAddAiMsg.mock.calls[0][0])
    expect(msg).toContain('回忆已记录')
  })

  it('保存失败：如实报错，不得声称已保存（核心回归）', async () => {
    mockAddMoment.mockRejectedValue(new Error('request:fail'))
    const { result } = renderFlow()

    await act(async () => {
      await result.current.handleMemoryRecord('今天可乐追逗猫棒玩疯了')
    })

    const msg = String(mockAddAiMsg.mock.calls[0][0])
    expect(msg).not.toContain('已记录')
    expect(msg).not.toContain('已保存')
    expect(msg).toContain('没能保存')
    // 补救指引必须真的走得通：失败后重新武装录制流程，用户原样再发一次即可重试保存
    // （2026-09-11 审查 P3：原实现把流程关掉却让用户"再发一次"，那时会走 Agent，内容不会重新落库）
    expect(result.current.memoryActive).toBe(true)
    expect(mockLoggerError).toHaveBeenCalled()
  })

  it('照片上传失败：如实说明只存了文字，不谎称照片也保存了', async () => {
    mockAddMoment.mockResolvedValue({ id: 'moment_2' })
    const { result } = renderFlow()

    // 选一张照片：测试环境的 Taro.uploadFile 是空 mock → uploadMemoryPhoto 失败返回 null
    await act(async () => {
      await result.current.handleMemoryPhoto()
    })
    expect(result.current.memoryPhoto).toBe('/tmp/a.jpg')

    await result.current.handleMemoryRecord('今天可乐追逗猫棒玩疯了')

    const arg = mockAddMoment.mock.calls[0][0] as { photos: string[] }
    expect(arg.photos).toEqual([])
    const msg = String(mockAddAiMsg.mock.calls[0][0])
    expect(msg).toContain('仅文字')
    expect(msg).not.toContain('照片和文字都已保存')
  })

  it('没有活跃宠物时提示先添加宠物，不发起保存', async () => {
    const { result } = renderFlow({ activePet: null })

    await result.current.handleMemoryRecord('今天很开心')

    expect(mockAddMoment).not.toHaveBeenCalled()
    expect(String(mockAddAiMsg.mock.calls[0][0])).toContain('请先添加宠物')
  })
})
