/**
 * 回忆时间线模块集成测试
 * 覆盖：
 *   1. POST /api/timeline/moments   - 创建回忆（成功 / 归属校验失败 / 参数校验失败 / 补记 happenedAt 透传）
 *   2. GET  /api/timeline/moments   - 查询回忆（按宠物 / 按用户）
 *   3. DELETE /api/timeline/moments/:id - 删除回忆（成功 / 非本人 / 不存在）
 *   4. POST /api/timeline/ai-describe - AI 生成照片描述（成功 / 未传照片 / 视觉未配置降级）
 *   5. POST /api/timeline/ai-polish  - AI 润色文案（成功 / 参数校验失败）
 *
 * Mock 策略：
 *   - 数据库：vi.mock('../db.js')
 *   - 配置：vi.mock('../config.js')
 *   - 认证：vi.mock('../middleware/auth.js')，注入固定 userId
 *   - 限流：vi.mock('../middleware/rateLimit.js')，替换为透传中间件（避免测试计数干扰）
 *   - AI：vi.mock visionService / aiService，返回固定文案
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

const { mockPool, mockAnalyzeImage, mockChat } = vi.hoisted(() => {
  const pool = { query: vi.fn() };
  return {
    mockPool: pool,
    mockAnalyzeImage: vi.fn(),
    mockChat: vi.fn(),
  };
});

vi.mock('../db.js', () => ({ pool: mockPool }));

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
      mock: true,
      mchId: '',
      apiV3Key: '',
      privateKey: '',
      certSerialNo: '',
      platformCertSerialNo: '',
      platformCert: '',
      notifyUrl: '',
    },
    uploadDir: './uploads',
    publicBaseUrl: '',
    allowedOrigins: [],
    qualityCheck: { apiKey: '', baseUrl: '', model: '' },
  },
}));

// 限流中间件替换为透传：测试不受 express-rate-limit 计数干扰
vi.mock('../middleware/rateLimit.js', () => ({
  chatLimiter: (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
  uploadLimiter: (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
}));

vi.mock('../middleware/auth.js', () => ({
  authMiddleware: (_req: express.Request, _res: express.Response, next: express.NextFunction) => {
    _req.userId = 'test-user-id';
    next();
  },
}));

// 视觉服务：mock analyzeImage 返回值
vi.mock('../services/visionService.js', () => ({
  analyzeImage: mockAnalyzeImage,
}));

// 文本对话服务：mock chat 返回值
vi.mock('../services/aiService.js', () => ({
  chat: mockChat,
}));

import timelineRouter from '../routes/timeline.js';

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/timeline', timelineRouter);
  return app;
}

/** Mock 回忆行（与 pet_moments 表结构对齐，含补记字段 happened_at） */
const mockMomentRow = {
  id: 'moment-001',
  user_id: 'test-user-id',
  pet_id: 'pet-001',
  type: 'memory',
  content: { petName: '青橘', petEmoji: '🐱', description: '第一次晒太阳' },
  photos: ['/uploads/moment-photos/u1/a.jpg'],
  created_at: '2026-07-31T00:00:00.000Z',
  happened_at: '2026-07-20T00:00:00.000Z',
};

beforeEach(() => {
  mockPool.query.mockReset();
  mockAnalyzeImage.mockReset();
  mockChat.mockReset();
});

// ===== 1. POST /moments - 创建回忆 =====
describe('POST /api/timeline/moments - 创建回忆', () => {
  it('成功创建（带补记日期 happenedAt）', async () => {
    // canAccess 校验通过 + 插入成功
    mockPool.query.mockResolvedValueOnce({ rows: [{ ok: true }], rowCount: 1 });
    mockPool.query.mockResolvedValueOnce({ rows: [mockMomentRow], rowCount: 1 });

    const res = await request(createApp())
      .post('/api/timeline/moments')
      .send({
        petId: 'pet-001',
        type: 'memory',
        content: { description: '第一次晒太阳' },
        photos: ['/uploads/moment-photos/u1/a.jpg'],
        happenedAt: '2026-07-20',
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.happened_at).toBe('2026-07-20T00:00:00.000Z');
    // 校验 happenedAt 被透传到 INSERT（参数数组第 7 位）
    const insertCall = mockPool.query.mock.calls.find((c) => String(c[0]).includes('INSERT INTO pet_moments'));
    expect(insertCall).toBeDefined();
    expect(insertCall![1][6]).toBe('2026-07-20');
  });

  it('不传 happenedAt 时由 COALESCE 兜底为 CURRENT_DATE（不落 NULL）', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [{ ok: true }], rowCount: 1 });
    mockPool.query.mockResolvedValueOnce({ rows: [mockMomentRow], rowCount: 1 });

    await request(createApp())
      .post('/api/timeline/moments')
      .send({ petId: 'pet-001', type: 'memory', content: { description: 'x' } });

    const insertCall = mockPool.query.mock.calls.find((c) => String(c[0]).includes('INSERT INTO pet_moments'));
    expect(insertCall).toBeDefined();
    const sql = String(insertCall![0]);
    // 显式传 NULL 会绕过 DEFAULT 落库为 NULL（导致排序/旧时光提醒回归），
    // 必须用 COALESCE 兜底；参数仍传 null，由 SQL 层转换为 CURRENT_DATE
    expect(sql).toContain('COALESCE($7::date, CURRENT_DATE)');
    expect(insertCall![1][6]).toBeNull();
  });

  it('非宠物主人返回 403', async () => {
    // canAccess 返回 false
    mockPool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const res = await request(createApp())
      .post('/api/timeline/moments')
      .send({ petId: 'pet-999', type: 'memory', content: { description: 'x' } });

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
  });

  /**
   * 多宠共同回忆（2026-09-11 新增）
   *
   * 设计要点（改动即回归）：归属写进 content.pets（JSONB），**不动表结构**；
   * 名字/物种由**服务端**从库里取，不信任客户端；任何一只无权限整体 403。
   */
  it('多宠共同回忆：content.pets 由服务端写入，名字取库里权威值', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [{ ok: true }], rowCount: 1 }); // canAccess
    mockPool.query.mockResolvedValueOnce({
      rows: [
        { id: 'pet-001', name: '烧鸡', species: 'cat' },
        { id: 'pet-002', name: '烧鸭', species: 'dog' },
      ],
      rowCount: 2,
    }); // findAccessibleByIds
    mockPool.query.mockResolvedValueOnce({ rows: [mockMomentRow], rowCount: 1 }); // INSERT

    const res = await request(createApp())
      .post('/api/timeline/moments')
      .send({
        petId: 'pet-001',
        petIds: ['pet-001', 'pet-002'],
        type: 'memory',
        content: { description: '两只一起晒太阳', petName: '客户端伪造的名字' },
      });

    expect(res.status).toBe(200);
    const insertCall = mockPool.query.mock.calls.find((c) => String(c[0]).includes('INSERT INTO pet_moments'));
    expect(insertCall).toBeDefined();
    const content = JSON.parse(String(insertCall![1][4]));
    expect(content.pets).toEqual([
      { id: 'pet-001', name: '烧鸡', emoji: '🐱' },
      { id: 'pet-002', name: '烧鸭', emoji: '🐕' },
    ]);
    // 主宠物的名字/emoji 被服务端权威值覆盖（老读取路径只认这两个字段）
    expect(content.petName).toBe('烧鸡');
    expect(content.petEmoji).toBe('🐱');
    /**
     * 落库的 pet_id 必须是主宠物（petIds[0]）—— 这条断言是"改坏了会不会变红"的兜底：
     * INSERT 参数是 [id, user_id, pet_id, type, content, photos, happened_at]，
     * 若有人改成 petIds[1] 而只断言 content，测试照样全绿（审查 Q5 指出）。
     */
    expect(insertCall![1][2]).toBe('pet-001');
  });

  it('客户端伪造的 content.pets 一律丢弃（该字段是服务端专属）', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [{ ok: true }], rowCount: 1 }); // canAccess
    mockPool.query.mockResolvedValueOnce({ rows: [{ id: 'pet-001', name: '烧鸡', species: 'cat' }], rowCount: 1 });
    mockPool.query.mockResolvedValueOnce({ rows: [mockMomentRow], rowCount: 1 }); // INSERT

    await request(createApp())
      .post('/api/timeline/moments')
      .send({
        petId: 'pet-001',
        petIds: ['pet-001'],
        type: 'memory',
        // 伪造一只根本不在自己名下的宠物标签
        content: { description: 'x', pets: [{ id: '别人的宠物', name: '伪造的名字', emoji: '🐶' }] },
      });

    const insertCall = mockPool.query.mock.calls.find((c) => String(c[0]).includes('INSERT INTO pet_moments'));
    const content = JSON.parse(String(insertCall![1][4]));
    // 只剩服务端权威生成的那一条，伪造项被丢弃
    expect(content.pets).toEqual([{ id: 'pet-001', name: '烧鸡', emoji: '🐱' }]);
  });

  it('多宠共同回忆：混入别人的宠物 → 403 且不落库', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [{ ok: true }], rowCount: 1 }); // canAccess 通过
    mockPool.query.mockResolvedValueOnce({ rows: [{ id: 'pet-001', name: '烧鸡', species: 'cat' }], rowCount: 1 }); // 只查到一只

    const res = await request(createApp())
      .post('/api/timeline/moments')
      .send({
        petId: 'pet-001',
        petIds: ['pet-001', 'pet-别人家的'],
        type: 'memory',
        content: { description: 'x' },
      });

    expect(res.status).toBe(403);
    expect(mockPool.query.mock.calls.some((c) => String(c[0]).includes('INSERT INTO pet_moments'))).toBe(false);
  });

  it('多宠去重：重复传同一只宠物只写一条标签', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [{ ok: true }], rowCount: 1 });
    mockPool.query.mockResolvedValueOnce({ rows: [{ id: 'pet-001', name: '烧鸡', species: 'cat' }], rowCount: 1 });
    mockPool.query.mockResolvedValueOnce({ rows: [mockMomentRow], rowCount: 1 });

    const res = await request(createApp())
      .post('/api/timeline/moments')
      .send({ petId: 'pet-001', petIds: ['pet-001', 'pet-001'], type: 'memory', content: { description: 'x' } });

    expect(res.status).toBe(200);
    const insertCall = mockPool.query.mock.calls.find((c) => String(c[0]).includes('INSERT INTO pet_moments'));
    const content = JSON.parse(String(insertCall![1][4]));
    expect(content.pets).toHaveLength(1);
  });

  it('petIds 里缺少主宠物时，服务端把主宠物补到第一位（content.pets 与 pet_id 必须自洽）', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [{ ok: true }], rowCount: 1 }); // canAccess
    mockPool.query.mockResolvedValueOnce({
      rows: [
        { id: 'pet-001', name: '烧鸡', species: 'cat' },
        { id: 'pet-002', name: '烧鸭', species: 'dog' },
      ],
      rowCount: 2,
    });
    mockPool.query.mockResolvedValueOnce({ rows: [mockMomentRow], rowCount: 1 });

    await request(createApp())
      .post('/api/timeline/moments')
      .send({ petId: 'pet-002', petIds: ['pet-001'], type: 'memory', content: { description: 'x' } });

    const insertCall = mockPool.query.mock.calls.find((c) => String(c[0]).includes('INSERT INTO pet_moments'));
    const content = JSON.parse(String(insertCall![1][4]));
    expect(content.pets.map((p: { id: string }) => p.id)).toEqual(['pet-002', 'pet-001']);
    expect(content.petName).toBe('烧鸭');
  });

  it('不传 petIds 时行为不变（content 原样落库，不注入 pets）', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [{ ok: true }], rowCount: 1 });
    mockPool.query.mockResolvedValueOnce({ rows: [mockMomentRow], rowCount: 1 });

    await request(createApp())
      .post('/api/timeline/moments')
      .send({ petId: 'pet-001', type: 'memory', content: { description: '只有一只' } });

    const insertCall = mockPool.query.mock.calls.find((c) => String(c[0]).includes('INSERT INTO pet_moments'));
    const content = JSON.parse(String(insertCall![1][4]));
    expect(content.pets).toBeUndefined();
    expect(content.description).toBe('只有一只');
  });

  it('缺少 petId 参数校验失败返回 400', async () => {
    const res = await request(createApp())
      .post('/api/timeline/moments')
      .send({ type: 'memory', content: { description: 'x' } });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('100001');
  });

  it('非法 happenedAt 日期校验失败返回 400', async () => {
    const res = await request(createApp())
      .post('/api/timeline/moments')
      .send({ petId: 'pet-001', type: 'memory', content: { description: 'x' }, happenedAt: 'not-a-date' });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('100001');
    expect(res.body.message).toContain('happenedAt');
  });

  it('未来 happenedAt 日期校验失败返回 400（防污染时间线排序）', async () => {
    const res = await request(createApp())
      .post('/api/timeline/moments')
      .send({ petId: 'pet-001', type: 'memory', content: { description: 'x' }, happenedAt: '2099-01-01' });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('100001');
    expect(res.body.message).toContain('未来');
  });
});

// ===== 2. GET /moments - 查询回忆 =====
describe('GET /api/timeline/moments - 查询回忆', () => {
  it('按宠物查询', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [mockMomentRow], rowCount: 1 });

    const res = await request(createApp()).get('/api/timeline/moments?pet_id=pet-001');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(1);
    // 校验排序字段为 happened_at（补记后按真实发生日期排序）
    const sql = mockPool.query.mock.calls[0][0] as string;
    expect(sql).toContain('ORDER BY happened_at DESC');
  });

  it('不带任何过滤参数时按用户查询', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const res = await request(createApp()).get('/api/timeline/moments');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('按家庭查询且非家庭成员时返回 403（防 IDOR）', async () => {
    // canAccess 校验失败（EXISTS 返回 false）
    mockPool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const res = await request(createApp()).get('/api/timeline/moments?family_id=family-999');

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
  });

  it('按家庭查询且是家庭成员时返回回忆', async () => {
    // isOwner 通过 + 查宠物 ID 列表
    mockPool.query.mockResolvedValueOnce({ rows: [{ id: 'family-001' }], rowCount: 1 });
    mockPool.query.mockResolvedValueOnce({ rows: [{ pet_id: 'pet-001' }], rowCount: 1 });
    mockPool.query.mockResolvedValueOnce({ rows: [mockMomentRow], rowCount: 1 });

    const res = await request(createApp()).get('/api/timeline/moments?family_id=family-001');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(1);
  });
});

// ===== 3. DELETE /moments/:id - 删除回忆 =====
describe('DELETE /api/timeline/moments/:id - 删除回忆', () => {
  it('删除自己的回忆成功', async () => {
    // findById 命中 + delete 成功
    mockPool.query.mockResolvedValueOnce({ rows: [mockMomentRow], rowCount: 1 });
    mockPool.query.mockResolvedValueOnce({ rowCount: 1 });

    const res = await request(createApp()).delete('/api/timeline/moments/moment-001');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.id).toBe('moment-001');
  });

  it('删除他人回忆返回 403', async () => {
    // 回忆属于其他用户
    mockPool.query.mockResolvedValueOnce({
      rows: [{ ...mockMomentRow, user_id: 'other-user' }],
      rowCount: 1,
    });

    const res = await request(createApp()).delete('/api/timeline/moments/moment-001');

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
    // 不应触发 DELETE 语句
    const deleteCall = mockPool.query.mock.calls.find((c) => String(c[0]).includes('DELETE FROM pet_moments'));
    expect(deleteCall).toBeUndefined();
  });

  it('删除不存在的回忆返回 404', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const res = await request(createApp()).delete('/api/timeline/moments/nope');

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });
});

// ===== 4. POST /ai-describe - AI 生成照片描述 =====
describe('POST /api/timeline/ai-describe - AI 生成照片描述', () => {
  it('上传照片后返回 AI 描述', async () => {
    mockAnalyzeImage.mockResolvedValueOnce('今天的阳光正好，它趴在窗边打盹。');

    const res = await request(createApp())
      .post('/api/timeline/ai-describe')
      .attach('photo', Buffer.from('fake-image-bytes'), { filename: 'pet.jpg', contentType: 'image/jpeg' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.description).toContain('阳光');
    expect(mockAnalyzeImage).toHaveBeenCalledTimes(1);
  });

  it('未上传照片返回 400', async () => {
    const res = await request(createApp()).post('/api/timeline/ai-describe');

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('视觉 key 未配置时降级返回 503', async () => {
    mockAnalyzeImage.mockResolvedValueOnce(null);

    const res = await request(createApp())
      .post('/api/timeline/ai-describe')
      .attach('photo', Buffer.from('fake-image-bytes'), { filename: 'pet.jpg', contentType: 'image/jpeg' });

    expect(res.status).toBe(503);
    expect(res.body.success).toBe(false);
  });
});

// ===== 5. POST /ai-polish - AI 润色文案 =====
describe('POST /api/timeline/ai-polish - AI 润色文案', () => {
  it('润色用户草稿', async () => {
    mockChat.mockResolvedValueOnce('今天带它去公园，它跑得可开心了。');

    const res = await request(createApp())
      .post('/api/timeline/ai-polish')
      .send({ text: '今天带它去公园玩' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.text).toContain('开心');
  });

  it('空文案参数校验失败返回 400', async () => {
    const res = await request(createApp()).post('/api/timeline/ai-polish').send({ text: '   ' });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('100001');
  });

  it('AI key 未配置时返回 503（拦截占位文案，不把提示当润色结果）', async () => {
    // aiService 无 key 时 chat 返回非空占位串，必须被识别为未配置降级
    mockChat.mockResolvedValueOnce('AI 服务暂未配置，请联系管理员设置 ARK_API_KEY（或兼容的 AI_API_KEY）环境变量。');

    const res = await request(createApp())
      .post('/api/timeline/ai-polish')
      .send({ text: '今天带它去公园玩' });

    expect(res.status).toBe(503);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toContain('暂未配置');
  });

  it('润色调用必须关闭思考模式（回归锁：思考吃光 token 预算曾致正文空串 → 生产 503）', async () => {
    mockChat.mockResolvedValueOnce('润色结果');

    const res = await request(createApp())
      .post('/api/timeline/ai-polish')
      .send({ text: '今天带它去公园玩' });

    expect(res.status).toBe(200);
    // thinking disabled 保证 max_tokens 全部给正文（与 visionService 等新服务口径一致）
    expect(mockChat).toHaveBeenCalledWith(expect.any(Array), expect.objectContaining({ thinking: 'disabled', max_tokens: 800 }));
  });
});
