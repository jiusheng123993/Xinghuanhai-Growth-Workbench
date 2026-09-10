/**
 * POST /api/ai/chat 持久化历史集成测试（2026-09-10 发图带文字配套修复）
 *
 * 背景：旧版聊天链路此前不写 agent 持久化历史，发图轮对话退出页面即失忆，
 * 用户发图后追问（如"这是什么猫"）跨会话/重进页面无上下文。修复：回复成功后
 * 异步写入 saveConversation（user + assistant），归属校验防横向越权。
 *
 * 覆盖：
 *   1. 带 petId 且归属合法 → 写入 user（最后一条）与 assistant 各一条
 *   2. 无 petId → 不写入
 *   3. petId 非本人宠物（canAccess=false）→ 不写入（越权防线）
 *   4. LLM 调用失败 → 500 且不写入
 *
 * Mock 策略对齐 ai.photo-analyze.test.ts。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

const { mockChat, mockSaveConversation, mockCanAccess } = vi.hoisted(() => ({
  mockChat: vi.fn(),
  mockSaveConversation: vi.fn(),
  mockCanAccess: vi.fn(),
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
  uploadLimiter: (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
  aiRecognizeLimiter: (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
  namingLimiter: (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
}));

vi.mock('../middleware/auth.js', () => ({
  authMiddleware: (_req: express.Request, _res: express.Response, next: express.NextFunction) => {
    _req.userId = 'test-user-id';
    next();
  },
}));

vi.mock('../services/aiService.js', () => ({
  chat: mockChat,
  guardCheck: vi.fn(),
  guardCheckOutput: vi.fn(),
  bailianChat: vi.fn(),
  bailianASR: vi.fn(),
}));

// 持久化写入点：saveConversation 必须被 mock 以断言参数（不触真实 DB）
vi.mock('../services/memoryService.js', () => ({
  saveConversation: mockSaveConversation,
}));

vi.mock('../services/visionService.js', () => ({
  analyzeImage: vi.fn(),
  extractJsonFromText: vi.fn(),
}));

vi.mock('../services/healthReportService.js', () => ({
  recognizeHealthReport: vi.fn(),
}));

vi.mock('../repositories/petRepository.js', () => ({
  PetRepository: class {
    canAccess = mockCanAccess;
    findById = vi.fn();
    findFirstByUser = vi.fn().mockResolvedValue(null);
  },
}));

vi.mock('../repositories/petFactRepository.js', () => ({
  PetFactRepository: class {
    insertFact = vi.fn().mockResolvedValue(undefined);
  },
}));

import aiRouter from '../routes/ai.js';

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/ai', aiRouter);
  return app;
}

const REQ_MESSAGES = [
  { role: 'system', content: '系统提示词' },
  { role: 'user', content: '我上传了一张宠物照片，请帮我看看这是什么猫' },
];

beforeEach(() => {
  mockChat.mockReset().mockResolvedValue('这是一只橘猫');
  mockSaveConversation.mockReset().mockResolvedValue(undefined);
  mockCanAccess.mockReset().mockResolvedValue(true);
});

describe('POST /api/ai/chat 持久化历史（发图带文字配套）', () => {
  it('带合法 petId：写入 user（最后一条 user 消息）与 assistant 各一条', async () => {
    // fixture 含多条 user 消息：有效验证"取最后一条"而非"取首条"（审查 P2）
    const multiUserMessages = [
      { role: 'system', content: '系统提示词' },
      { role: 'user', content: '第一条历史消息（不应被写入）' },
      { role: 'assistant', content: '好的' },
      { role: 'user', content: '我上传了一张宠物照片，请帮我看看这是什么猫' },
    ];
    const res = await request(createApp())
      .post('/api/ai/chat')
      .send({ messages: multiUserMessages, petId: 'pet-1' });

    expect(res.status).toBe(200);
    // 第 1 次调用 = 主对话；后续可能还有异步特征提取的 chat() 调用，故按参数断言首次
    expect(mockChat.mock.calls[0][0]).toEqual(multiUserMessages);
    expect(mockSaveConversation).toHaveBeenCalledTimes(2);
    expect(mockSaveConversation).toHaveBeenNthCalledWith(
      1, 'test-user-id', 'pet-1', 'user', '我上传了一张宠物照片，请帮我看看这是什么猫',
    );
    expect(mockSaveConversation).toHaveBeenNthCalledWith(
      2, 'test-user-id', 'pet-1', 'assistant', '这是一只橘猫',
    );
  });

  it('发图轮传 persistUserContent：写入合并文本而非消息原文（双端去重对齐）', async () => {
    const merged = '[图片] 帮我看看这是什么猫｜视觉观察：一只橘色虎斑猫';
    const res = await request(createApp())
      .post('/api/ai/chat')
      .send({
        messages: REQ_MESSAGES,
        petId: 'pet-1',
        persistUserContent: merged,
      });

    expect(res.status).toBe(200);
    // user 条目 = persistUserContent（与前端 chatHistory 逐字一致，精确去重可命中）
    expect(mockSaveConversation).toHaveBeenNthCalledWith(
      1, 'test-user-id', 'pet-1', 'user', merged,
    );
    // assistant 条目仍写回复原文
    expect(mockSaveConversation).toHaveBeenNthCalledWith(
      2, 'test-user-id', 'pet-1', 'assistant', '这是一只橘猫',
    );
  });

  it('无 petId：不写入持久化历史', async () => {
    const res = await request(createApp())
      .post('/api/ai/chat')
      .send({ messages: REQ_MESSAGES });

    expect(res.status).toBe(200);
    expect(mockSaveConversation).not.toHaveBeenCalled();
  });

  it('petId 非本人宠物（canAccess=false）：拒绝写入（防横向越权）', async () => {
    mockCanAccess.mockResolvedValue(false);
    const res = await request(createApp())
      .post('/api/ai/chat')
      .send({ messages: REQ_MESSAGES, petId: 'pet-other' });

    expect(res.status).toBe(200);
    expect(mockCanAccess).toHaveBeenCalledWith('pet-other', 'test-user-id');
    expect(mockSaveConversation).not.toHaveBeenCalled();
  });

  it('canAccess 抛异常（如非法 uuid / DB 不可用）：仍 200 且不写入（fail-safe）', async () => {
    mockCanAccess.mockRejectedValue(new Error('invalid input syntax for type uuid'));
    const res = await request(createApp())
      .post('/api/ai/chat')
      .send({ messages: REQ_MESSAGES, petId: 'not-a-uuid' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(mockSaveConversation).not.toHaveBeenCalled();
  });

  it('LLM 调用失败：返回 500 且不写入历史', async () => {
    mockChat.mockRejectedValue(new Error('AI API error: 500 boom'));
    const res = await request(createApp())
      .post('/api/ai/chat')
      .send({ messages: REQ_MESSAGES, petId: 'pet-1' });

    expect(res.status).toBe(500);
    expect(mockSaveConversation).not.toHaveBeenCalled();
  });
});
