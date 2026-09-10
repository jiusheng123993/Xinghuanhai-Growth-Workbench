/**
 * 家庭周报模块集成测试
 * 覆盖：周报列表分页、最新周报、周报详情、手动生成
 * 重点验证：家庭归属校验（403）、周报不存在（404）、同周重复生成（409）、分页与年份过滤、越权防护
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

const { mockPool, mockChat } = vi.hoisted(() => {
  const pool = { query: vi.fn() };
  const chatFn = vi.fn();
  return { mockPool: pool, mockChat: chatFn };
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
    uploadDir: './uploads',
  },
}));

vi.mock('../services/aiService.js', () => ({
  chat: (...args: unknown[]) => mockChat(...args),
}));

vi.mock('../middleware/auth.js', () => ({
  authMiddleware: (_req: express.Request, _res: express.Response, next: express.NextFunction) => {
    _req.userId = 'test-user-id';
    next();
  },
}));

import weeklyReportsRouter from '../routes/weeklyReports.js';
import { config } from '../config.js';

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/families', weeklyReportsRouter);
  return app;
}

/** 模拟归属校验通过的结果（SELECT 1 FROM ... 返回） */
const ownershipOk = { rows: [{ '?column?': 1 }], rowCount: 1 };

/** 模拟归属校验失败的结果 */
const ownershipFail = { rows: [], rowCount: 0 };

/** mock 周报数据（report_data 为对象，模拟 pg JSONB 自动解析结果） */
const mockReportData = {
  health: {
    checkin_count: 0,
    avg_poop: 0,
    avg_appetite: 0,
    avg_spirit: 0,
    anomaly_count: 0,
    best_day: null,
  },
  activities: {
    symptom_checks: 0,
    food_queries: 0,
    new_moments: 0,
    new_milestones: 0,
  },
  family: {
    feed_count: 0,
    new_events: 0,
    active_pets: 0,
  },
};

/** 模拟周报记录 */
const mockReport = {
  id: 'report-001',
  family_id: 'family-001',
  week_number: 31,
  year: 2026,
  report_data: mockReportData,
  ai_insight: null,
  share_card_url: null,
  created_at: '2026-07-30T00:00:00.000Z',
};

/**
 * buildRealReportData 5 个并行聚合查询的空结果（无任何当周数据）
 * Promise.all 按数组顺序同步发起 query 调用，mock 顺序确定：
 *   1. healthAgg   - COUNT(*) 总是返回一行（全 0），COALESCE(AVG, 0) 也为 0
 *   2. symptomAgg  - COUNT(*) 返回一行 { count: 0 }
 *   3. foodAgg     - COUNT(*) 返回一行 { count: 0 }
 *   4. feedAgg     - COUNT(*) 返回一行（全 0）
 *   5. bestDayAgg  - GROUP BY 无数据时返回空 rows
 */
const emptyHealthAgg = {
  rows: [{
    checkin_count: 0,
    avg_poop: 0,
    avg_appetite: 0,
    avg_spirit: 0,
    anomaly_count: 0,
  }],
  rowCount: 1,
};
const emptySymptomAgg = { rows: [{ count: 0 }], rowCount: 1 };
const emptyFoodAgg = { rows: [{ count: 0 }], rowCount: 1 };
const emptyFeedAgg = {
  rows: [{
    feed_count: 0,
    new_moments: 0,
    new_milestones: 0,
    new_events: 0,
    active_pets: 0,
  }],
  rowCount: 1,
};
const emptyBestDayAgg = { rows: [], rowCount: 0 };
// 成员维度聚合（多成员共同养宠 2026-08-24）：无成员时返回空数组
const emptyMemberAgg = { rows: [], rowCount: 0 };
const mockMemberAgg = {
  rows: [
    { user_id: 'u-owner', role: 'owner', nickname: '主人', checkin_count: 3 },
    { user_id: 'u-member', role: 'member', nickname: '家人', checkin_count: 2 },
  ],
  rowCount: 2,
};

/**
 * 为 generateReport 正常路径设置 9 次 query 的 mock 序列：
 *   1. verifyFamilyOwnership → ownershipOk
 *   2. findExisting          → 不存在（空）
 *   3-8. buildRealReportData → 6 个空聚合结果（health/symptom/food/feed/bestDay/member）
 *   9. insertReport          → 返回 mockReport
 */
function mockGenerateReportSuccess() {
  mockPool.query
    .mockResolvedValueOnce(ownershipOk)        // 1. verifyFamilyOwnership
    .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // 2. findExisting (not exists)
    .mockResolvedValueOnce(emptyHealthAgg)     // 3. healthAgg
    .mockResolvedValueOnce(emptySymptomAgg)    // 4. symptomAgg
    .mockResolvedValueOnce(emptyFoodAgg)       // 5. foodAgg
    .mockResolvedValueOnce(emptyFeedAgg)       // 6. feedAgg
    .mockResolvedValueOnce(emptyBestDayAgg)    // 7. bestDayAgg
    .mockResolvedValueOnce(emptyMemberAgg)     // 8. memberAgg
    .mockResolvedValueOnce({ rows: [mockReport], rowCount: 1 }); // 9. insertReport
}

beforeEach(() => {
  // mockReset 清除 mock 队列（含 mockResolvedValueOnce 残留），避免测试间污染
  mockPool.query.mockReset();
  mockChat.mockReset();
  // 每个测试前重置 apiKey 为空（默认走 null 分支，不调用 AI）
  (config as unknown as { ai: { apiKey: string } }).ai.apiKey = '';
});

// ===== GET /api/families/:id/weekly-reports - 获取周报列表 =====
describe('GET /api/families/:id/weekly-reports - 获取周报列表', () => {
  it('正常返回列表（含分页信息）', async () => {
    mockPool.query
      .mockResolvedValueOnce(ownershipOk)                              // verifyFamilyOwnership
      .mockResolvedValueOnce({ rows: [mockReport], rowCount: 1 })      // findByFamilyId
      .mockResolvedValueOnce({ rows: [{ count: 1 }], rowCount: 1 });   // countByFamilyId

    const res = await request(createApp())
      .get('/api/families/family-001/weekly-reports');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.items).toBeInstanceOf(Array);
    expect(res.body.data.items).toHaveLength(1);
    expect(res.body.data.items[0].id).toBe('report-001');
    expect(res.body.data.total).toBe(1);
    expect(res.body.data.page).toBe(1);
    expect(res.body.data.page_size).toBe(20);
  });

  it('返回的 report_data 为对象（JSONB 已解析）', async () => {
    mockPool.query
      .mockResolvedValueOnce(ownershipOk)
      .mockResolvedValueOnce({ rows: [mockReport], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ count: 1 }], rowCount: 1 });

    const res = await request(createApp())
      .get('/api/families/family-001/weekly-reports');

    expect(res.body.data.items[0].report_data).toBeInstanceOf(Object);
    expect(res.body.data.items[0].report_data.health).toBeDefined();
    expect(res.body.data.items[0].report_data.activities).toBeDefined();
    expect(res.body.data.items[0].report_data.family).toBeDefined();
  });

  it('默认分页 page=1, page_size=20', async () => {
    mockPool.query
      .mockResolvedValueOnce(ownershipOk)
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [{ count: 0 }], rowCount: 1 });

    const res = await request(createApp())
      .get('/api/families/family-001/weekly-reports');

    expect(res.body.data.page).toBe(1);
    expect(res.body.data.page_size).toBe(20);
  });

  it('分页参数正确传递', async () => {
    mockPool.query
      .mockResolvedValueOnce(ownershipOk)
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [{ count: 0 }], rowCount: 1 });

    await request(createApp())
      .get('/api/families/family-001/weekly-reports?page=2&page_size=5');

    // 验证列表查询 SQL 包含 LIMIT 和 OFFSET
    const findCall = mockPool.query.mock.calls[1];
    expect(findCall[0]).toContain('LIMIT');
    expect(findCall[0]).toContain('OFFSET');
    // page=2, page_size=5 → offset=(2-1)*5=5, limit=5
    expect(findCall[1]).toContain(5);
  });

  it('按年过滤', async () => {
    mockPool.query
      .mockResolvedValueOnce(ownershipOk)
      .mockResolvedValueOnce({ rows: [mockReport], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ count: 1 }], rowCount: 1 });

    await request(createApp())
      .get('/api/families/family-001/weekly-reports?year=2026');

    // 验证列表查询 SQL 包含 year 条件
    const findCall = mockPool.query.mock.calls[1];
    expect(findCall[0]).toContain('year');
    expect(findCall[1]).toContain(2026);

    // 验证 count 查询也包含 year 条件
    const countCall = mockPool.query.mock.calls[2];
    expect(countCall[0]).toContain('year');
    expect(countCall[1]).toContain(2026);
  });

  it('列表查询按 year DESC, week_number DESC 排序', async () => {
    mockPool.query
      .mockResolvedValueOnce(ownershipOk)
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [{ count: 0 }], rowCount: 1 });

    await request(createApp())
      .get('/api/families/family-001/weekly-reports');

    const findCall = mockPool.query.mock.calls[1];
    expect(findCall[0]).toContain('ORDER BY year DESC, week_number DESC');
  });

  it('page_size 超过 100 时返回 400', async () => {
    const res = await request(createApp())
      .get('/api/families/family-001/weekly-reports?page_size=101');

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('year 超出范围返回 400', async () => {
    const res = await request(createApp())
      .get('/api/families/family-001/weekly-reports?year=2019');

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('家庭不属于当前用户返回 403', async () => {
    mockPool.query.mockResolvedValueOnce(ownershipFail); // verifyFamilyOwnership fails

    const res = await request(createApp())
      .get('/api/families/family-001/weekly-reports');

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toContain('无权');
  });

  it('数据库异常返回 500', async () => {
    mockPool.query.mockRejectedValueOnce(new Error('DB error')); // ownership throws

    const res = await request(createApp())
      .get('/api/families/family-001/weekly-reports');

    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
  });
});

// ===== GET /api/families/:id/weekly-reports/latest - 获取最新周报 =====
describe('GET /api/families/:id/weekly-reports/latest - 获取最新周报', () => {
  it('正常返回最新周报', async () => {
    mockPool.query
      .mockResolvedValueOnce(ownershipOk)                         // verifyFamilyOwnership
      .mockResolvedValueOnce({ rows: [mockReport], rowCount: 1 }); // findLatestByFamilyId

    const res = await request(createApp())
      .get('/api/families/family-001/weekly-reports/latest');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.id).toBe('report-001');
    expect(res.body.data.year).toBe(2026);
    expect(res.body.data.week_number).toBe(31);
  });

  it('最新周报查询按 year DESC, week_number DESC 排序', async () => {
    mockPool.query
      .mockResolvedValueOnce(ownershipOk)
      .mockResolvedValueOnce({ rows: [mockReport], rowCount: 1 });

    await request(createApp())
      .get('/api/families/family-001/weekly-reports/latest');

    const findCall = mockPool.query.mock.calls[1];
    expect(findCall[0]).toContain('ORDER BY year DESC, week_number DESC');
    expect(findCall[0]).toContain('LIMIT 1');
  });

  it('无周报返回 404', async () => {
    mockPool.query
      .mockResolvedValueOnce(ownershipOk)                  // verifyFamilyOwnership
      .mockResolvedValueOnce({ rows: [], rowCount: 0 });   // findLatestByFamilyId (empty)

    const res = await request(createApp())
      .get('/api/families/family-001/weekly-reports/latest');

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toContain('暂无周报');
  });

  it('家庭不属于当前用户返回 403', async () => {
    mockPool.query.mockResolvedValueOnce(ownershipFail); // verifyFamilyOwnership fails

    const res = await request(createApp())
      .get('/api/families/family-001/weekly-reports/latest');

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toContain('无权');
  });
});

// ===== GET /api/families/:id/weekly-reports/:reportId - 获取周报详情 =====
describe('GET /api/families/:id/weekly-reports/:reportId - 获取周报详情', () => {
  it('正常返回详情', async () => {
    mockPool.query
      .mockResolvedValueOnce(ownershipOk)                         // verifyFamilyOwnership
      .mockResolvedValueOnce({ rows: [mockReport], rowCount: 1 }); // findByIdAndFamily

    const res = await request(createApp())
      .get('/api/families/family-001/weekly-reports/report-001');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.id).toBe('report-001');
    expect(res.body.data.family_id).toBe('family-001');
  });

  it('详情查询同时校验 reportId 和 familyId（防跨家庭越权）', async () => {
    mockPool.query
      .mockResolvedValueOnce(ownershipOk)
      .mockResolvedValueOnce({ rows: [mockReport], rowCount: 1 });

    await request(createApp())
      .get('/api/families/family-001/weekly-reports/report-001');

    const detailCall = mockPool.query.mock.calls[1];
    expect(detailCall[0]).toContain('id = $1');
    expect(detailCall[0]).toContain('family_id = $2');
    expect(detailCall[1]).toContain('report-001');
    expect(detailCall[1]).toContain('family-001');
  });

  it('周报不存在返回 404', async () => {
    mockPool.query
      .mockResolvedValueOnce(ownershipOk)                  // verifyFamilyOwnership
      .mockResolvedValueOnce({ rows: [], rowCount: 0 });   // findByIdAndFamily (not found)

    const res = await request(createApp())
      .get('/api/families/family-001/weekly-reports/nonexistent');

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toContain('不存在');
  });

  it('家庭不属于当前用户返回 403', async () => {
    mockPool.query.mockResolvedValueOnce(ownershipFail); // verifyFamilyOwnership fails

    const res = await request(createApp())
      .get('/api/families/family-001/weekly-reports/report-001');

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toContain('无权');
  });
});

// ===== POST /api/families/:id/weekly-reports/generate - 手动生成周报 =====
describe('POST /api/families/:id/weekly-reports/generate - 手动生成周报', () => {
  it('正常生成周报（返回 201）', async () => {
    mockGenerateReportSuccess();

    const res = await request(createApp())
      .post('/api/families/family-001/weekly-reports/generate');

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.id).toBe('report-001');
    expect(res.body.data.ai_insight).toBeNull();
    expect(res.body.data.share_card_url).toBeNull();
  });

  it('生成的周报 report_data 来自真实聚合（空数据时为全 0 结构）', async () => {
    mockGenerateReportSuccess();

    const res = await request(createApp())
      .post('/api/families/family-001/weekly-reports/generate');

    expect(res.body.data.report_data).toBeInstanceOf(Object);
    expect(res.body.data.report_data.health).toMatchObject({
      checkin_count: 0,
      avg_poop: 0,
      avg_appetite: 0,
      avg_spirit: 0,
      anomaly_count: 0,
      best_day: null,
    });
    expect(res.body.data.report_data.activities).toMatchObject({
      symptom_checks: 0,
      food_queries: 0,
      new_moments: 0,
      new_milestones: 0,
    });
    expect(res.body.data.report_data.family).toMatchObject({
      feed_count: 0,
      new_events: 0,
      active_pets: 0,
    });
  });

  it('生成时检查同周是否已存在', async () => {
    mockGenerateReportSuccess();

    await request(createApp())
      .post('/api/families/family-001/weekly-reports/generate');

    // findExisting 查询包含 family_id、year、week_number 条件
    const findExistingCall = mockPool.query.mock.calls[1];
    expect(findExistingCall[0]).toContain('family_id = $1');
    expect(findExistingCall[0]).toContain('year = $2');
    expect(findExistingCall[0]).toContain('week_number = $3');
    expect(findExistingCall[1]).toContain('family-001');
  });

  it('插入时 report_data 使用 JSON.stringify', async () => {
    mockGenerateReportSuccess();

    await request(createApp())
      .post('/api/families/family-001/weekly-reports/generate');

    // insert 查询参数中 report_data 应为字符串（JSON.stringify 后）
    // 第 9 次调用（索引 8）为 insertReport
    const insertCall = mockPool.query.mock.calls[8];
    const params = insertCall[1] as unknown[];
    // 找到 report_data 参数（第 4 个：family_id, year, week_number, report_data, ai_insight, share_card_url）
    const reportDataParam = params[3];
    expect(typeof reportDataParam).toBe('string');
    // 解析后应包含 health/activities/family
    const parsed = JSON.parse(reportDataParam as string);
    expect(parsed.health).toBeDefined();
    expect(parsed.activities).toBeDefined();
    expect(parsed.family).toBeDefined();
  });

  it('真实聚合调用 6 个并行查询（health/symptom/food/feed/bestDay/member）', async () => {
    mockGenerateReportSuccess();

    await request(createApp())
      .post('/api/families/family-001/weekly-reports/generate');

    // 索引 2-7 为 buildRealReportData 的 6 个并行聚合查询
    const aggCalls = mockPool.query.mock.calls.slice(2, 8);
    // healthAgg：FROM pet_health_entries JOIN pet_family_members
    expect(aggCalls[0][0]).toContain('pet_health_entries');
    expect(aggCalls[0][0]).toContain('pet_family_members');
    expect(aggCalls[0][0]).toContain('checkin_count');
    // healthAgg 的异常指标必须按自然日去重（异常天数），且沿用全站北京时区归日口径：
    // 若退回 COUNT(*) FILTER，同一天补记两条就会被算成 2 天，与前端“次/天”展示口径不符
    expect(aggCalls[0][0]).toContain('COUNT(DISTINCT (h.created_at AT TIME ZONE');
    expect(aggCalls[0][0]).toContain(')::date) FILTER (WHERE has_anomaly) AS anomaly_count');
    // checkin_count 语义就是“次”（打卡条数），不能被顺手改成去重
    expect(aggCalls[0][0]).toContain('COUNT(*) AS checkin_count');
    // symptomAgg：FROM pet_symptom_checks JOIN pet_family_members
    expect(aggCalls[1][0]).toContain('pet_symptom_checks');
    // foodAgg：FROM pet_food_queries JOIN pet_families
    expect(aggCalls[2][0]).toContain('pet_food_queries');
    expect(aggCalls[2][0]).toContain('pet_families');
    // feedAgg：FROM pet_family_feeds
    expect(aggCalls[3][0]).toContain('pet_family_feeds');
    // bestDayAgg：GROUP BY day
    expect(aggCalls[4][0]).toContain('GROUP BY day');
    // memberAgg：成员维度（pet_family_users + pet_health_entries）
    expect(aggCalls[5][0]).toContain('pet_family_users');
    expect(aggCalls[5][0]).toContain('pet_health_entries');
    expect(aggCalls[5][0]).toContain('checkin_count');
  });

  it('周报 report_data 含成员维度（health.members）', async () => {
    mockPool.query
      .mockResolvedValueOnce(ownershipOk)        // 1. verifyFamilyOwnership
      .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // 2. findExisting
      .mockResolvedValueOnce(emptyHealthAgg)     // 3. healthAgg
      .mockResolvedValueOnce(emptySymptomAgg)    // 4. symptomAgg
      .mockResolvedValueOnce(emptyFoodAgg)       // 5. foodAgg
      .mockResolvedValueOnce(emptyFeedAgg)       // 6. feedAgg
      .mockResolvedValueOnce(emptyBestDayAgg)    // 7. bestDayAgg
      .mockResolvedValueOnce(mockMemberAgg)      // 8. memberAgg（2 位成员）
      .mockResolvedValueOnce({ rows: [mockReport], rowCount: 1 }); // 9. insertReport

    await request(createApp())
      .post('/api/families/family-001/weekly-reports/generate');

    const insertCall = mockPool.query.mock.calls[8];
    const params = insertCall[1] as unknown[];
    const parsed = JSON.parse(params[3] as string);
    expect(parsed.health.members).toHaveLength(2);
    expect(parsed.health.members[0]).toMatchObject({ userId: 'u-owner', checkinCount: 3 });
    expect(parsed.health.members[1]).toMatchObject({ userId: 'u-member', checkinCount: 2 });
  });

  it('同周已存在返回 409', async () => {
    mockPool.query
      .mockResolvedValueOnce(ownershipOk)                         // verifyFamilyOwnership
      .mockResolvedValueOnce({ rows: [mockReport], rowCount: 1 }); // findExisting (exists)

    const res = await request(createApp())
      .post('/api/families/family-001/weekly-reports/generate');

    expect(res.status).toBe(409);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toContain('已生成');
  });

  it('家庭不属于当前用户返回 403', async () => {
    mockPool.query.mockResolvedValueOnce(ownershipFail); // verifyFamilyOwnership fails

    const res = await request(createApp())
      .post('/api/families/family-001/weekly-reports/generate');

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toContain('无权');
  });

  it('数据库异常返回 500', async () => {
    mockPool.query.mockRejectedValueOnce(new Error('DB error')); // ownership throws

    const res = await request(createApp())
      .post('/api/families/family-001/weekly-reports/generate');

    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
  });

  it('apiKey 未配置时 ai_insight 为 null', async () => {
    // apiKey 默认为空（beforeEach 已重置），走 null 分支不调用 AI
    mockGenerateReportSuccess();

    const res = await request(createApp())
      .post('/api/families/family-001/weekly-reports/generate');

    expect(res.status).toBe(201);
    // mockReport.ai_insight 为 null
    expect(res.body.data.ai_insight).toBeNull();
    // 不应调用 chat
    expect(mockChat).not.toHaveBeenCalled();
  });

  it('apiKey 已配置时调用 AI 生成 ai_insight', async () => {
    // 设置 apiKey 触发 AI 调用路径
    (config as unknown as { ai: { apiKey: string } }).ai.apiKey = 'test-ai-key';
    // mockReport 需要带 ai_insight 字段以反映 insertReport 返回值
    const mockReportWithInsight = {
      ...mockReport,
      ai_insight: '本周宝贝状态平稳，打卡积极，下周可适当增加户外活动时间。',
    };
    mockChat.mockResolvedValueOnce('本周宝贝状态平稳，打卡积极，下周可适当增加户外活动时间。');

    mockPool.query
      .mockResolvedValueOnce(ownershipOk)        // 1. verifyFamilyOwnership
      .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // 2. findExisting
      .mockResolvedValueOnce(emptyHealthAgg)     // 3. healthAgg
      .mockResolvedValueOnce(emptySymptomAgg)    // 4. symptomAgg
      .mockResolvedValueOnce(emptyFoodAgg)       // 5. foodAgg
      .mockResolvedValueOnce(emptyFeedAgg)       // 6. feedAgg
      .mockResolvedValueOnce(emptyBestDayAgg)    // 7. bestDayAgg
      .mockResolvedValueOnce(emptyMemberAgg)     // 8. memberAgg
      .mockResolvedValueOnce({ rows: [mockReportWithInsight], rowCount: 1 }); // 9. insertReport

    const res = await request(createApp())
      .post('/api/families/family-001/weekly-reports/generate');

    expect(res.status).toBe(201);
    // 验证调用了 chat（系统提示 + 用户提示）
    expect(mockChat).toHaveBeenCalledTimes(1);
    const chatArgs = mockChat.mock.calls[0][0] as Array<{ role: string; content: string }>;
    expect(chatArgs).toHaveLength(2);
    expect(chatArgs[0].role).toBe('system');
    expect(chatArgs[0].content).toContain('星河宠记');
    expect(chatArgs[1].role).toBe('user');
    expect(chatArgs[1].content).toContain('周报数据');
    // insertReport 参数中 ai_insight 应为 AI 返回的文本
    const insertCall = mockPool.query.mock.calls[8];
    const params = insertCall[1] as unknown[];
    // 第 5 个参数为 ai_insight（family_id, year, week_number, report_data, ai_insight, share_card_url）
    expect(params[4]).toBe('本周宝贝状态平稳，打卡积极，下周可适当增加户外活动时间。');
  });

  it('AI 调用失败时降级为 null，不阻断周报生成', async () => {
    (config as unknown as { ai: { apiKey: string } }).ai.apiKey = 'test-ai-key';
    mockChat.mockRejectedValueOnce(new Error('AI service unavailable'));

    mockPool.query
      .mockResolvedValueOnce(ownershipOk)
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce(emptyHealthAgg)
      .mockResolvedValueOnce(emptySymptomAgg)
      .mockResolvedValueOnce(emptyFoodAgg)
      .mockResolvedValueOnce(emptyFeedAgg)
      .mockResolvedValueOnce(emptyBestDayAgg)
      .mockResolvedValueOnce(emptyMemberAgg)
      .mockResolvedValueOnce({ rows: [mockReport], rowCount: 1 });

    const res = await request(createApp())
      .post('/api/families/family-001/weekly-reports/generate');

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    // insertReport 参数中 ai_insight 应为 null（降级）
    const insertCall = mockPool.query.mock.calls[8];
    const params = insertCall[1] as unknown[];
    expect(params[4]).toBeNull();
  });
});
