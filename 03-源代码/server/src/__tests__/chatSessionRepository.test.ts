/**
 * 聊天会话仓库单元测试（多会话改造 2026-09-10）
 *
 * 覆盖：createSession / findByIdAndUser / listByUser / deleteSession（级联+归属校验）
 *       mergeLegacyMessages / touchSession / updateTitleIfDefault
 * Mock 策略：mock db.js 的 pool.query，断言 SQL 片段与参数化传参（防注入）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockQuery } = vi.hoisted(() => ({
  mockQuery: vi.fn(),
}));

vi.mock('../db.js', () => ({
  pool: { query: mockQuery },
}));

import { ChatSessionRepository, toSessionSummary } from '../repositories/chatSessionRepository.js';

const repo = new ChatSessionRepository();

const ROW = {
  id: 'session-uuid-1',
  user_id: 'user-uuid-1',
  pet_id: 'pet-1',
  title: '新的对话',
  message_count: 0,
  created_at: '2026-09-10T00:00:00Z',
  updated_at: '2026-09-10T00:00:00Z',
  archived_at: null,
};

beforeEach(() => {
  mockQuery.mockReset();
});

describe('ChatSessionRepository', () => {
  it('createSession：插入 user_id/pet_id/title 并返回完整行', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [ROW], rowCount: 1 });

    const row = await repo.createSession('user-uuid-1', 'pet-1');

    expect(row.id).toBe('session-uuid-1');
    const sql = mockQuery.mock.calls[0][0] as string;
    expect(sql).toContain('INSERT INTO chat_sessions');
    // 参数化传参：值不拼接进 SQL
    expect(mockQuery.mock.calls[0][1]).toEqual(['user-uuid-1', 'pet-1', '新的对话']);
  });

  it('findByIdAndUser：按 id + user 查询（归属校验，防横向越权）', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [ROW], rowCount: 1 });

    const row = await repo.findByIdAndUser('session-uuid-1', 'user-uuid-1');

    expect(row?.id).toBe('session-uuid-1');
    const sql = mockQuery.mock.calls[0][0] as string;
    expect(sql).toContain('id::text = $1');
    expect(sql).toContain('user_id::text = $2');
    expect(mockQuery.mock.calls[0][1]).toEqual(['session-uuid-1', 'user-uuid-1']);
  });

  it('listByUser 带 petId：按 user+pet 过滤并按 updated_at 倒序', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [ROW], rowCount: 1 });

    const rows = await repo.listByUser('user-uuid-1', 'pet-1', 50);

    expect(rows).toHaveLength(1);
    const sql = mockQuery.mock.calls[0][0] as string;
    expect(sql).toContain('user_id::text = $1');
    expect(sql).toContain('pet_id = $2');
    expect(sql).toContain('ORDER BY updated_at DESC');
    expect(sql).toContain('LIMIT $3');
  });

  it('listByUser 不带 petId：仅按 user 过滤', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [ROW], rowCount: 1 });

    await repo.listByUser('user-uuid-1', null, 50);

    const sql = mockQuery.mock.calls[0][0] as string;
    expect(sql).not.toContain('pet_id =');
  });

  it('deleteSession：归属存在时级联删消息 + 删会话', async () => {
    // 第 1 次：findByIdAndUser 查询返回会话；第 2 次：删消息；第 3 次：删会话
    mockQuery
      .mockResolvedValueOnce({ rows: [ROW], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 5 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });

    const deleted = await repo.deleteSession('session-uuid-1', 'user-uuid-1');

    expect(deleted).toBe(true);
    const calls = mockQuery.mock.calls;
    expect(calls[1][0]).toContain('DELETE FROM agent_conversations WHERE session_id = $1');
    expect(calls[2][0]).toContain('DELETE FROM chat_sessions WHERE id::text = $1');
  });

  it('deleteSession：归属不存在返回 false，不执行删除', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const deleted = await repo.deleteSession('session-x', 'user-uuid-1');

    expect(deleted).toBe(false);
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it('mergeLegacyMessages：把 session_id IS NULL 的存量消息归并到会话（pet_id 用 IS NOT DISTINCT FROM）', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 3 });

    await repo.mergeLegacyMessages('user-uuid-1', 'pet-1', 'session-uuid-1');

    const sql = mockQuery.mock.calls[0][0] as string;
    expect(sql).toContain('UPDATE agent_conversations SET session_id = $1');
    expect(sql).toContain('pet_id IS NOT DISTINCT FROM $3');
    expect(sql).toContain('session_id IS NULL');
    expect(mockQuery.mock.calls[0][1]).toEqual(['session-uuid-1', 'user-uuid-1', 'pet-1']);
  });

  it('touchSession：计数 +1 并触达 updated_at', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });

    await repo.touchSession('session-uuid-1', 1);

    const sql = mockQuery.mock.calls[0][0] as string;
    expect(sql).toContain('message_count = message_count + $2');
    expect(mockQuery.mock.calls[0][1]).toEqual(['session-uuid-1', 1]);
  });

  it('updateTitleIfDefault：仅当标题仍是默认「新的对话」时更新', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });

    await repo.updateTitleIfDefault('session-uuid-1', '我家猫最近不吃东西');

    const sql = mockQuery.mock.calls[0][0] as string;
    expect(sql).toContain("title = '新的对话'");
    expect(mockQuery.mock.calls[0][1]).toEqual(['session-uuid-1', '我家猫最近不吃东西']);
  });

  it('toSessionSummary：snake_case → camelCase 映射', () => {
    const summary = toSessionSummary(ROW);
    expect(summary).toEqual({
      id: 'session-uuid-1',
      petId: 'pet-1',
      title: '新的对话',
      messageCount: 0,
      createdAt: '2026-09-10T00:00:00Z',
      updatedAt: '2026-09-10T00:00:00Z',
    });
  });
});
