/**
 * 家庭周报业务服务层 - 编排家庭周报的核心业务逻辑
 * 职责：家庭归属校验、周报列表分页、最新周报、详情查询、手动生成
 * generateReport 聚合当周真实数据（健康打卡/症状/食物查询/家庭动态）
 * ai_insight 由 aiService.chat 生成（apiKey 未配置时返回 null）
 * share_card_url 暂为 null，待接入分享卡片生成
 * 所有操作前先验证 family_id 属于当前用户，防止跨用户越权
 */
import { pool } from '../db.js';
import { config } from '../config.js';
import { chat } from './aiService.js';
import { WeeklyReportRepository, type WeeklyReportRow } from '../repositories/weeklyReportRepository.js';

/** 周报列表查询参数 */
export interface WeeklyReportQueryInput {
  page: number;
  page_size: number;
  year?: number;
}

/** 分页列表响应 */
export interface WeeklyReportListResponse {
  items: WeeklyReportRow[];
  total: number;
  page: number;
  page_size: number;
}

/** 业务错误（带状态码，供路由层捕获） */
export class WeeklyReportError extends Error {
  constructor(
    public statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = 'WeeklyReportError';
  }
}

const weeklyReportRepository = new WeeklyReportRepository();

/**
 * 校验家庭访问权 - 防横向越权（多成员共同养宠：家庭成员可查看家庭周报）
 * 直接 SQL 查询 pet_family_users（owner 和 member 均可）
 */
async function verifyFamilyOwnership(familyId: string, userId: string): Promise<boolean> {
  const result = await pool.query(
    'SELECT 1 FROM pet_family_users WHERE family_id = $1 AND user_id = $2',
    [familyId, userId],
  );
  return (result.rowCount ?? 0) > 0;
}

/**
 * 计算 ISO 周年和周数
 * ISO 8601：周以周一为起点，第 1 周是包含当年第一个周四的周
 * 跨年时（1 月初/12 月末），ISO year 可能与日历年不同
 * @param date - 待计算的日期
 * @returns { year: ISO 年, weekNumber: ISO 周数 }
 */
function getISOWeekYearAndWeek(date: Date): { year: number; weekNumber: number } {
  // 复制日期并按 UTC 处理，避免本地时区干扰
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  // getUTCDay(): 0=周日, 1=周一...6=周六；ISO 以周一为周首，将周日(0)转为 7
  const dayNum = d.getUTCDay() || 7;
  // 调整到当前 ISO 周的周四（周四是该周的标准锚点）
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNumber = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return { year: d.getUTCFullYear(), weekNumber };
}

/**
 * 根据 ISO 年+周数计算该周的起止时间
 * ISO 周以周一 00:00:00 为起点，周日 23:59:59 为终点
 *
 * 算法：找到该年第 1 个周四（ISO 周锚点），回推到那个周一，再加上 (weekNumber-1)*7 天
 *
 * @param year - ISO 周年
 * @param weekNumber - ISO 周数
 * @returns { weekStart: 周一 00:00:00, weekEnd: 周日 23:59:59 }
 */
function getWeekDateRange(year: number, weekNumber: number): { weekStart: Date; weekEnd: Date } {
  // 1月4日总是属于第1周或第53周，以它为锚点
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4Day = jan4.getUTCDay() || 7; // 周日(0)→7
  // 第1周周一 = 1月4日 - (jan4Day - 1) 天
  const week1Monday = new Date(jan4);
  week1Monday.setUTCDate(jan4.getUTCDate() - (jan4Day - 1));
  // 目标周周一 = 第1周周一 + (weekNumber - 1) * 7 天
  const weekStart = new Date(week1Monday);
  weekStart.setUTCDate(week1Monday.getUTCDate() + (weekNumber - 1) * 7);
  // 周日 23:59:59 = 周一 + 7天 - 1秒
  const weekEnd = new Date(weekStart);
  weekEnd.setUTCDate(weekStart.getUTCDate() + 7);
  weekEnd.setUTCSeconds(-1); // 回退1秒到周日 23:59:59
  return { weekStart, weekEnd };
}

/** 空的周报数据结构（聚合查询无数据时返回） */
function buildEmptyReportData(): Record<string, unknown> {
  return {
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
}

/**
 * 聚合家庭当周真实数据，构建周报 report_data
 * 并行执行 5 个聚合查询，通过 pet_family_members JOIN 关联家庭下所有宠物
 *
 * 数据来源：
 *   - health: pet_health_entries（健康打卡）→ 通过 pet_family_members JOIN
 *   - activities.symptom_checks: pet_symptom_checks → 通过 pet_family_members JOIN
 *   - activities.food_queries: pet_food_queries → 按家庭创建者 user_id 关联（食物查询无 pet_id）
 *   - activities.new_moments/new_milestones + family.*: pet_family_feeds → 直接按 family_id
 *   - best_day: pet_health_entries 打卡最多的日期
 *
 * @param familyId - 家庭 ID
 * @param year - ISO 周年
 * @param weekNumber - ISO 周数
 */
async function buildRealReportData(
  familyId: string,
  year: number,
  weekNumber: number,
): Promise<Record<string, unknown>> {
  const { weekStart, weekEnd } = getWeekDateRange(year, weekNumber);

  // 6 个聚合查询并行执行（Promise.all 内部按数组顺序同步发起 query 调用，mock 顺序确定）
  const [healthAgg, symptomAgg, foodAgg, feedAgg, bestDayAgg, memberAgg] = await Promise.all([
    // 1. 健康打卡聚合：COUNT + AVG + 异常天数（异常按自然日去重，口径同 best_day）
    pool.query(
      `SELECT
         COUNT(*) AS checkin_count,
         COALESCE(AVG(poop_level), 0)::float AS avg_poop,
         COALESCE(AVG(appetite_level), 0)::float AS avg_appetite,
         COALESCE(AVG(spirit_level), 0)::float AS avg_spirit,
         -- 异常天数：同一自然日补记多条只算 1 天（按北京时区归日，与 best_day 口径一致）；
         -- 注意：checkin_count 不要去重（前端标签是“本周打卡（次）”，按条数才是对的）
         COUNT(DISTINCT (h.created_at AT TIME ZONE 'Asia/Shanghai')::date) FILTER (WHERE has_anomaly) AS anomaly_count
       FROM pet_health_entries h
       JOIN pet_family_members m ON m.pet_id = h.pet_id
       WHERE m.family_id = $1 AND h.created_at BETWEEN $2 AND $3`,
      [familyId, weekStart, weekEnd],
    ),
    // 2. 症状初筛计数
    pool.query(
      `SELECT COUNT(*) AS count
       FROM pet_symptom_checks s
       JOIN pet_family_members m ON m.pet_id = s.pet_id
       WHERE m.family_id = $1 AND s.created_at BETWEEN $2 AND $3`,
      [familyId, weekStart, weekEnd],
    ),
    // 3. 食物查询计数（按家庭创建者 user_id，食物查询无 pet_id 字段）
    pool.query(
      `SELECT COUNT(*) AS count
       FROM pet_food_queries f
       JOIN pet_families fam ON fam.id = $1
       WHERE f.user_id = fam.user_id AND f.created_at BETWEEN $2 AND $3`,
      [familyId, weekStart, weekEnd],
    ),
    // 4. 家庭动态聚合：总数 + 按类型计数 + 活跃宠物数
    pool.query(
      `SELECT
         COUNT(*) AS feed_count,
         COUNT(*) FILTER (WHERE feed_type = 'moment') AS new_moments,
         COUNT(*) FILTER (WHERE feed_type = 'achievement') AS new_milestones,
         COUNT(*) FILTER (WHERE feed_type = 'family_event') AS new_events,
         COUNT(DISTINCT pet_id) FILTER (WHERE pet_id IS NOT NULL) AS active_pets
       FROM pet_family_feeds
       WHERE family_id = $1 AND created_at BETWEEN $2 AND $3`,
      [familyId, weekStart, weekEnd],
    ),
    // 5. 最佳一天：当周打卡最多的日期
    pool.query(
      `SELECT -- 审查⏳1：最佳一天按北京时区归日
      (h.created_at AT TIME ZONE 'Asia/Shanghai')::date AS day, COUNT(*) AS cnt
       FROM pet_health_entries h
       JOIN pet_family_members m ON m.pet_id = h.pet_id
       WHERE m.family_id = $1 AND h.created_at BETWEEN $2 AND $3
       GROUP BY day ORDER BY cnt DESC LIMIT 1`,
      [familyId, weekStart, weekEnd],
    ),
    // 6. 成员维度（多成员共同养宠，2026-08-24）：本周每位家庭成员的打卡贡献
    pool.query(
      `SELECT u.user_id, u.role,
              COALESCE(users.nickname, '') AS nickname,
              COUNT(h.id) AS checkin_count
       FROM pet_family_users u
       LEFT JOIN pet_health_entries h
         ON h.user_id = u.user_id AND h.created_at BETWEEN $2 AND $3
         AND EXISTS (SELECT 1 FROM pet_family_members m
                     WHERE m.family_id = u.family_id AND m.pet_id = h.pet_id)
       LEFT JOIN users ON users.id = u.user_id
       WHERE u.family_id = $1
       GROUP BY u.user_id, u.role, users.nickname
       ORDER BY checkin_count DESC`,
      [familyId, weekStart, weekEnd],
    ),
  ]);

  const healthRow = healthAgg.rows[0] ?? {};
  const symptomRow = symptomAgg.rows[0] ?? {};
  const foodRow = foodAgg.rows[0] ?? {};
  const feedRow = feedAgg.rows[0] ?? {};
  const bestDayRow = bestDayAgg.rows[0];
  const memberRows = memberAgg.rows ?? [];

  return {
    health: {
      checkin_count: Number(healthRow.checkin_count ?? 0),
      avg_poop: Number(healthRow.avg_poop ?? 0),
      avg_appetite: Number(healthRow.avg_appetite ?? 0),
      avg_spirit: Number(healthRow.avg_spirit ?? 0),
      anomaly_count: Number(healthRow.anomaly_count ?? 0),
      best_day: bestDayRow ? String(bestDayRow.day) : null,
      // 成员维度：本周每位家庭成员的打卡数（AI 总结"我们一起照顾了 TA"）
      members: memberRows.map((r) => ({
        userId: String(r.user_id ?? ''),
        role: String(r.role ?? 'member'),
        nickname: String(r.nickname ?? ''),
        checkinCount: Number(r.checkin_count ?? 0),
      })),
    },
    activities: {
      symptom_checks: Number(symptomRow.count ?? 0),
      food_queries: Number(foodRow.count ?? 0),
      new_moments: Number(feedRow.new_moments ?? 0),
      new_milestones: Number(feedRow.new_milestones ?? 0),
    },
    family: {
      feed_count: Number(feedRow.feed_count ?? 0),
      new_events: Number(feedRow.new_events ?? 0),
      active_pets: Number(feedRow.active_pets ?? 0),
    },
  };
}

/**
 * 基于当周聚合数据生成 AI 总结（ai_insight）
 * - apiKey 未配置时返回 null（开发/测试环境）
 * - 调用 aiService.chat，提示词要求：温和积极、中文、不超过 200 字、给出 1 条可执行建议
 * - AI 调用失败时返回 null，不阻断周报生成（周报数据本身已成功聚合）
 *
 * @param reportData - buildRealReportData 返回的聚合数据
 * @returns AI 总结文本或 null
 */
async function buildAiInsight(
  reportData: Record<string, unknown>,
): Promise<string | null> {
  if (!config.ai.apiKey) {
    return null;
  }

  const systemPrompt = `你是"星河宠记"AI 宠物管家的周报助手。请根据本周家庭数据生成一段中文周报总结，要求：
1. 语气温和、积极、有温度，像朋友间的关心
2. 不超过 200 字
3. 简要概括本周健康状况和活跃度
4. 若数据中有 health.members（本周每位家庭成员的打卡数），请自然提及家庭成员的共同参与（如"这周你们一起照顾了 X 次"、"TA 也参与记录"），体现共同养宠的温度；若只有一人参与则不必强调
5. 结尾给出 1 条可执行的下周建议（如饮食、运动、观察重点）
6. 不要使用 markdown 格式，纯文本即可
7. 不要提及具体数字背后的技术字段名，用自然语言描述`;

  const userPrompt = `本周家庭周报数据：
${JSON.stringify(reportData, null, 2)}

请生成周报总结。`;

  try {
    const insight = await chat(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      { temperature: 0.7, max_tokens: 400 },
    );
    return insight.trim() || null;
  } catch (error) {
    // AI 调用失败不阻断周报生成，降级为 null
    console.error('[WeeklyReport AI Insight Error]', error);
    return null;
  }
}

/**
 * 分页查询家庭周报列表
 * - 校验家庭归属
 * - 查询列表 + 总数（并行）
 */
export async function listReports(
  userId: string,
  familyId: string,
  query: WeeklyReportQueryInput,
): Promise<WeeklyReportListResponse> {
  const owns = await verifyFamilyOwnership(familyId, userId);
  if (!owns) {
    throw new WeeklyReportError(403, '无权查看此家庭');
  }

  const [items, total] = await Promise.all([
    weeklyReportRepository.findByFamilyId(
      familyId,
      query.page,
      query.page_size,
      query.year,
    ),
    weeklyReportRepository.countByFamilyId(familyId, query.year),
  ]);

  return {
    items,
    total,
    page: query.page,
    page_size: query.page_size,
  };
}

/**
 * 获取家庭最新周报
 * - 校验家庭归属
 * - 无周报返回 404
 */
export async function getLatest(
  userId: string,
  familyId: string,
): Promise<WeeklyReportRow> {
  const owns = await verifyFamilyOwnership(familyId, userId);
  if (!owns) {
    throw new WeeklyReportError(403, '无权查看此家庭');
  }

  const latest = await weeklyReportRepository.findLatestByFamilyId(familyId);
  if (!latest) {
    throw new WeeklyReportError(404, '暂无周报');
  }
  return latest;
}

/**
 * 获取周报详情
 * - 校验家庭归属
 * - 周报不存在或不属于该家庭返回 404
 */
export async function getReport(
  userId: string,
  familyId: string,
  reportId: string,
): Promise<WeeklyReportRow> {
  const owns = await verifyFamilyOwnership(familyId, userId);
  if (!owns) {
    throw new WeeklyReportError(403, '无权查看此家庭');
  }

  const report = await weeklyReportRepository.findByIdAndFamily(reportId, familyId);
  if (!report) {
    throw new WeeklyReportError(404, '周报不存在');
  }
  return report;
}

/**
 * 手动生成周报
 * - 校验家庭归属
 * - 计算当前 ISO 周年与周数
 * - 检查同周是否已生成（UNIQUE 预检），有则 409
 * - 聚合当周真实数据（健康打卡/症状/食物查询/家庭动态）
 * - 生成 AI 总结（apiKey 未配置或调用失败时为 null，不阻断流程）
 * - share_card_url 暂为 null，待接入分享卡片生成
 */
export async function generateReport(
  userId: string,
  familyId: string,
): Promise<WeeklyReportRow> {
  const owns = await verifyFamilyOwnership(familyId, userId);
  if (!owns) {
    throw new WeeklyReportError(403, '无权操作此家庭');
  }

  const { year, weekNumber } = getISOWeekYearAndWeek(new Date());

  const existing = await weeklyReportRepository.findExisting(familyId, year, weekNumber);
  if (existing) {
    throw new WeeklyReportError(409, '本周周报已生成');
  }

  const report_data = await buildRealReportData(familyId, year, weekNumber);
  const ai_insight = await buildAiInsight(report_data);

  return weeklyReportRepository.insertReport({
    family_id: familyId,
    year,
    week_number: weekNumber,
    report_data,
    ai_insight,
    share_card_url: null,
  });
}
