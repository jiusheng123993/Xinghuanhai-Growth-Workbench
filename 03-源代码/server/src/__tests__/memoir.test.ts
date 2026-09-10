/**
 * 回忆录模块集成测试
 * 覆盖：创建任务、状态查询、列表分页、删除约束、预览获取
 * 重点验证：
 *   1. 归属校验（防越权）
 *   2. 并发检查（同一宠物同时只能有一个 pending/processing 任务）
 *   3. 照片数量按产品线差异化校验（daily 1-3 张，memorial 8-15 张）
 *   4. 会员配额校验（会员日常回忆录每月免费 3 次；非会员/纪念Vlog 需付费）
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

const { mockPool } = vi.hoisted(() => {
  const pool = { query: vi.fn() };
  return { mockPool: pool };
});

vi.mock('../db.js', () => ({ pool: mockPool }));

vi.mock('../config.js', () => ({
  config: {
    jwtSecret: 'test-jwt-secret',
    port: 3000,
    databaseUrl: 'postgresql://localhost/test',
    ai: { apiKey: '', baseUrl: '', model: '' },
    seedream: { apiKey: '' },
    meshy: { apiKey: '' },
    moderate: { apiKey: '' },
    wechat: { appId: '', secret: '' },
    wechatPay: { mock: true }, // 审查⏳3：refundMemoirOrder 退款走 mock 分支，不发真实微信支付请求
    uploadDir: './uploads',
  },
  // 2026-09-09 三档定价体系常量（config 真实导出，测试锁同一份值）
  MEMOIR_TIER_CONFIG: {
    light: { minPhotos: 1, maxPhotos: 3, minDuration: 5, maxDuration: 30, defaultDuration: 20 },
    standard: { minPhotos: 5, maxPhotos: 7, minDuration: 40, maxDuration: 50, defaultDuration: 45 },
    full: { minPhotos: 8, maxPhotos: 15, minDuration: 60, maxDuration: 90, defaultDuration: 75 },
  },
  MEMOIR_TIER_LABELS: { light: '轻纪念', standard: '标准回忆录', full: '完整回忆录' },
  MEMOIR_TIER_PRICES: {
    light: { member: 1890, free: 2590 },
    standard: { member: 4500, free: 5900 },
    full: { member: 7900, free: 9900 },
  },
}));

vi.mock('../middleware/auth.js', () => ({
  authMiddleware: (_req: express.Request, _res: express.Response, next: express.NextFunction) => {
    _req.userId = 'test-user-id';
    next();
  },
}));

// prompt-preview 测试：隔离 LLM/视觉/记忆（2026-09-09 提示词人机协同），避免真实调用与成本
vi.mock('../services/memoirScriptService.js', () => ({
  generateMemoirScript: vi.fn(),
}));
vi.mock('../services/memoirPhotoAnalysis.js', () => ({
  analyzeMemoirPhotos: vi.fn(),
}));
vi.mock('../services/memoryService.js', () => ({
  buildMemoryContext: vi.fn(),
  getMemoriesByTags: vi.fn(),
  getMomentSummariesByIds: vi.fn(),
}));
vi.mock('../services/aiService.js', () => ({
  chat: vi.fn(),
}));

import memoirRouter from '../routes/memoir.js';
import * as memoirScriptService from '../services/memoirScriptService.js';
import * as memoirPhotoAnalysis from '../services/memoirPhotoAnalysis.js';
import * as memoryService from '../services/memoryService.js';
import * as aiService from '../services/aiService.js';

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/pets', memoirRouter);
  return app;
}

/** 生成指定数量的有效照片 URL
 * 2026-09 审查 SSRF 白名单修复后：source_photos 仅接受本站 /uploads/ 路径或本站域名 URL，
 * 测试夹具同步改为本站相对路径（与真实前端上传后的取值一致） */
function makePhotos(count: number): string[] {
  return Array.from({ length: count }, (_, i) => `/uploads/pet-photos/test-user/pet-1/photo${i + 1}.jpg`);
}

const mockMemoirRecord = {
  id: 'memoir-001',
  user_id: 'test-user-id',
  pet_id: 'pet-001',
  memoir_type: 'daily',
  status: 'pending',
  source_photos: makePhotos(2),
  source_text: null,
  narrative_structure: { music_style: 'warm', duration: 15, style_preset: null },
  video_url: null,
  preview_url: null,
  cost_credits: null,
  payment_id: null,
  error_message: null,
  created_at: '2026-07-30T00:00:00.000Z',
  completed_at: null,
};

const mockCompletedRecord = {
  ...mockMemoirRecord,
  id: 'memoir-002',
  status: 'completed',
  video_url: 'https://example.com/video.mp4',
  preview_url: 'https://example.com/preview.mp4',
  completed_at: '2026-07-30T01:00:00.000Z',
};

const mockProcessingRecord = {
  ...mockMemoirRecord,
  id: 'memoir-003',
  status: 'processing',
};

/** 会员状态查询结果（有效会员） */
const activeMemberRow = {
  tier: 'member',
  status: 'active',
  expires_at: null,
};

beforeEach(() => {
  mockPool.query.mockReset();
});

// ===== POST /api/pets/:petId/memoir - 创建回忆录 =====
describe('POST /api/pets/:petId/memoir - 创建回忆录', () => {
  it('会员创建轻纪念档任务返回 402（会员价 18.9 元——2026-09-09 免费配额已废除）', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ ok: true }], rowCount: 1 })   // ownership OK
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })                     // no active task
      .mockResolvedValueOnce({ rows: [activeMemberRow], rowCount: 1 });     // membership: active member

    const res = await request(createApp())
      .post('/api/pets/pet-001/memoir')
      .send({
        memoir_type: 'daily',
        source_photos: makePhotos(2),
      });

    expect(res.status).toBe(402);
    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe('PAYMENT_REQUIRED');
    expect(res.body.price).toBe(1890);
    expect(res.body.message).toContain('18.9');
  });

  it('缺少 memoir_type 返回 400', async () => {
    const res = await request(createApp())
      .post('/api/pets/pet-001/memoir')
      .send({ source_photos: makePhotos(2) });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('轻纪念档照片超过3张返回 400', async () => {
    const res = await request(createApp())
      .post('/api/pets/pet-001/memoir')
      .send({ memoir_type: 'daily', source_photos: makePhotos(4) });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toContain('照片数量需 1-3 张');
  });

  it('日常回忆录照片为0张返回 400', async () => {
    const res = await request(createApp())
      .post('/api/pets/pet-001/memoir')
      .send({ memoir_type: 'daily', source_photos: [] });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('source_photos 外部域 URL 被 SSRF 白名单拒绝（2026-09 审查 P1 回归锁）', async () => {
    // source_photos 会交给服务端 fetch 下载并交给视觉 LLM，外部域/内网地址必须拦截
    const res = await request(createApp())
      .post('/api/pets/pet-001/memoir')
      .send({ memoir_type: 'daily', source_photos: ['https://example.com/photo1.jpg'] });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toContain('不受信任');
  });

  it('source_photos 内网地址被 SSRF 白名单拒绝（2026-09 审查 P1 回归锁）', async () => {
    const res = await request(createApp())
      .post('/api/pets/pet-001/memoir')
      .send({ memoir_type: 'daily', source_photos: ['http://169.254.169.254/latest/meta-data'] });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('完整回忆录档照片不足8张返回 400', async () => {
    const res = await request(createApp())
      .post('/api/pets/pet-001/memoir')
      .send({ memoir_type: 'memorial', source_photos: makePhotos(7) });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toContain('照片数量需 8-15 张');
  });

  it('完整回忆录档照片超过15张返回 400', async () => {
    const res = await request(createApp())
      .post('/api/pets/pet-001/memoir')
      .send({ memoir_type: 'memorial', source_photos: makePhotos(16) });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toContain('照片数量需 8-15 张');
  });

  it('标准回忆录档照片4张返回 400（档位边界 5-7）', async () => {
    const res = await request(createApp())
      .post('/api/pets/pet-001/memoir')
      .send({ memoir_type: 'daily', tier: 'standard', source_photos: makePhotos(4) });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toContain('照片数量需 5-7 张');
  });

  it('标准回忆录档照片5张返回 402（档位校验通过进入付费，会员价 45 元）', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ ok: true }], rowCount: 1 })   // ownership OK
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })                     // no active task
      .mockResolvedValueOnce({ rows: [activeMemberRow], rowCount: 1 });     // membership: active member

    const res = await request(createApp())
      .post('/api/pets/pet-001/memoir')
      .send({ memoir_type: 'daily', tier: 'standard', source_photos: makePhotos(5) });

    expect(res.status).toBe(402);
    expect(res.body.code).toBe('PAYMENT_REQUIRED');
    expect(res.body.price).toBe(4500);
    expect(res.body.message).toContain('45');
  });

  it('宠物不属于当前用户返回 404', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 }); // ownership fails

    const res = await request(createApp())
      .post('/api/pets/pet-001/memoir')
      .send({ memoir_type: 'daily', source_photos: makePhotos(2) });

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toBe('宠物不存在');
  });

  it('已有 pending/processing 任务返回 409', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ ok: true }], rowCount: 1 })   // ownership OK
      .mockResolvedValueOnce({ rows: [mockProcessingRecord], rowCount: 1 }); // active task exists

    const res = await request(createApp())
      .post('/api/pets/pet-001/memoir')
      .send({ memoir_type: 'daily', source_photos: makePhotos(2) });

    expect(res.status).toBe(409);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toContain('正在进行');
    expect(res.body.code).toBe('CONCURRENT_TASK');
  });

  it('非会员创建轻纪念档返回 402（非会员价 25.9 元）', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ ok: true }], rowCount: 1 })  // ownership OK
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })                    // no active task
      .mockResolvedValueOnce({ rows: [], rowCount: 0 });                   // membership: not found → free

    const res = await request(createApp())
      .post('/api/pets/pet-001/memoir')
      .send({ memoir_type: 'daily', source_photos: makePhotos(2) });

    expect(res.status).toBe(402);
    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe('PAYMENT_REQUIRED');
    expect(res.body.price).toBe(2590);
    expect(res.body.message).toContain('25.9');
  });

  it('会员创建完整回忆录档返回 402（会员价 79 元）', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ ok: true }], rowCount: 1 })   // ownership OK
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })                     // no active task
      .mockResolvedValueOnce({ rows: [activeMemberRow], rowCount: 1 });     // membership: active member

    const res = await request(createApp())
      .post('/api/pets/pet-001/memoir')
      .send({ memoir_type: 'memorial', source_photos: makePhotos(10) });

    expect(res.status).toBe(402);
    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe('PAYMENT_REQUIRED');
    expect(res.body.price).toBe(7900);
    expect(res.body.message).toContain('79');
  });

  it('非会员创建完整回忆录档返回 402（非会员价 99 元）', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ ok: true }], rowCount: 1 })  // ownership OK
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })                    // no active task
      .mockResolvedValueOnce({ rows: [], rowCount: 0 });                   // membership: not found → free

    const res = await request(createApp())
      .post('/api/pets/pet-001/memoir')
      .send({ memoir_type: 'memorial', source_photos: makePhotos(10) });

    expect(res.status).toBe(402);
    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe('PAYMENT_REQUIRED');
    expect(res.body.price).toBe(9900);
    expect(res.body.message).toContain('99');
  });

  it('会员过期视为非会员，轻纪念档返回 402（非会员价）', async () => {
    const expiredMemberRow = {
      tier: 'member',
      status: 'active',
      expires_at: '2020-01-01T00:00:00.000Z', // 已过期
    };
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ ok: true }], rowCount: 1 })  // ownership OK
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })                    // no active task
      .mockResolvedValueOnce({ rows: [expiredMemberRow], rowCount: 1 });   // membership: expired

    const res = await request(createApp())
      .post('/api/pets/pet-001/memoir')
      .send({ memoir_type: 'daily', source_photos: makePhotos(2) });

    expect(res.status).toBe(402);
    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe('PAYMENT_REQUIRED');
    expect(res.body.price).toBe(2590);
  });

  it('数据库异常返回 500', async () => {
    mockPool.query.mockRejectedValueOnce(new Error('DB error')); // ownership throws

    const res = await request(createApp())
      .post('/api/pets/pet-001/memoir')
      .send({ memoir_type: 'daily', source_photos: makePhotos(2) });

    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
  });

  it('时长超出轻纪念档范围（5-30秒）返回 400', async () => {
    const res = await request(createApp())
      .post('/api/pets/pet-001/memoir')
      .send({ memoir_type: 'daily', source_photos: makePhotos(2), duration: 60 });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toContain('时长需 5-30 秒');
  });

  it('时长超出纪念Vlog范围（60-90秒）返回 400', async () => {
    const res = await request(createApp())
      .post('/api/pets/pet-001/memoir')
      .send({ memoir_type: 'memorial', source_photos: makePhotos(10), duration: 30 });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toContain('时长需 60-90 秒');
  });
});

// ===== GET /api/pets/:petId/memoir/status - 查询状态 =====
describe('GET /api/pets/:petId/memoir/status - 查询状态', () => {
  it('正常返回最新任务状态', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ ok: true }], rowCount: 1 })   // ownership OK
      .mockResolvedValueOnce({ rows: [mockMemoirRecord], rowCount: 1 });    // findLatestByPetId

    const res = await request(createApp())
      .get('/api/pets/pet-001/memoir/status');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe('pending');
    expect(res.body.data.id).toBe('memoir-001');
  });

  it('无任务返回 404', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ ok: true }], rowCount: 1 })  // ownership OK
      .mockResolvedValueOnce({ rows: [], rowCount: 0 });                   // no task found

    const res = await request(createApp())
      .get('/api/pets/pet-001/memoir/status');

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toContain('暂无');
  });

  it('宠物不属于当前用户返回 404', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 }); // ownership fails

    const res = await request(createApp())
      .get('/api/pets/pet-001/memoir/status');

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toBe('宠物不存在');
  });
});

// ===== GET /api/pets/:petId/memoir/list - 获取列表 =====
describe('GET /api/pets/:petId/memoir/list - 获取列表', () => {
  it('正常返回列表', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ ok: true }], rowCount: 1 })      // ownership OK
      .mockResolvedValueOnce({ rows: [mockMemoirRecord, mockCompletedRecord], rowCount: 2 }) // findByPetId
      .mockResolvedValueOnce({ rows: [{ count: 2 }], rowCount: 1 });           // countByPetId

    const res = await request(createApp())
      .get('/api/pets/pet-001/memoir/list');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.list).toBeInstanceOf(Array);
    expect(res.body.data.list).toHaveLength(2);
    expect(res.body.data.total).toBe(2);
  });

  it('分页参数正确传递', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ ok: true }], rowCount: 1 })  // ownership OK
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })                    // findByPetId
      .mockResolvedValueOnce({ rows: [{ count: 0 }], rowCount: 1 });       // countByPetId

    await request(createApp())
      .get('/api/pets/pet-001/memoir/list?page=2&page_size=5');

    // 验证 findByPetId 的 SQL 包含 LIMIT 和 OFFSET
    const findByPetIdCall = mockPool.query.mock.calls[1];
    expect(findByPetIdCall[0]).toContain('LIMIT');
    expect(findByPetIdCall[0]).toContain('OFFSET');
    // limit=5, offset=(2-1)*5=5
    expect(findByPetIdCall[1]).toContain(5);
  });

  it('宠物不属于当前用户返回 404', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 }); // ownership fails

    const res = await request(createApp())
      .get('/api/pets/pet-001/memoir/list');

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toBe('宠物不存在');
  });
});

// ===== DELETE /api/pets/:petId/memoir/:memoirId - 删除回忆录 =====
describe('DELETE /api/pets/:petId/memoir/:memoirId - 删除回忆录', () => {
  it('正常删除已完成任务', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ ok: true }], rowCount: 1 })   // ownership OK
      .mockResolvedValueOnce({ rows: [mockCompletedRecord], rowCount: 1 })  // findByIdAndUser
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });                    // deleteById

    const res = await request(createApp())
      .delete('/api/pets/pet-001/memoir/memoir-002');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toContain('删除');
  });

  it('删除 pending 任务返回 409', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ ok: true }], rowCount: 1 })  // ownership OK
      .mockResolvedValueOnce({ rows: [mockMemoirRecord], rowCount: 1 });   // findByIdAndUser (pending)

    const res = await request(createApp())
      .delete('/api/pets/pet-001/memoir/memoir-001');

    expect(res.status).toBe(409);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toContain('不允许删除');
  });

  it('回忆录不存在返回 404', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ ok: true }], rowCount: 1 })  // ownership OK
      .mockResolvedValueOnce({ rows: [], rowCount: 0 });                   // findByIdAndUser (not found)

    const res = await request(createApp())
      .delete('/api/pets/pet-001/memoir/nonexistent');

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toBe('回忆录不存在');
  });

  it('宠物不属于当前用户返回 404', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 }); // ownership fails

    const res = await request(createApp())
      .delete('/api/pets/pet-001/memoir/memoir-001');

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toBe('宠物不存在');
  });
});

// ===== POST /api/pets/:petId/memoir/preview - 获取预览 =====
describe('POST /api/pets/:petId/memoir/preview - 获取预览', () => {
  it('正常返回 preview_url', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ ok: true }], rowCount: 1 })   // ownership OK
      .mockResolvedValueOnce({ rows: [mockCompletedRecord], rowCount: 1 }); // findByIdAndUser

    const res = await request(createApp())
      .post('/api/pets/pet-001/memoir/preview')
      .send({ memoir_id: 'memoir-002' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.preview_url).toBe('https://example.com/preview.mp4');
  });

  it('回忆录不存在返回 404', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ ok: true }], rowCount: 1 })  // ownership OK
      .mockResolvedValueOnce({ rows: [], rowCount: 0 });                   // findByIdAndUser (not found)

    const res = await request(createApp())
      .post('/api/pets/pet-001/memoir/preview')
      .send({ memoir_id: 'nonexistent' });

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toBe('回忆录不存在');
  });

  it('缺少 memoir_id 返回 400', async () => {
    const res = await request(createApp())
      .post('/api/pets/pet-001/memoir/preview')
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toContain('memoir_id');
  });
});

// ===== POST /api/pets/:petId/memoir/prompt-preview - 生成前提示词预览 =====
// 为什么单独锁这一段：预览是「支付前必经步骤」——它失败 → 前端 promptConfirmed 恒为 false
// → 支付按钮永远点不了。2026-09-11「标准档无法支付」P0 就死在这个端点：
// 照片数被按**产品线**校验（memorial 线写死完整档门槛 8-15），标准档 5-7 张必然抛错。
describe('POST /api/pets/:petId/memoir/prompt-preview - 生成前提示词预览（支付前必经）', () => {
  /** 最小可用分镜脚本：预览端点只负责把它回给前端，内容不参与断言 */
  const previewScript = {
    title: '测试脚本',
    theme: '陪伴',
    emotion_curve: ['calm'],
    narration_voice: 'zh_female_vv_uranus_bigtts',
    music_mood: 'warm',
    anchors: [{ id: 'pet1', type: 'pet', desc: '橘色短毛猫' }],
    segments: [
      {
        photo_index: 0,
        shot_type: 'push_in',
        camera: 'wide',
        lighting: 'golden_hour',
        transition: 'cut',
        duration_sec: 5,
        seedance_prompt: 'p',
        narration: 'n',
        subtitle: 's',
      },
    ],
  };

  beforeEach(() => {
    mockPool.query.mockReset();
    vi.mocked(memoirScriptService.generateMemoirScript).mockReset();
    vi.mocked(memoirScriptService.generateMemoirScript).mockResolvedValue(previewScript as never);
    vi.mocked(memoirPhotoAnalysis.analyzeMemoirPhotos).mockResolvedValue([] as never);
    vi.mocked(memoryService.buildMemoryContext).mockResolvedValue({ memories: '' } as never);
    vi.mocked(memoryService.getMemoriesByTags).mockResolvedValue('' as never);
    vi.mocked(memoryService.getMomentSummariesByIds).mockResolvedValue('' as never);
  });

  it('【P0 回归线】标准档 6 张能拿到预览，且分镜生成收到 tier=standard', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ ok: true }], rowCount: 1 })  // canAccess
      .mockResolvedValueOnce({ rows: [], rowCount: 0 });             // findById → 走宠物档案兜底

    const res = await request(createApp())
      .post('/api/pets/pet-001/memoir/prompt-preview')
      .send({ memoir_type: 'memorial', tier: 'standard', source_photos: makePhotos(6) });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    // 关键：确实走到了分镜生成（按产品线校验时这里会是 0 次 + 报错）
    expect(memoirScriptService.generateMemoirScript).toHaveBeenCalledTimes(1);
    const passedInput = vi.mocked(memoirScriptService.generateMemoirScript).mock.calls[0][0];
    expect(passedInput.tier).toBe('standard');
    expect(passedInput.photoCount).toBe(6);
    expect(passedInput.productLine).toBe('memorial');
  });

  it('完整档 8 张同样能预览（相邻档位不被误伤）', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ ok: true }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const res = await request(createApp())
      .post('/api/pets/pet-001/memoir/prompt-preview')
      .send({ memoir_type: 'memorial', tier: 'full', source_photos: makePhotos(8) });

    expect(res.status).toBe(200);
    const passedInput = vi.mocked(memoirScriptService.generateMemoirScript).mock.calls[0][0];
    expect(passedInput.tier).toBe('full');
  });

  it('标准档照片数越界（8 张）在路由层即返回 400，不进分镜生成', async () => {
    const res = await request(createApp())
      .post('/api/pets/pet-001/memoir/prompt-preview')
      .send({ memoir_type: 'memorial', tier: 'standard', source_photos: makePhotos(8) });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toContain('照片数量需 5-7 张');
    expect(memoirScriptService.generateMemoirScript).not.toHaveBeenCalled();
  });
});

// ===== GET /api/pets/:petId/membership - 查询会员状态（回忆录定价） =====
describe('GET /api/pets/:petId/membership - 查询会员状态', () => {
  beforeEach(() => {
    mockPool.query.mockReset();
  });

  it('会员用户返回会员价格', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ ok: true }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{
        // 过期时间必须用「动态未来 30 天」而非硬编码日期：硬编码会随真实时间流逝变成已过期会员，断言必然翻车（时间炸弹测试，2026-09 全项目复审发现）
        id: 'mem-001', tier: 'monthly', plan: 'monthly', status: 'active',
        price: 990, expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(), started_at: '2026-08-01T00:00:00Z',
      }], rowCount: 1 });

    const res = await request(createApp())
      .get('/api/pets/pet-001/membership');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.isMember).toBe(true);
    // 2026-09-09 三档价格表：{ light: {member,free}, standard: {...}, full: {...} }
    expect(res.body.data.memoirPrices).toEqual({
      light: { member: 1890, free: 2590 },
      standard: { member: 4500, free: 5900 },
      full: { member: 7900, free: 9900 },
    });
    expect(res.body.data.tier).toBe('monthly');
  });

  it('非会员用户返回三档价格表', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ ok: true }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const res = await request(createApp())
      .get('/api/pets/pet-001/membership');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.isMember).toBe(false);
    expect(res.body.data.memoirPrices.light.free).toBe(2590);
    expect(res.body.data.memoirPrices.standard.free).toBe(5900);
    expect(res.body.data.memoirPrices.full.free).toBe(9900);
    expect(res.body.data.tier).toBe('free');
  });

  it('宠物不属于当前用户，返回 404', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const res = await request(createApp())
      .get('/api/pets/other-pet/membership');

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toBe('宠物不存在');
  });

  it('会员已过期，返回非会员价格', async () => {
    const pastDate = '2024-01-01T00:00:00Z';
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ ok: true }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{
        id: 'mem-002', tier: 'monthly', plan: 'monthly', status: 'active',
        price: 990, expires_at: pastDate, started_at: '2023-12-01T00:00:00Z',
      }], rowCount: 1 });

    const res = await request(createApp())
      .get('/api/pets/pet-001/membership');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.isMember).toBe(false);
    expect(res.body.data.memoirPrices.full.free).toBe(9900);
    expect(res.body.data.status).toBe('expired');
  });
});

describe('POST /api/pets/:petId/memoir/:memoirId/confirm - 确认分镜剧本（立项 v0.2 P0-2）', () => {
  beforeEach(() => {
    mockPool.query.mockReset();
  });

  it('等待确认的任务确认成功，返回 200', async () => {
    // 第 1 次 query = canAccess 宠物归属校验（命中）；第 2 次 = confirmScript UPDATE（rowCount 1 = 确认成功）
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ ok: true }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ id: 'memoir-001' }], rowCount: 1 });

    const res = await request(createApp())
      .post('/api/pets/pet-001/memoir/memoir-001/confirm');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toContain('开始生成视频');
  });

  it('任务不在等待确认状态（已确认/已过期）返回 409', async () => {
    // confirmScript UPDATE 命中 0 行 → 服务层抛 409
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ ok: true }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const res = await request(createApp())
      .post('/api/pets/pet-001/memoir/memoir-001/confirm');

    expect(res.status).toBe(409);
    expect(res.body.success).toBe(false);
  });

  it('宠物不属于当前用户返回 404', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const res = await request(createApp())
      .post('/api/pets/other-pet/memoir/memoir-001/confirm');

    expect(res.status).toBe(404);
    expect(res.body.message).toBe('宠物不存在');
  });
});

describe('POST /api/pets/:petId/memoir/:memoirId/reject - 放弃分镜剧本（立项 v0.2 P0-2）', () => {
  beforeEach(() => {
    mockPool.query.mockReset();
  });

  it('等待确认的任务放弃成功，返回 200', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ ok: true }], rowCount: 1 })   // canAccess
      .mockResolvedValueOnce({ rows: [{ id: 'memoir-001' }], rowCount: 1 })  // rejectScript UPDATE
      .mockResolvedValueOnce({ rows: [{ id: 'memoir-001', user_id: 'user-001', payment_id: null }], rowCount: 1 }); // findById（退款守卫：无付费订单跳过）

    const res = await request(createApp())
      .post('/api/pets/pet-001/memoir/memoir-001/reject');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toContain('已放弃');
  });

  it('放弃剧本后付费单条自动退款（审查⏳3 退款闭环）', async () => {
    // 按 SQL 特征路由 mock（次序无关，避免 Once 链脆弱）：归属→放弃 UPDATE→任务→订单→CAS→审计
    mockPool.query.mockImplementation((sql: unknown) => {
      const s = String(sql);
      if (s.includes('SELECT EXISTS')) {
        return Promise.resolve({ rows: [{ ok: true }], rowCount: 1 });
      }
      if (s.includes("status = 'failed'")) {
        return Promise.resolve({ rows: [{ ok: true }], rowCount: 1 });
      }
      if (s.includes('pet_memoir_records')) {
        return Promise.resolve({
          rows: [{ id: 'memoir-001', user_id: 'user-001', payment_id: 'order-001' }],
          rowCount: 1,
        });
      }
      if (s.includes('payment_orders') && s.includes("status = 'refunded'")) {
        return Promise.resolve({ rows: [{ id: 'order-001' }], rowCount: 1 });
      }
      if (s.includes('payment_orders')) {
        return Promise.resolve({
          rows: [{ id: 'order-001', user_id: 'user-001', amount: 990, status: 'paid', product_type: 'memoir' }],
          rowCount: 1,
        });
      }
      return Promise.resolve({ rows: [], rowCount: 1 });
    });

    const res = await request(createApp())
      .post('/api/pets/pet-001/memoir/memoir-001/reject');

    expect(res.status).toBe(200);
    // 退款动作落库：CAS UPDATE ... status='refunded'
    const casCall = mockPool.query.mock.calls.find((c: unknown[]) =>
      String(c[0]).includes("status = 'refunded'"),
    );
    expect(casCall).toBeTruthy();
    // 审计落库：payment-refunded 动作（action 为参数化值，匹配 SQL+参数整体）
    const auditCall = mockPool.query.mock.calls.find((c: unknown[]) =>
      JSON.stringify(c).includes('payment-refunded'),
    );
    expect(auditCall).toBeTruthy();
  });

  it('任务不在等待确认状态返回 409', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ ok: true }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const res = await request(createApp())
      .post('/api/pets/pet-001/memoir/memoir-001/reject');

    expect(res.status).toBe(409);
    expect(res.body.success).toBe(false);
  });
});

describe('GET /api/pets/:petId/memoir/status - 剧本确认闸门字段透出（立项 v0.2 P0-2）', () => {
  beforeEach(() => {
    mockPool.query.mockReset();
  });

  it('awaiting_confirmation=true 时透传 awaiting_confirmation 与待确认 script', async () => {
    const awaitingRecord = {
      ...mockMemoirRecord,
      awaiting_confirmation: true,
      narrative_structure: {
        music_style: 'warm',
        duration: 15,
        script: { title: 'Test Script', scenes: [{ index: 1, narration: 'hello' }] },
      },
    };
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ ok: true }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [awaitingRecord], rowCount: 1 });

    const res = await request(createApp())
      .get('/api/pets/pet-001/memoir/status');

    expect(res.status).toBe(200);
    expect(res.body.data.awaiting_confirmation).toBe(true);
    expect(res.body.data.script).toEqual({
      title: 'Test Script',
      scenes: [{ index: 1, narration: 'hello' }],
    });
  });

  it('常规任务（非等待确认）不透传 script 字段', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ ok: true }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [mockCompletedRecord], rowCount: 1 });

    const res = await request(createApp())
      .get('/api/pets/pet-001/memoir/status');

    expect(res.status).toBe(200);
    expect(res.body.data.awaiting_confirmation).toBe(false);
    expect(res.body.data.script).toBeUndefined();
  });
});

// ===== POST /api/pets/:petId/memoir/prompt-preview - 生成前提示词预览 =====
describe('POST /api/pets/:petId/memoir/prompt-preview 提示词预览', () => {
  const mockScript = {
    title: 'Test Script',
    theme: '陪伴',
    emotion_curve: ['memory', 'relief'],
    narration_voice: 'zh_female_vv_uranus_bigtts',
    music_mood: 'warm',
    segments: [
      {
        photo_index: 0,
        shot_type: 'push_in',
        camera: 'medium',
        lighting: 'soft_afternoon',
        transition: 'cut',
        duration_sec: 5,
        seedance_prompt: '一只毛茸茸的猫咪在阳光下慵懒地伸懒腰，柔和的午后光线，浅景深，电影感镜头。',
        narration: '它总在午后晒着太阳，慢慢长大。',
        subtitle: '午后的阳光',
        music_mood: 'warm',
        source: 'ai_video',
      },
    ],
  };

  beforeEach(() => {
    vi.mocked(memoirScriptService.generateMemoirScript).mockResolvedValue(mockScript as never);
    vi.mocked(memoirPhotoAnalysis.analyzeMemoirPhotos).mockResolvedValue(['阳光下的猫咪']);
    vi.mocked(memoryService.buildMemoryContext).mockResolvedValue({ memories: undefined } as never);
  });

  it('标准档 5 张照片返回 200 + 将用提示词（seedance_prompt）', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ ok: true }], rowCount: 1 })   // canAccess OK
      .mockResolvedValueOnce({                                        // petRepository.findById
        rows: [{
          id: 'pet-001', name: '可乐', species: 'cat', breed: '英短', gender: 'male',
          birth_date: '2024-01-01', notes: null, is_deceased: false,
        }],
        rowCount: 1,
      });

    const res = await request(createApp())
      .post('/api/pets/pet-001/memoir/prompt-preview')
      .send({
        memoir_type: 'memorial',
        tier: 'standard',
        source_photos: makePhotos(5),
        source_text: '这段叙事',
        music_style: 'warm',
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.segments[0].seedance_prompt).toContain('猫咪');
    expect(res.body.data.segments[0].narration).toContain('慢慢长大');
  });

  it('标准档照片 4 张（低于 5）返回 400', async () => {
    const res = await request(createApp())
      .post('/api/pets/pet-001/memoir/prompt-preview')
      .send({
        memoir_type: 'memorial',
        tier: 'standard',
        source_photos: makePhotos(4),
      });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('越权宠物返回 404', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const res = await request(createApp())
      .post('/api/pets/pet-404/memoir/prompt-preview')
      .send({
        memoir_type: 'memorial',
        tier: 'standard',
        source_photos: makePhotos(5),
      });

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });
});

// ===== POST /api/pets/:petId/memoir/prompt-refine - 提示词改写 =====
describe('POST /api/pets/:petId/memoir/prompt-refine 提示词改写', () => {
  const baseSegments = [
    {
      photo_index: 0,
      seedance_prompt: '一只橘色猫咪在阳光下伸懒腰，柔和光线。',
      narration: '它总在午后晒太阳。',
      shot_type: 'push_in',
      camera: 'medium',
      lighting: 'soft_afternoon',
      transition: 'cut',
      duration_sec: 5,
    },
  ];

  it('按用户要求改写并返回下一版提示词', async () => {
    vi.mocked(aiService.chat).mockResolvedValue(
      JSON.stringify([
        {
          photo_index: 0,
          seedance_prompt: '一只橘色猫咪在金色黄昏里伸懒腰，暖色逆光，静谧电影感。',
          narration: '它总在午后晒太阳。',
          shot_type: 'push_in',
          camera: 'medium',
          lighting: 'golden_hour',
          transition: 'cut',
          duration_sec: 5,
        },
      ]),
    );

    const res = await request(createApp())
      .post('/api/pets/pet-001/memoir/prompt-refine')
      .send({ segments: baseSegments, user_request: '氛围更温馨一点，改成黄昏光线' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data[0].seedance_prompt).toContain('黄昏');
    expect(res.body.data[0].lighting).toBe('golden_hour');
    // 安全红线校验：改写后提示词不含宠物名（本用例名字未注入，但锁结构）
    expect(res.body.data[0].photo_index).toBe(0);
  });

  it('缺少修改要求返回 400', async () => {
    const res = await request(createApp())
      .post('/api/pets/pet-001/memoir/prompt-refine')
      .send({ segments: baseSegments });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('LLM 返回非 JSON 时兜底返回原段', async () => {
    vi.mocked(aiService.chat).mockResolvedValue('抱歉我无法处理');

    const res = await request(createApp())
      .post('/api/pets/pet-001/memoir/prompt-refine')
      .send({ segments: baseSegments, user_request: '更温馨' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual(baseSegments);
  });
});

// ===== POST /api/pets/:petId/memoir/prompt-confirm - 提示词确认留存 =====
describe('POST /api/pets/:petId/memoir/prompt-confirm 提示词确认留存', () => {
  // 需符合 MemoirScriptSchema（safeParse 校验，审查 P2-2）
  const script = {
    title: '测试',
    theme: '陪伴',
    emotion_curve: ['memory'],
    narration_voice: 'zh_female_vv_uranus_bigtts',
    music_mood: 'warm',
    segments: [{ photo_index: 0, shot_type: 'static_drift', camera: 'medium', lighting: 'soft_afternoon', transition: 'cut', duration_sec: 5, seedance_prompt: '一只橘色猫咪在午后阳光下静静伸懒腰，柔软光线，电影质感。', narration: '它就是这样慢慢长大的。', subtitle: '午后', music_mood: 'warm', source: 'ai_video' }],
  };

  it('用户确认最终版提示词返回 confirmed', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [{ ok: true }], rowCount: 1 });   // canAccess OK
    mockPool.query.mockResolvedValueOnce({ rows: [{ confirmed_at: new Date().toISOString() }], rowCount: 1 });

    const res = await request(createApp())
      .post('/api/pets/pet-001/memoir/prompt-confirm')
      .send({ tier: 'standard', script });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.confirmed).toBe(true);
  });

  it('越权宠物返回 404', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const res = await request(createApp())
      .post('/api/pets/pet-404/memoir/prompt-confirm')
      .send({ tier: 'standard', script });

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });

  it('缺少 tier 返回 400', async () => {
    const res = await request(createApp())
      .post('/api/pets/pet-001/memoir/prompt-confirm')
      .send({ script });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('script 结构不完整（缺 segments）返回 400（审查 P2-2）', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [{ ok: true }], rowCount: 1 });   // canAccess OK

    const res = await request(createApp())
      .post('/api/pets/pet-001/memoir/prompt-confirm')
      .send({ tier: 'standard', script: { title: 'x' } });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });
});
