/**
 * 全家福模块集成测试
 * 覆盖：AI生成（参数校验+归属校验+业务规则）、照片列表查询、照片删除
 * 重点验证：风格白名单校验、家庭归属校验、并发生成限制、成员数校验
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
    seedream: { apiKey: 'test-seedream-key' },
    meshy: { apiKey: '' },
    wechat: { appId: '', secret: '' },
    uploadDir: './uploads',
  },
}));

vi.mock('../middleware/auth.js', () => ({
  authMiddleware: (_req: express.Request, _res: express.Response, next: express.NextFunction) => {
    _req.userId = 'test-user-id';
    next();
  },
}));

// Mock fetch for Seedream API calls
const mockFetch = vi.fn();
global.fetch = mockFetch as unknown as typeof fetch;

// Mock 转存（集成测试只验证业务链路；转存本体逻辑由 imageBadge.test.ts 单测覆盖）
vi.mock('../services/imageBadge.js', () => ({
  hostAiImage: vi.fn(async (url: string) => url),
}));

import familyPhotosRouter from '../routes/familyPhotos.js';

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/families', familyPhotosRouter);
  return app;
}

const ownershipOk = { rows: [{ '?column?': 1 }], rowCount: 1 };
const ownershipFail = { rows: [], rowCount: 0 };

const mockMembers = {
  rows: [
    // petId 用合法 UUID：schema 对 member_order 元素做 uuid 校验，测试夹具与生产格式对齐
    { petId: '11111111-1111-4111-8111-111111111101', name: '小咪', species: 'cat', breed: '英短', photoUrl: 'https://example.com/pet1.jpg' },
    { petId: '22222222-2222-4222-8222-222222222202', name: '旺财', species: 'dog', breed: '金毛', photoUrl: 'https://example.com/pet2.jpg' },
  ],
};

const mockSingleMember = {
  rows: [
    { petId: 'pet-001', name: '小咪', species: 'cat', breed: '英短', photoUrl: null },
  ],
};

const mockEmptyMembers = { rows: [], rowCount: 0 };

const mockPhoto = {
  id: 'photo-001',
  photoUrl: 'https://example.com/family-photo.png',
  photoType: 'ai_generated',
  style: 'pixar',
  memberCount: 2,
  memberNames: ['小咪', '旺财'],
  status: 'completed',
  createdAt: '2026-07-31T00:00:00.000Z',
};

const mockPhotos = { rows: [mockPhoto] };

describe('POST /api/families/:familyId/photos — 生成全家福', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('style 不在白名单应返回 400', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/families/fam-001/photos')
      .send({ style: 'invalid_style' });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('style 为空应返回 400', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/families/fam-001/photos')
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('非家庭所有者应返回 403', async () => {
    mockPool.query.mockResolvedValueOnce(ownershipFail); // isOwner check

    const app = createApp();
    const res = await request(app)
      .post('/api/families/fam-001/photos')
      .send({ style: 'pixar' });
    expect(res.status).toBe(403);
    expect(res.body.message).toContain('无权');
  });

  it('家庭无成员应返回 400', async () => {
    mockPool.query.mockResolvedValueOnce(ownershipOk);   // isOwner
    mockPool.query.mockResolvedValueOnce({ rows: [{ '?column?': 1 }] }); // hasActiveTask (no active)
    mockPool.query.mockResolvedValueOnce(mockEmptyMembers); // collectMemberPhotos

    const app = createApp();
    const res = await request(app)
      .post('/api/families/fam-001/photos')
      .send({ style: 'pixar' });
    expect(res.status).toBe(400);
    expect(res.body.message).toContain('没有宠物成员');
  });

  it('仅1位成员应返回 400', async () => {
    mockPool.query.mockResolvedValueOnce(ownershipOk);   // isOwner
    mockPool.query.mockResolvedValueOnce({ rows: [{ '?column?': 1 }] }); // hasActiveTask (no)
    mockPool.query.mockResolvedValueOnce(mockSingleMember); // collectMemberPhotos

    const app = createApp();
    const res = await request(app)
      .post('/api/families/fam-001/photos')
      .send({ style: 'pixar' });
    expect(res.status).toBe(400);
    expect(res.body.message).toContain('至少2位');
  });

  it('已有进行中任务应返回 400', async () => {
    mockPool.query.mockResolvedValueOnce(ownershipOk);   // isOwner
    mockPool.query.mockResolvedValueOnce({ rows: [{ '?column?': 1 }], rowCount: 1 }); // hasActiveTask = true

    const app = createApp();
    const res = await request(app)
      .post('/api/families/fam-001/photos')
      .send({ style: 'pixar' });
    expect(res.status).toBe(400);
    expect(res.body.message).toContain('进行中');
  });

  it('AI 生成成功应返回 200 + photoUrl', async () => {
    // isOwner
    mockPool.query.mockResolvedValueOnce(ownershipOk);
    // hasActiveTask (no active)
    mockPool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    // collectMemberPhotos
    mockPool.query.mockResolvedValueOnce(mockMembers);
    // INSERT INTO family_photos
    mockPool.query.mockResolvedValueOnce({ rowCount: 1 });
    // Seedream API success：捕获请求体，验证提示词安全
    let capturedBody: { prompt?: string; images?: string[]; watermark?: boolean } = {};
    mockFetch.mockImplementationOnce(async (_url: unknown, init?: { body?: string }) => {
      capturedBody = JSON.parse(init?.body ?? '{}');
      return {
        ok: true,
        json: async () => ({ data: [{ url: 'https://seedream.example.com/photo.png' }] }),
      };
    });
    // UPDATE family_photos SET status = 'completed'
    mockPool.query.mockResolvedValueOnce({ rowCount: 1 });

    const app = createApp();
    const res = await request(app)
      .post('/api/families/fam-001/photos')
      .send({ style: 'pixar' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.photoUrl).toBe('https://seedream.example.com/photo.png');
    expect(res.body.data.id).toBeDefined();

    // 提示词安全：不包含宠物名字（旧模板会把名字拼进 prompt），明确数量与物种
    expect(capturedBody.prompt).toBeDefined();
    expect(capturedBody.prompt).not.toContain('小咪');
    expect(capturedBody.prompt).not.toContain('旺财');
    expect(capturedBody.prompt).not.toContain('named');
    expect(capturedBody.prompt).toContain('2只');
    // 多图一致性防线：参考图 URL 必须全部传给 Seedream（四只猫不能被画成一只的保障）
    expect(capturedBody.images).toEqual([
      'https://example.com/pet1.jpg',
      'https://example.com/pet2.jpg',
    ]);
    // 必须显式关闭 Seedream 平台水印（默认 true 会带「AI生成」平台角标，样式不可控且带平台色彩）；
    // 服务端只把生成图转存到本站（不再合成自有可见角标），隐式 AIGC 元数据在落盘时写入 —— 此参数一旦回归即红灯
    expect(capturedBody.watermark).toBe(false);
  });

  it('scene + customScene 应透传进提示词并落库（route→service 链路回归锁）', async () => {
    // 回归背景：generateFamilyPhoto 曾在服务端漏传 scene（解构了却没传给 buildPrompt），
    // "选了也白选"；本用例锁住 route→service→prompt/INSERT 全链路，防止同类断裂再次发生
    mockPool.query.mockResolvedValueOnce(ownershipOk);               // isOwner
    mockPool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 }); // hasActiveTask (no)
    mockPool.query.mockResolvedValueOnce(mockMembers);               // collectMemberPhotos

    // 捕获 INSERT INTO family_photos 的 SQL 与参数，验证 scene/description 落库
    let insertSql = '';
    let insertParams: unknown[] = [];
    mockPool.query.mockImplementationOnce(async (sql: string, params?: unknown[]) => {
      insertSql = sql;
      insertParams = params ?? [];
      return { rowCount: 1 };
    });

    let capturedBody: { prompt?: string; watermark?: boolean } = {};
    mockFetch.mockImplementationOnce(async (_url: unknown, init?: { body?: string }) => {
      capturedBody = JSON.parse(init?.body ?? '{}');
      return {
        ok: true,
        json: async () => ({ data: [{ url: 'https://seedream.example.com/photo.png' }] }),
      };
    });
    mockPool.query.mockResolvedValueOnce({ rowCount: 1 });           // UPDATE status='completed'

    const app = createApp();
    const res = await request(app)
      .post('/api/families/fam-001/photos')
      .send({ style: 'pixar', scene: 'seaside', customScene: '在我家的院子里\n\n阳光很好' });
    expect(res.status).toBe(200);

    // ① 提示词包含海边日落的多维场景描写 + 清洗后的自定义描述（换行→空格、压缩空白）
    expect(capturedBody.prompt).toContain('海边日落');
    expect(capturedBody.prompt).toContain('在我家的院子里 阳光很好');
    expect(capturedBody.watermark).toBe(false);
    // ② INSERT 落库：scene 列存所选 key，description 存清洗后的自定义文本
    expect(insertSql).toContain('INSERT INTO family_photos');
    expect(insertSql).toContain('scene');
    expect(insertParams).toContain('seaside');
    expect(insertParams).toContain('在我家的院子里 阳光很好');
  });

  it('memberOrder 排位：重排成员顺序，提示词"从左到右依次是"与参考图数组同步对应', async () => {
    mockPool.query.mockResolvedValueOnce(ownershipOk);               // isOwner
    mockPool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 }); // hasActiveTask (no)
    mockPool.query.mockResolvedValueOnce(mockMembers);               // collectMemberPhotos（默认顺序：小咪→旺财）
    mockPool.query.mockResolvedValueOnce({ rowCount: 1 });           // INSERT

    let capturedBody: { prompt?: string; images?: string[] } = {};
    mockFetch.mockImplementationOnce(async (_url: unknown, init?: { body?: string }) => {
      capturedBody = JSON.parse(init?.body ?? '{}');
      return {
        ok: true,
        json: async () => ({ data: [{ url: 'https://seedream.example.com/photo.png' }] }),
      };
    });
    mockPool.query.mockResolvedValueOnce({ rowCount: 1 });           // UPDATE completed

    const app = createApp();
    // 用户把旺财排到第一位（画面最左）：名字只是 UI 沟通，发出去的是顺序化外貌列表
    // ⚠️ 键名为驼峰 memberOrder（与后端 schema 一致；zod 默认剥离未知键，发蛇形会被静默丢弃）
    const res = await request(app)
      .post('/api/families/fam-001/photos')
      .send({
        style: 'pixar',
        memberOrder: ['22222222-2222-4222-8222-222222222202', '11111111-1111-4111-8111-111111111101'],
      });
    expect(res.status).toBe(200);

    // 参考图数组顺序 = 排位顺序（模型按图序对应从左到右）
    expect(capturedBody.images).toEqual([
      'https://example.com/pet2.jpg',
      'https://example.com/pet1.jpg',
    ]);
    // 提示词按排位后的成员顺序写方位句
    expect(capturedBody.prompt).toContain('从左到右依次是：一只金毛狗狗、一只英短猫咪');
    expect(capturedBody.prompt).toContain('参考照片的顺序与画面从左到右的宠物顺序一一对应');
  });

  it('自定义场景里的宠物名自动转译为外貌指代（用户用名字说话，名字不进提示词）', async () => {
    mockPool.query.mockResolvedValueOnce(ownershipOk);
    mockPool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    mockPool.query.mockResolvedValueOnce(mockMembers);
    // 注意：INSERT 用 implementationOnce 捕获参数，不能再额外排一个 resolvedValueOnce
    // （once 队列按注册顺序消费，多排一个会把捕获槽挤到后面的角标 UPDATE 上）

    let insertParams: unknown[] = [];
    let capturedBody: { prompt?: string } = {};
    // INSERT 捕获（校验落库存用户原文）
    mockPool.query.mockImplementationOnce(async (_sql: string, params?: unknown[]) => {
      insertParams = params ?? [];
      return { rowCount: 1 };
    });
    mockFetch.mockImplementationOnce(async (_url: unknown, init?: { body?: string }) => {
      capturedBody = JSON.parse(init?.body ?? '{}');
      return {
        ok: true,
        json: async () => ({ data: [{ url: 'https://seedream.example.com/photo.png' }] }),
      };
    });
    mockPool.query.mockResolvedValueOnce({ rowCount: 1 });

    const app = createApp();
    const res = await request(app)
      .post('/api/families/fam-001/photos')
      .send({ style: 'pixar', customScene: '小咪追着旺财跑' });
    expect(res.status).toBe(200);

    // 提示词里名字→"左起第N只{品种}{物种}"指代（多只时带方位序号）
    expect(capturedBody.prompt).not.toContain('小咪');
    expect(capturedBody.prompt).not.toContain('旺财');
    expect(capturedBody.prompt).toContain('左起第一只英短猫咪追着左起第二只金毛狗狗跑');
    // 入库 description 仍存用户原文（相册给人看）
    expect(insertParams).toContain('小咪追着旺财跑');
  });

  it('参考图优先级契约：真实照片 > 全方位设定图 > 卡通头像（迁移 030）', async () => {
    // 回归背景：设定图（avatar_multiview_url）加入后必须排在卡通头像之前——
    // 四视图全身参考比单头像更能锁定宠物体型花纹；真实照片仍是最优先
    mockPool.query.mockResolvedValueOnce(ownershipOk);
    mockPool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 }); // hasActiveTask (no)
    mockPool.query.mockResolvedValueOnce(mockSingleMember);          // 1 位成员 → 后续 400，但 SELECT 已执行

    const app = createApp();
    await request(app)
      .post('/api/families/fam-001/photos')
      .send({ style: 'pixar' });

    // 捕获 collectMemberPhotos 的 SELECT，锁定 COALESCE 顺序
    const selectCall = mockPool.query.mock.calls.find((c) => String(c[0]).includes('COALESCE'));
    expect(selectCall).toBeDefined();
    expect(String(selectCall![0])).toContain(
      'COALESCE(p.avatar_photo_url, p.avatar_multiview_url, p.avatar_cartoon_url)',
    );
  });

  it('宠物名字叫「烧鸡」也不会被画成鸡（名字不进 Seedream 提示词）', async () => {

    // 回归用例：用户家猫叫「烧鸡」，旧提示词 `a 猫咪 named 烧鸡` 会被模型画成一只烤鸡
    const roastedMembers = {
      rows: [
        { petId: 'pet-001', name: '烧鸡', species: 'cat', breed: '英短', photoUrl: 'https://example.com/pet1.jpg' },
        { petId: 'pet-002', name: '烧鸡二号', species: 'cat', breed: '美短', photoUrl: 'https://example.com/pet2.jpg' },
      ],
    };
    let capturedBody: { prompt?: string; images?: string[] } = {};
    mockPool.query.mockResolvedValueOnce(ownershipOk);                    // isOwner
    mockPool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });      // hasActiveTask (no)
    mockPool.query.mockResolvedValueOnce(roastedMembers);                 // collectMemberPhotos
    mockPool.query.mockResolvedValueOnce({ rowCount: 1 });                // INSERT
    mockFetch.mockImplementationOnce(async (_url: unknown, init?: { body?: string }) => {
      capturedBody = JSON.parse(init?.body ?? '{}');
      return { ok: true, json: async () => ({ data: [{ url: 'https://seedream.example.com/photo.png' }] }) };
    });
    mockPool.query.mockResolvedValueOnce({ rowCount: 1 });                // UPDATE completed

    const app = createApp();
    const res = await request(app)
      .post('/api/families/fam-001/photos')
      .send({ style: 'pixar' });
    expect(res.status).toBe(200);

    // 「烧鸡」及一切鸡类词汇不得进入提示词；数量与物种必须明确
    expect(capturedBody.prompt).toBeDefined();
    expect(capturedBody.prompt).not.toContain('烧鸡');
    expect(capturedBody.prompt).not.toContain('chicken');
    expect(capturedBody.prompt).not.toContain('roast');
    expect(capturedBody.prompt).not.toContain('named');
    expect(capturedBody.prompt).toContain('2只猫咪');
  });

  it('所有合法风格均可走完整生成流程并返回 200', async () => {
    const styles = ['pixar', 'ghibli', 'oil', 'ink', 'nordic', 'cyberpunk'];

    for (const style of styles) {
      mockPool.query.mockReset();
      mockFetch.mockReset();
      mockPool.query.mockResolvedValueOnce(ownershipOk);                // isOwner
      mockPool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });  // hasActiveTask (no)
      mockPool.query.mockResolvedValueOnce(mockMembers);                // collectMemberPhotos
      mockPool.query.mockResolvedValueOnce({ rowCount: 1 });            // INSERT
      mockFetch.mockResolvedValueOnce({                                 // Seedream 成功
        ok: true,
        json: async () => ({ data: [{ url: 'https://seedream.example.com/photo.png' }] }),
      });
      mockPool.query.mockResolvedValueOnce({ rowCount: 1 });            // UPDATE completed

      const app = createApp();
      const res = await request(app)
        .post('/api/families/fam-001/photos')
        .send({ style });
      // 完整链路必须成功：风格校验通过 + 生成流程走通，不再依赖"恰好 500≠400"的脆弱断言
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    }
  });

  it('成员只有品牌默认头像应返回 400 + MEMBER_NO_REAL_IMAGE（不调用 Seedream）', async () => {
    // 分级场景：全家福参考图必须是"真实形象"，品牌预设/兜底头像（home-style）不是真实小猫
    const brandMembers = {
      rows: [
        { petId: 'pet-001', name: '烧鸡', species: 'cat', breed: '英短', photoUrl: 'https://api.xinghuanhai.com/uploads/avatars/home-style/cat/cat-02-british-blue.png' },
        { petId: 'pet-002', name: '奶茶', species: 'cat', breed: '美短', photoUrl: 'https://api.xinghuanhai.com/uploads/avatars/home-style/cat/cat-10-american-shorthair.png' },
      ],
    };
    mockPool.query.mockResolvedValueOnce(ownershipOk);                // isOwner
    mockPool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });  // hasActiveTask (no)
    mockPool.query.mockResolvedValueOnce(brandMembers);               // collectMemberPhotos

    const app = createApp();
    const res = await request(app)
      .post('/api/families/fam-001/photos')
      .send({ style: 'pixar' });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe('MEMBER_NO_REAL_IMAGE');
    expect(res.body.message).toContain('真实形象');
    expect(res.body.missingMembers).toHaveLength(2);
    expect(res.body.missingMembers[0].name).toBe('烧鸡');
    expect(mockFetch).not.toHaveBeenCalled();  // 未发起 Seedream 调用，不浪费配额
  });

  it('成员没有照片也没有形象应返回 400 + MEMBER_NO_REAL_IMAGE', async () => {
    const noPhotoMembers = {
      rows: [
        { petId: 'pet-001', name: '烧鸡', species: 'cat', breed: '英短', photoUrl: null },
        { petId: 'pet-002', name: '奶茶', species: 'cat', breed: '美短', photoUrl: 'https://api.xinghuanhai.com/uploads/avatars/home-style/cat/cat-01-orange-tabby.png' },
      ],
    };
    mockPool.query.mockResolvedValueOnce(ownershipOk);                // isOwner
    mockPool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });  // hasActiveTask (no)
    mockPool.query.mockResolvedValueOnce(noPhotoMembers);             // collectMemberPhotos

    const app = createApp();
    const res = await request(app)
      .post('/api/families/fam-001/photos')
      .send({ style: 'ghibli' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('MEMBER_NO_REAL_IMAGE');
    expect(res.body.missingMembers).toHaveLength(2);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe('GET /api/families/:familyId/photos — 照片列表', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('非家庭所有者应返回 403', async () => {
    mockPool.query.mockResolvedValueOnce(ownershipFail);
    const app = createApp();
    const res = await request(app).get('/api/families/fam-001/photos');
    expect(res.status).toBe(403);
  });

  it('应返回照片列表', async () => {
    mockPool.query.mockResolvedValueOnce(ownershipOk);   // isOwner
    mockPool.query.mockResolvedValueOnce(mockPhotos);     // SELECT photos

    const app = createApp();
    const res = await request(app).get('/api/families/fam-001/photos');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].id).toBe('photo-001');
  });

  it('无照片时返回空数组', async () => {
    mockPool.query.mockResolvedValueOnce(ownershipOk);
    mockPool.query.mockResolvedValueOnce({ rows: [] });

    const app = createApp();
    const res = await request(app).get('/api/families/fam-001/photos');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });
});

describe('DELETE /api/families/:familyId/photos/:photoId — 删除照片', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('非家庭所有者应返回 403', async () => {
    mockPool.query.mockResolvedValueOnce(ownershipFail);
    const app = createApp();
    const res = await request(app).delete('/api/families/fam-001/photos/photo-001');
    expect(res.status).toBe(403);
  });

  it('照片不存在应返回 404', async () => {
    mockPool.query.mockResolvedValueOnce(ownershipOk);   // isOwner
    mockPool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 }); // DELETE failed

    const app = createApp();
    const res = await request(app).delete('/api/families/fam-001/photos/photo-999');
    expect(res.status).toBe(404);
  });

  it('删除成功应返回 200', async () => {
    mockPool.query.mockResolvedValueOnce(ownershipOk);
    mockPool.query.mockResolvedValueOnce({ rows: [{ id: 'photo-001' }], rowCount: 1 });

    const app = createApp();
    const res = await request(app).delete('/api/families/fam-001/photos/photo-001');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

describe('POST /api/families/:familyId/photos/upload — 上传/保存全家福', () => {
  beforeEach(() => {
    mockPool.query.mockReset();
  });

  it('正常保存上传的全家福', async () => {
    mockPool.query.mockResolvedValueOnce(ownershipOk);
    mockPool.query.mockResolvedValueOnce({ rows: [], rowCount: 1 });

    const app = createApp();
    const res = await request(app)
      .post('/api/families/fam-001/photos/upload')
      .send({
        photoUrl: 'https://example.com/canvas-photo.png',
        photoType: 'canvas_fallback',
        memberCount: 3,
        memberNames: ['小咪', '旺财', '阿花'],
        description: 'Canvas 手动合成',
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.id).toBeDefined();
  });

  it('photoUrl 为空，返回 400', async () => {
    mockPool.query.mockResolvedValueOnce(ownershipOk);

    const app = createApp();
    const res = await request(app)
      .post('/api/families/fam-001/photos/upload')
      .send({ photoUrl: '', photoType: 'uploaded' });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('photoType 非法值，返回 400', async () => {
    mockPool.query.mockResolvedValueOnce(ownershipOk);

    const app = createApp();
    const res = await request(app)
      .post('/api/families/fam-001/photos/upload')
      .send({ photoUrl: 'https://example.com/photo.png', photoType: 'ai_generated' });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('非家庭所有者应返回 403', async () => {
    mockPool.query.mockResolvedValueOnce(ownershipFail);

    const app = createApp();
    const res = await request(app)
      .post('/api/families/fam-001/photos/upload')
      .send({ photoUrl: 'https://example.com/photo.png' });

    expect(res.status).toBe(403);
    expect(res.body.message).toContain('无权');
  });

  it('memberNames 为空数组时正常入库', async () => {
    mockPool.query.mockResolvedValueOnce(ownershipOk);
    mockPool.query.mockResolvedValueOnce({ rows: [], rowCount: 1 });

    const app = createApp();
    const res = await request(app)
      .post('/api/families/fam-001/photos/upload')
      .send({ photoUrl: 'https://example.com/photo.png', memberCount: 0, memberNames: [] });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});