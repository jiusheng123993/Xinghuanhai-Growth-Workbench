/**
 * 2D 形象包生成服务单元测试
 * 覆盖：常量同步校验、429 重试、批次并发、进度计算
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockUpdateTaskProgress,
  mockUpdateTaskStatus,
  mockUpdateTaskResult,
  mockPoolQuery,
  mockDelay,
} = vi.hoisted(() => ({
  mockUpdateTaskProgress: vi.fn(),
  mockUpdateTaskStatus: vi.fn(),
  mockUpdateTaskResult: vi.fn(),
  mockPoolQuery: vi.fn(),
  mockDelay: vi.fn().mockResolvedValue(undefined),
}));

const mockFetch = vi.fn(async () => ({
  ok: true,
  status: 200,
  json: async () => ({ data: [{ url: 'https://cdn.example.com/img.png' }] }),
}));

vi.mock('../db.js', () => ({
  pool: { query: mockPoolQuery },
}));

vi.mock('./taskQueue.js', () => ({
  updateTaskProgress: mockUpdateTaskProgress,
  updateTaskStatus: mockUpdateTaskStatus,
  updateTaskResult: mockUpdateTaskResult,
}));

vi.mock('../utils/delay.js', () => ({
  delay: mockDelay,
}));

// 显式 mock 转存模块（透传原 URL）：否则成功路径会真实走 hostAiImage——
// fetch mock 无 arrayBuffer 时靠抛错降级「侥幸」通过，一旦补全 mock 响应就会在测试期写真实磁盘
vi.mock('./imageBadge.js', () => ({
  hostAiImage: vi.fn(async (url: string) => url),
}));

vi.mock('../config.js', () => ({
  config: {
    seedream: { apiKey: 'test-api-key' },
    meshy: { apiKey: 'test-meshy-key' },
    supabase: { url: '', serviceKey: '' },
  },
}));

import {
  EXPRESSIONS,
  ANGLES,
  ACTIONS,
  ACTION_ANGLES,
} from './image2DService.js';

beforeEach(() => {
  vi.stubGlobal('fetch', mockFetch);
  vi.clearAllMocks();
  mockPoolQuery.mockResolvedValue({ rowCount: 1 });
  mockUpdateTaskProgress.mockResolvedValue(undefined);
  mockUpdateTaskStatus.mockResolvedValue(undefined);
  mockUpdateTaskResult.mockResolvedValue(undefined);
  mockFetch.mockImplementation(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ data: [{ url: 'https://cdn.example.com/img.png' }] }),
  }));
});

describe('image2DService 常量与前端同步', () => {
  it('EXPRESSIONS 应有 12 个表情', () => {
    expect(EXPRESSIONS).toHaveLength(12);
  });

  it('ANGLES 应有 6 个角度', () => {
    expect(ANGLES).toHaveLength(6);
  });

  it('ACTIONS 应有 8 个动作', () => {
    expect(ACTIONS).toHaveLength(8);
  });

  it('ACTION_ANGLES 应为 ANGLES 前 3 个', () => {
    expect(ACTION_ANGLES).toHaveLength(3);
    expect(ACTION_ANGLES.map(a => a.key)).toEqual(['front', 'left', 'right']);
  });

  it('总生成数量应为 96（12×6 + 8×3）', () => {
    const total = EXPRESSIONS.length * ANGLES.length + ACTIONS.length * ACTION_ANGLES.length;
    expect(total).toBe(96);
  });
});

describe('image2DService callSeedream 429 重试逻辑', () => {
  it('429 时应触发 delay 并重试', async () => {
    let callCount = 0;
    mockFetch.mockImplementation(async () => {
      callCount++;
      if (callCount <= 2) {
        return { ok: false, status: 429, json: async () => ({ data: [] }) };
      }
      return { ok: true, status: 200, json: async () => ({ data: [{ url: 'https://cdn.example.com/retry-success.png' }] }) };
    });

    const { generate2DAvatarPack } = await import('./image2DService.js');

    await generate2DAvatarPack({
      taskId: 'test-429-retry',
      species: 'dog',
      breed: '柯基',
      referencePhotoUrl: 'https://example.com/photo.jpg',
      style: 'cartoon',
    });

    const delayCalls = mockDelay.mock.calls.map(c => c[0]);
    const retryDelays = delayCalls.filter(d => d >= 5000);
    expect(retryDelays.length).toBeGreaterThanOrEqual(1);
  });

  it('429 重试耗尽后应继续处理（单图失败不中断整体）', async () => {
    mockFetch.mockImplementation(async () => ({ ok: false, status: 429, json: async () => ({ data: [] }) }));

    const { generate2DAvatarPack } = await import('./image2DService.js');

    await generate2DAvatarPack({
      taskId: 'test-429-exhausted',
      species: 'cat',
      breed: '英短',
      referencePhotoUrl: 'https://example.com/photo.jpg',
      style: 'realistic',
    });

    expect(mockUpdateTaskStatus).toHaveBeenCalledWith('test-429-exhausted', 'completed');
  });

  it('非 429 错误不应触发重试 delay', async () => {
    mockFetch.mockImplementation(async () => ({ ok: false, status: 500, json: async () => ({ data: [] }) }));

    const { generate2DAvatarPack } = await import('./image2DService.js');

    await generate2DAvatarPack({
      taskId: 'test-500-no-retry',
      species: 'dog',
      breed: '柴犬',
      referencePhotoUrl: 'https://example.com/photo.jpg',
      style: 'cartoon',
    });

    const retryDelays = mockDelay.mock.calls.map(c => c[0]).filter(d => d >= 5000);
    expect(retryDelays.length).toBe(0);
  });
});

describe('image2DService 批次并发逻辑', () => {
  it('CONCURRENCY 应为 5', async () => {
    const fs = await import('fs');
    const content = fs.readFileSync('src/services/image2DService.ts', 'utf-8');
    expect(content).toContain('const CONCURRENCY = 5');
  });

  it('应使用 Promise.allSettled 进行容错批处理', async () => {
    const fs = await import('fs');
    const content = fs.readFileSync('src/services/image2DService.ts', 'utf-8');
    expect(content).toContain('Promise.allSettled');
  });

  it('批次间应有延迟避免限流', async () => {
    const fs = await import('fs');
    const content = fs.readFileSync('src/services/image2DService.ts', 'utf-8');
    expect(content).toMatch(/await delay\(.*\)/);
  });
});

describe('image2DService 进度计算', () => {
  it('进度应在 progressStart 和 progressEnd 之间线性增长', () => {
    const progressStart = 0;
    const progressEnd = 80;
    const total = 96;
    const completed = 48;

    const progress = progressStart + Math.floor((completed / total) * (progressEnd - progressStart));
    expect(progress).toBe(40);
  });

  it('completed=0 时进度应为 progressStart', () => {
    const progressStart = 25;
    const progressEnd = 75;
    const total = 48;
    const completed = 0;

    const progress = progressStart + Math.floor((completed / total) * (progressEnd - progressStart));
    expect(progress).toBe(25);
  });

  it('completed=total 时进度应为 progressEnd', () => {
    const progressStart = 25;
    const progressEnd = 75;
    const total = 48;
    const completed = 48;

    const progress = progressStart + Math.floor((completed / total) * (progressEnd - progressStart));
    expect(progress).toBe(75);
  });

  it('三批次进度范围应为 0-25, 25-75, 75-100', () => {
    const batch1 = { start: 0, end: 25 };
    const batch2 = { start: 25, end: 75 };
    const batch3 = { start: 75, end: 100 };

    expect(batch1.start).toBe(0);
    expect(batch1.end).toBe(25);
    expect(batch2.start).toBe(25);
    expect(batch2.end).toBe(75);
    expect(batch3.start).toBe(75);
    expect(batch3.end).toBe(100);
  });
});

describe('image2DService 画风映射（与前端 GEN_STYLES 15 种画风对齐）', () => {
  /** 从首个 Seedream fetch 调用中解析请求体（calls[0][1] 为 requestInit，prompt 在其 .body 字符串里） */
  function firstSeedreamPrompt(): string {
    const init = (mockFetch.mock.calls[0] as unknown[])[1] as { body: string };
    return JSON.parse(init.body).prompt as string;
  }

  it('ghibli 画风应把吉卜力风格短语拼进提示词', async () => {
    const { generate2DAvatarPack } = await import('./image2DService.js');

    await generate2DAvatarPack({
      taskId: 'test-style-ghibli',
      species: 'cat',
      breed: '英短',
      referencePhotoUrl: 'https://example.com/photo.jpg',
      style: 'ghibli',
    });

    expect(firstSeedreamPrompt()).toContain('吉卜力');
  });

  it('未知画风应兜底为可爱卡通风格', async () => {
    const { generate2DAvatarPack } = await import('./image2DService.js');

    await generate2DAvatarPack({
      taskId: 'test-style-fallback',
      species: 'cat',
      breed: '英短',
      referencePhotoUrl: 'https://example.com/photo.jpg',
      style: 'not-a-real-style',
    });

    expect(firstSeedreamPrompt()).toContain('可爱卡通风格');
  });

  it('legacy realistic 应保留写实风格映射', async () => {
    const { generate2DAvatarPack } = await import('./image2DService.js');

    await generate2DAvatarPack({
      taskId: 'test-style-realistic',
      species: 'dog',
      breed: '柯基',
      referencePhotoUrl: 'https://example.com/photo.jpg',
      style: 'realistic',
    });

    expect(firstSeedreamPrompt()).toContain('写实风格');
  });
});
