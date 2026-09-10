/**
 * 宠物仓库「可访问性」查询单元测试（2026-09-11 新增）
 *
 * 【为什么专门测这个】多宠共同回忆的权限边界只有两处代码把关：`canAccess`（单只）与
 *   `findAccessibleByIds`（多只一次查回）。它们此前**零测试覆盖** —— 因为路由测试把
 *   `pool.query` 整体 mock 掉了，把 SQL 里的归属谓词
 *   （`p.user_id = $2 OR u.user_id = $2`）整段删掉，测试依然全绿（2026-09-11 双 Agent
 *   审查 Q5 指出的最弱一环）。这里直接把 SQL 与参数钉住：删谓词、换成不校验归属的写法
 *   都会立刻变红。
 *
 * Mock 策略：mock db.js 的 pool.query，断言 SQL 片段与参数化传参（防注入）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockQuery } = vi.hoisted(() => ({
  mockQuery: vi.fn(),
}));

vi.mock('../db.js', () => ({
  pool: { query: mockQuery },
}));

import { PetRepository } from '../repositories/petRepository.js';

const repo = new PetRepository();

beforeEach(() => {
  mockQuery.mockReset();
});

describe('PetRepository.findAccessibleByIds - 多宠归属校验', () => {
  it('SQL 必须同时包含「本人所有」与「家庭成员共享」两个归属条件', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'pet-1', name: '烧鸡', species: 'cat' }], rowCount: 1 });

    await repo.findAccessibleByIds(['pet-1', 'pet-2'], 'user-1');

    const sql = mockQuery.mock.calls[0][0] as string;
    // 关键词：任一被删掉，这条断言立刻失败（这正是本次要防的回归）
    expect(sql).toContain('p.user_id = $2');
    expect(sql).toContain('u.user_id = $2');
    expect(sql).toContain('pet_family_members');
    expect(sql).toContain('pet_family_users');
  });

  it('宠物 ID 必须走 ANY($1::text[]) 参数化（数组不拼进 SQL，防注入）', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    await repo.findAccessibleByIds(['pet-1', 'pet-2'], 'user-1');

    const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('p.id = ANY($1::text[])');
    // 参数化：数组作为参数传入，而不是字符串拼接
    expect(params).toEqual([['pet-1', 'pet-2'], 'user-1']);
    expect(sql).not.toContain('pet-1');
  });

  it('空数组短路：一次库都不查（避免无意义的 ANY(空) 查询）', async () => {
    const rows = await repo.findAccessibleByIds([], 'user-1');

    expect(rows).toEqual([]);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('返回行按入参原样透传（含 name/species，供服务端写权威标签）', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        { id: 'pet-1', name: '烧鸡', species: 'cat' },
        { id: 'pet-2', name: '烧鸭', species: 'dog' },
      ],
      rowCount: 2,
    });

    const rows = await repo.findAccessibleByIds(['pet-1', 'pet-2'], 'user-1');

    expect(rows).toEqual([
      { id: 'pet-1', name: '烧鸡', species: 'cat' },
      { id: 'pet-2', name: '烧鸭', species: 'dog' },
    ]);
  });
});

describe('PetRepository.canAccess - 单只归属校验（与批量版口径必须一致）', () => {
  it('SQL 同样要求「本人所有 OR 家庭成员共享」', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ ok: true }], rowCount: 1 });

    const ok = await repo.canAccess('pet-1', 'user-1');

    expect(ok).toBe(true);
    const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('p.user_id = $2');
    expect(sql).toContain('u.user_id = $2');
    expect(params).toEqual(['pet-1', 'user-1']);
  });

  it('查不到（别人的宠物）→ false，不抛错', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    await expect(repo.canAccess('pet-of-other', 'user-1')).resolves.toBe(false);
  });
});
