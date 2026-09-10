/**
 * 聊天多会话接口集成测试（多会话改造 2026-09-10）
 *
 * 覆盖：
 *   1. GET  /api/agent/sessions        - 列出会话（camelCase 映射）
 *   2. POST /api/agent/sessions        - 新建会话 + 存量消息归并
 *   3. DELETE /api/agent/sessions/:id  - 删除会话（成功 / 归属失败 404）
 *   4. GET  /api/agent/history?sessionId - 按会话加载历史（sessionId 透传）
 *
 * Mock 策略对齐 ai.chat-persist.test.ts / memory.test.ts。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

const {
  mockCreateSession, mockListByUser, mockFindByIdAndUser, mockDeleteSession,
  mockMergeLegacyMessages, mockLoadConversationHistory,
} = vi.hoisted(() => ({
  mockCreateSession: vi.fn(),
  mockListByUser: vi.fn(),
  mockFindByIdAndUser: vi.fn(),
  mockDeleteSession: vi.fn(),
  mockMergeLegacyMessages: vi.fn(),
  mockLoadConversationHistory: vi.fn(),
}));

vi.mock('../config.js', () => ({
  config: {
    jwtSecret: 'test-jwt-secret',
    port: 3000,
    databaseUrl: 'postgresql://localhost/test',
    ai: { apiKey: '', baseUrl: '', model: '' },
    bailian: { apiKey: '', baseUrl: '', visionModel: '', asrModel: '' },
    seedream: { apiKey: '' },
    seedance: { apiKey: '', model: '' },
    meshy: { apiKey: '', baseUrl: '' },
    moderate: { apiKey: '' },
    wechat: { appId: 'test-appid', secret: '' },
    wechatPay: {
      mock: true, mchId: '', apiV3Key: '', privateKey: '',
      certSerialNo: '', platformCertSerialNo: '', platformCert: '', notifyUrl: '',
    },
    uploadDir: './uploads',
    publicBaseUrl: '',
    allowedOrigins: [],
    qualityCheck: { apiKey: '', baseUrl: '', model: '' },
  },
}));

vi.mock('../middleware/rateLimit.js', () => ({
  chatLimiter: (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
}));

vi.mock('../middleware/auth.js', () => ({
  authMiddleware: (_req: express.Request, _res: express.Response, next: express.NextFunction) => {
    _req.userId = 'test-user-id';
    next();
  },
}));

vi.mock('../services/memoryService.js', () => ({
  loadConversationHistory: mockLoadConversationHistory,
  saveConversation: vi.fn(),
}));

vi.mock('../services/agentService.js', () => ({
  agentLoop: vi.fn(),
  guardCheckInput: vi.fn(),
  preScreenRisk: vi.fn().mockReturnValue(false),
}));

// 副作用导入（注册工具）mock 掉
vi.mock('../services/agentTools.js', () => ({}));

vi.mock('../repositories/petRepository.js', () => ({
  PetRepository: class {
    canAccess = vi.fn().mockResolvedValue(true);
    findFirstByUser = vi.fn().mockResolvedValue(null);
  },
}));

vi.mock('../repositories/chatSessionRepository.js', () => ({
  ChatSessionRepository: class {
    createSession = mockCreateSession;
    listByUser = mockListByUser;
    findByIdAndUser = mockFindByIdAndUser;
    deleteSession = mockDeleteSession;
    mergeLegacyMessages = mockMergeLegacyMessages;
    touchSession = vi.fn();
    updateTitleIfDefault = vi.fn();
  },
  // 与真实实现保持一致的 camelCase 映射
  toSessionSummary: (row: any) => ({
    id: row.id,
    petId: row.pet_id,
    title: row.title,
    messageCount: Number(row.message_count),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }),
}));

import agentRouter from '../routes/agentRouter.js';

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/agent', agentRouter);
  return app;
}

const ROW = {
  id: 'session-uuid-1',
  user_id: 'test-user-id',
  pet_id: 'pet-1',
  title: '我家猫最近不吃东西',
  message_count: 4,
  created_at: '2026-09-10T00:00:00Z',
  updated_at: '2026-09-10T01:00:00Z',
  archived_at: null,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('聊天多会话接口', () => {
  it('GET /sessions：列出会话并做 camelCase 映射', async () => {
    mockListByUser.mockResolvedValue([ROW]);

    const res = await request(createApp())
      .get('/api/agent/sessions?petId=pet-1');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.sessions).toHaveLength(1);
    expect(res.body.data.sessions[0]).toEqual({
      id: 'session-uuid-1',
      petId: 'pet-1',
      title: '我家猫最近不吃东西',
      messageCount: 4,
      createdAt: '2026-09-10T00:00:00Z',
      updatedAt: '2026-09-10T01:00:00Z',
    });
    // petId 过滤透传给仓库
    expect(mockListByUser).toHaveBeenCalledWith('test-user-id', 'pet-1', 50);
  });

  it('POST /sessions：新建会话并归并存量消息', async () => {
    mockCreateSession.mockResolvedValue(ROW);
    mockMergeLegacyMessages.mockResolvedValue(undefined);

    const res = await request(createApp())
      .post('/api/agent/sessions')
      .send({ petId: 'pet-1' });

    expect(res.status).toBe(200);
    expect(res.body.data.session.id).toBe('session-uuid-1');
    expect(mockCreateSession).toHaveBeenCalledWith('test-user-id', 'pet-1');
    // 存量归并：把该宠物 session_id IS NULL 的历史消息收编进新会话
    expect(mockMergeLegacyMessages).toHaveBeenCalledWith('test-user-id', 'pet-1', 'session-uuid-1');
  });

  it('DELETE /sessions/:id：删除成功返回 success', async () => {
    mockDeleteSession.mockResolvedValue(true);

    const res = await request(createApp())
      .delete('/api/agent/sessions/session-uuid-1');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(mockDeleteSession).toHaveBeenCalledWith('session-uuid-1', 'test-user-id');
  });

  it('DELETE /sessions/:id：归属失败（他人会话/不存在）返回 404', async () => {
    mockDeleteSession.mockResolvedValue(false);

    const res = await request(createApp())
      .delete('/api/agent/sessions/session-other');

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });

  it('GET /history?sessionId：按会话加载历史（sessionId 透传 loadConversationHistory）', async () => {
    mockLoadConversationHistory.mockResolvedValue([
      { role: 'user', content: '我家猫最近不吃东西' },
      { role: 'assistant', content: '先观察精神状态' },
    ]);

    const res = await request(createApp())
      .get('/api/agent/history?sessionId=session-uuid-1&limit=20');

    expect(res.status).toBe(200);
    expect(res.body.data.history).toHaveLength(2);
    // sessionId 作为第 4 参透传
    expect(mockLoadConversationHistory).toHaveBeenCalledWith(
      'test-user-id', null, 20, 'session-uuid-1',
    );
  });

  it('GET /history 不带 sessionId：回退旧行为（按 user+pet 查）', async () => {
    mockLoadConversationHistory.mockResolvedValue([]);

    const res = await request(createApp())
      .get('/api/agent/history?petId=pet-1');

    expect(res.status).toBe(200);
    // sessionId 为 null，走旧行为
    expect(mockLoadConversationHistory).toHaveBeenCalledWith(
      'test-user-id', 'pet-1', 20, null,
    );
  });
});
