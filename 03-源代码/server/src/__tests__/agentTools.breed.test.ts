/**
 * search_breed_info 工具执行器测试
 * 覆盖：品种名命中品种库 → 下发 breed_flow 动作 + breedId；未命中 → 引导文案；
 *       不传品种时回退查当前宠物档案品种再匹配。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// 用 vi.hoisted 提前造 mock（与 breeds.test.ts 同模式），供 vi.mock 工厂引用
const { mockPool, mockGetLatestBreeds } = vi.hoisted(() => {
  return {
    mockPool: { query: vi.fn() },
    mockGetLatestBreeds: vi.fn(),
  };
});

vi.mock('../db.js', () => ({ pool: mockPool }));

vi.mock('../config.js', () => ({
  config: {
    jwtSecret: 'test-jwt-secret',
    wechat: { appId: 'test-app-id', secret: 'test-secret' },
    port: 3000,
    databaseUrl: 'postgresql://localhost/test',
    ai: { apiKey: '', baseUrl: '', model: '' },
    qualityCheck: { apiKey: '', baseUrl: '', model: '' },
    seedream: { apiKey: '' },
    meshy: { apiKey: '' },
    moderate: { apiKey: '' },
    uploadDir: './uploads',
    adminToken: 'test-admin-token',
  },
}));

// 直接 mock 品种库仓库：getLatestBreeds 返回固定品种库，避免真实 DB 依赖
vi.mock('../repositories/breedRepository.js', () => ({
  BreedKnowledgeRepository: class {
    getLatestBreeds = mockGetLatestBreeds;
  },
}));

// 触发 agentTools 模块加载（registerTool 注册 search_breed_info 执行器）
import '../services/agentTools.js';
import { getToolExecutor } from '../services/toolRegistry.js';

const FIXTURE_BREEDS = {
  version: '2026-08-25.1',
  breeds: [
    { id: 'golden_retriever', name: '金毛寻回犬', species: 'dog', aliases: ['金毛', '黄金猎犬'] },
    { id: 'british_shorthair', name: '英国短毛猫', species: 'cat', aliases: ['英短', '英短猫'] },
  ],
};

beforeEach(() => {
  mockPool.query.mockReset();
  mockGetLatestBreeds.mockReset();
  mockGetLatestBreeds.mockResolvedValue({ version: FIXTURE_BREEDS.version, data: FIXTURE_BREEDS });
});

describe('search_breed_info 工具', () => {
  it('should return breed_flow action + breedId when breed matches library', async () => {
    const exec = getToolExecutor('search_breed_info');
    const result = await exec!({ breed: '英短' }, { userId: 'u1' });

    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({ action: 'breed_flow', breedId: 'british_shorthair', species: 'cat' });
    expect(result.message).toContain('英国短毛猫');
    // 命中库时不应再查宠物档案（无额外 pool 查询）
    expect(mockPool.query).not.toHaveBeenCalled();
  });

  it('should return guidance (no action) when breed not in library', async () => {
    const exec = getToolExecutor('search_breed_info');
    const result = await exec!({ breed: '不存在的品种xyz' }, { userId: 'u1' });

    expect(result.success).toBe(true);
    expect((result.data as Record<string, unknown>).action).toBeUndefined();
    expect(result.message).toContain('没在品种百科里找到');
  });

  it('should fall back to current pet breed when no breed arg provided', async () => {
    // 不传 breed 时，先用 petId 查档案品种（返回「英短」），再命中品种库
    mockPool.query.mockResolvedValue({ rows: [{ breed: '英短' }] });

    const exec = getToolExecutor('search_breed_info');
    const result = await exec!({}, { userId: 'u1', petId: 'p1' });

    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({ action: 'breed_flow', breedId: 'british_shorthair' });
  });

  it('should fail fast when no breed and no pet id', async () => {
    const exec = getToolExecutor('search_breed_info');
    const result = await exec!({}, { userId: 'u1' });

    expect(result.success).toBe(false);
    expect(result.message).toBe('请提供品种名称');
  });

  it('should degrade to guidance when breed library unavailable (getLatestBreeds null)', async () => {
    // DB 异常/表不存在 → getLatestBreeds 返回 null，应走「未命中引导」而非抛错
    mockGetLatestBreeds.mockResolvedValue(null);

    const exec = getToolExecutor('search_breed_info');
    const result = await exec!({ breed: '英短' }, { userId: 'u1' });

    expect(result.success).toBe(true);
    expect((result.data as Record<string, unknown>).action).toBeUndefined();
    expect(result.message).toContain('没在品种百科里找到');
  });
});
