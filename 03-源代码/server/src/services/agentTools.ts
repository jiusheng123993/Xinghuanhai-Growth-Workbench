import { beijingDateString } from '../utils/beijingTime.js';
/**
 * Agent 工具实现
 * 每个工具封装对现有后端逻辑的调用，供 Agent 循环使用
 *
 * 安全规则：
 * - 所有查询类工具自动注入 userId 过滤
 * - 所有写入类工具校验 petId 归属
 * - 所有工具结果脱敏，不暴露内部数据
 */
import { v4 as uuidv4 } from 'uuid';
import { pool } from '../db.js';
import { registerTool, type ToolResult } from './toolRegistry.js';
import { listHealthReports } from './healthReportService.js';
// 图谱评估器（Phase 3 收尾：聊天路径 check_symptom 消费权威图谱，与症状初筛页判断一致）
import { loadActiveGraph, mapSymptomTextToIds, evaluateSymptomLevel } from './graphEvaluator.js';
// 品种库权威数据（search_breed_info 接 breed_knowledge 热更新表）+ 纯函数名称匹配
import { BreedKnowledgeRepository } from '../repositories/breedRepository.js';
import { findBreedMatch } from './breedMatch.js';

type Context = { userId: string; petId?: string };

// 品种库仓库单例（与 routes/breeds.ts 同表，getLatestBreeds 空表会惰性播种种子）
const breedRepository = new BreedKnowledgeRepository();

// ========== 辅助函数 ==========

/**
 * 解析目标宠物 ID（多宠上下文：支持按名字/ID 指定非当前宠物）
 * 优先级：① 工具传入的 pet_id（已校验归属）→ ② context.petId（当前活跃宠物）→ ③ 用户第一只
 * @param context - Agent 上下文
 * @param petIdOverride - 工具显式指定的宠物 ID（来自 find_pet_by_name）
 * @returns 宠物 ID 或 null
 */
async function getPetId(context: Context, petIdOverride?: string): Promise<string | null> {
  // ① 工具显式指定（用户问"小黑今天怎么样"时，Agent 先用 find_pet_by_name 拿到小黑的 id 传进来）
  if (petIdOverride) {
    const { rows } = await pool.query(
      'SELECT id FROM pet_profiles WHERE id = $1 AND user_id = $2',
      [petIdOverride, context.userId]
    );
    if (rows.length > 0) return petIdOverride;
  }
  // ② 当前活跃宠物
  if (context.petId) {
    const { rows } = await pool.query(
      'SELECT id FROM pet_profiles WHERE id = $1 AND user_id = $2',
      [context.petId, context.userId]
    );
    if (rows.length > 0) return context.petId;
  }
  // ③ 自动获取用户第一只宠物
  const { rows } = await pool.query(
    'SELECT id FROM pet_profiles WHERE user_id = $1 ORDER BY created_at LIMIT 1',
    [context.userId]
  );
  return rows.length > 0 ? rows[0].id : null;
}

// ========== 0. find_pet_by_name（多宠解析：名字 → 宠物 ID） ==========

registerTool('find_pet_by_name', async (args, context): Promise<ToolResult> => {
  const name = String(args.name || '').trim();
  if (!name) {
    return { success: false, message: '请提供宠物名字，如"小黑""豆豆"' };
  }

  const { rows } = await pool.query(
    `SELECT id, name, species, breed, is_deceased FROM pet_profiles
     WHERE user_id = $1 AND name ILIKE $2
     ORDER BY created_at`,
    [context.userId, `%${name}%`]
  );

  if (rows.length === 0) {
    return { success: false, message: `没有找到叫"${name}"的宠物` };
  }

  return {
    success: true,
    data: {
      pets: rows.map((r) => ({
        pet_id: r.id,
        name: r.name,
        species: r.species,
        breed: r.breed,
        is_deceased: r.is_deceased,
      })),
      message: '找到以下宠物，后续查询请带上对应 pet_id',
    },
  };
});

// ========== 0b. get_health_reports（体检记录查询，F8） ==========

registerTool('get_health_reports', async (args, context): Promise<ToolResult> => {
  const petId = await getPetId(context, args.pet_id as string | undefined);
  if (!petId) {
    return { success: false, message: '还没有添加宠物' };
  }

  const reports = await listHealthReports(
    petId,
    context.userId,
    Math.min(10, Math.max(1, (args.limit as number) || 5)),
  );
  if (reports.length === 0) {
    return { success: true, data: { reports: [], message: '还没有体检记录，可让用户上传体检报告照片识别' } };
  }

  return {
    success: true,
    data: {
      reports: reports.map((r) => ({
        id: r.id,
        report_date: r.report_date,
        metrics: r.metrics,
        created_at: r.created_at,
      })),
    },
  };
});

// ========== 1. get_pet_profile ==========

registerTool('get_pet_profile', async (args, context): Promise<ToolResult> => {
  const petId = await getPetId(context, args.pet_id as string | undefined);
  if (!petId) {
    return { success: false, message: '还没有添加宠物，请先在"宠物"页面添加' };
  }

  const { rows } = await pool.query(
    `SELECT name, species, breed, gender, birth_date, weight, is_neutered, notes, avatar_photo_url
     FROM pet_profiles WHERE id = $1 AND user_id = $2`,
    [petId, context.userId]
  );
  if (rows.length === 0) {
    return { success: false, message: '宠物不存在' };
  }

  const p = rows[0];
  const age = p.birth_date
    ? `${Math.floor((Date.now() - new Date(p.birth_date).getTime()) / (365.25 * 24 * 60 * 60 * 1000))}岁`
    : '未知';

  const { rows: checkins } = await pool.query(
    `SELECT spirit_level, appetite_level, poop_level, note, created_at
     FROM pet_health_entries WHERE pet_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [petId]
  );

  return {
    success: true,
    data: {
      name: p.name,
      species: p.species,
      breed: p.breed,
      gender: p.gender === 'male' ? '公' : p.gender === 'female' ? '母' : '未知',
      age,
      weight: p.weight ? `${p.weight}kg` : '未知',
      isNeutered: p.is_neutered,
      notes: p.notes,
      lastCheckin: checkins.length > 0 ? {
        date: new Date(checkins[0].created_at).toLocaleDateString('zh-CN'),
        spirit: checkins[0].spirit_level,
        appetite: checkins[0].appetite_level,
        poop: checkins[0].poop_level,
        note: checkins[0].note,
      } : null,
    },
  };
});

// ========== 2. get_pet_facts ==========

registerTool('get_pet_facts', async (args, context): Promise<ToolResult> => {
  const petId = await getPetId(context, args.pet_id as string | undefined);
  if (!petId) {
    return { success: false, message: '还没有添加宠物' };
  }

  const { rows } = await pool.query(
    `SELECT category, fact FROM pet_facts
     WHERE pet_id = $1 AND user_id = $2
     ORDER BY created_at DESC LIMIT 20`,
    [petId, context.userId]
  );

  if (rows.length === 0) {
    return { success: true, data: { facts: [], message: '还没有记录宠物特征，你可以说"记住，豆豆喜欢吃牛肉"来教我' } };
  }

  const categories: Record<string, string[]> = {};
  for (const f of rows) {
    if (!categories[f.category]) categories[f.category] = [];
    categories[f.category].push(f.fact);
  }

  return { success: true, data: { facts: categories } };
});

// ========== 3. get_recent_checkins ==========

registerTool('get_recent_checkins', async (args, context): Promise<ToolResult> => {
  const petId = await getPetId(context, args.pet_id as string | undefined);
  if (!petId) {
    return { success: false, message: '还没有添加宠物' };
  }

  const days = Math.min(30, Math.max(1, (args.days as number) || 7));
  const since = new Date();
  since.setDate(since.getDate() - days);

  const { rows } = await pool.query(
    `SELECT spirit_level, appetite_level, poop_level, exercise_level, weight, note, created_at
     FROM pet_health_entries
     WHERE pet_id = $1 AND user_id = $2 AND created_at >= $3
     ORDER BY created_at DESC LIMIT $4`,
    [petId, context.userId, since.toISOString(), days]
  );

  if (rows.length === 0) {
    return { success: true, data: { checkins: [], message: `最近${days}天还没有打卡记录` } };
  }

  const summary = rows.map((r) => ({
    date: new Date(r.created_at).toLocaleDateString('zh-CN'),
    spirit: r.spirit_level,
    appetite: r.appetite_level,
    poop: r.poop_level,
    exercise: r.exercise_level,
    weight: r.weight ? `${r.weight}kg` : null,
    note: r.note,
  }));

  // 统计趋势
  const normalCount = summary.filter((c) =>
    c.spirit === '很好' || c.spirit === '正常'
  ).length;
  const trend = normalCount >= summary.length * 0.8 ? '稳定' : '需关注';

  return {
    success: true,
    data: {
      count: summary.length,
      trend,
      recentDays: days,
      checkins: summary.slice(0, 7),
    },
  };
});

// ========== 4. record_health_checkin ==========

registerTool('record_health_checkin', async (args, context): Promise<ToolResult> => {
  const petId = await getPetId(context, args.pet_id as string | undefined);
  if (!petId) {
    return { success: false, message: '还没有添加宠物，无法打卡' };
  }

  // 中文枚举 → 数值（pet_health_entries 的 *_level 为 smallint：1-5）
  // 精神/食欲/排便：1=很差 2=较差 3=正常 4=较好 5=很好；运动：1=较少 2=正常 3=充足
  const SPIRIT_MAP: Record<string, number> = { '很好': 5, '正常': 3, '一般': 2, '不太好': 1 };
  const APPETITE_MAP: Record<string, number> = { '很好': 5, '正常': 3, '一般': 2, '不太好': 1 };
  const POOP_MAP: Record<string, number> = { '正常': 3, '偏软': 4, '偏硬': 2, '拉稀': 1, '未排便': 1 };
  const EXERCISE_MAP: Record<string, number> = { '充足': 3, '正常': 2, '较少': 1, '未运动': 1 };

  const spirit = (args.spirit as string) || '正常';
  const appetite = (args.appetite as string) || '正常';
  const poop = (args.poop as string) || '正常';
  const exercise = (args.exercise as string) || '正常';
  const weight = args.weight ? Number(args.weight) : null;
  const note = (args.note as string) || null;

  // 未知枚举值回退到正常（3），避免 LLM 传了不在映射里的词导致 500
  const spiritLevel = SPIRIT_MAP[spirit] ?? 3;
  const appetiteLevel = APPETITE_MAP[appetite] ?? 3;
  const poopLevel = POOP_MAP[poop] ?? 3;
  const exerciseLevel = EXERCISE_MAP[exercise] ?? 2;

  // 判断是否有异常（精神/食欲≤2 或 排便异常），risk_level 用生产约束允许的枚举
  // （pet_health_entries_risk_level_check: low/medium/high/emergency，不是 caution/normal）
  const hasAnomaly = spiritLevel <= 2 || appetiteLevel <= 2 || poopLevel <= 2 || poop === '拉稀' || poop === '未排便';
  const riskLevel = hasAnomaly ? 'high' : 'low';

  // 检查今天是否已经打卡
  const today = beijingDateString(); // 审查⏳1：北京「今日」
  const { rows: existing } = await pool.query(
    `SELECT id FROM pet_health_entries
     -- 审查⏳1：AI 助手今日打卡判断按北京时区
      WHERE pet_id = $1 AND (created_at AT TIME ZONE 'Asia/Shanghai')::date = $2::date LIMIT 1`,
    [petId, today]
  );

  const id = uuidv4();
  await pool.query(
    `INSERT INTO pet_health_entries
      (id, pet_id, user_id, spirit_level, appetite_level, poop_level,
       exercise_level, weight, has_anomaly, risk_level, note)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [id, petId, context.userId, spiritLevel, appetiteLevel, poopLevel, exerciseLevel, weight, hasAnomaly, riskLevel, note]
  );

  const alreadyMsg = existing.length > 0 ? '（今天已有打卡记录，本次为追加记录）' : '';

  return {
    success: true,
    data: {
      message: `已记录${alreadyMsg}`,
      summary: `精神: ${spirit} | 食欲: ${appetite} | 排便: ${poop} | 运动: ${exercise}${weight ? ` | 体重: ${weight}kg` : ''}`,
      hasAnomaly,
      riskLevel,
    },
  };
});

// ========== 5. query_food_safety ==========

registerTool('query_food_safety', async (args, context): Promise<ToolResult> => {
  const foodName = (args.foodName as string).trim();
  if (!foodName) {
    return { success: false, message: '请提供食物名称' };
  }

  // 1. 先查知识库（权威数据）
  const { rows: knowledgeRows } = await pool.query(
    `SELECT food_name, safety_level, detail, dangerous_compounds, toxic_doses,
            symptoms, first_aid, species_applicable, aliases
     FROM pet_food_safety_knowledge
     WHERE food_name ILIKE $1
        OR $1 = ANY(aliases)
     LIMIT 1`,
    [foodName]
  );

  if (knowledgeRows.length > 0) {
    const k = knowledgeRows[0];
    const speciesLabel = k.species_applicable
      ? `适用：${k.species_applicable.includes('dog') ? '犬' : ''}${k.species_applicable.includes('cat') ? '猫' : ''}`
      : '';

    return {
      success: true,
      data: {
        foodName: k.food_name,
        safetyLevel: k.safety_level,
        detail: k.detail,
        dangerousCompounds: k.dangerous_compounds || [],
        toxicDoses: k.toxic_doses || '',
        symptoms: k.symptoms || [],
        firstAid: k.first_aid || '',
        speciesApplicable: k.species_applicable || [],
        aliases: k.aliases || [],
        source: 'knowledge_base',
      },
    };
  }

  // 2. 查用户历史查询记录（备用）
  const { rows: queryRows } = await pool.query(
    'SELECT * FROM pet_food_queries WHERE food_name ILIKE $1 LIMIT 1',
    [`%${foodName}%`]
  );

  if (queryRows.length > 0) {
    const q = queryRows[0];
    return {
      success: true,
      data: {
        foodName: q.food_name,
        safetyLevel: q.safety_level || null,
        detail: q.detail || '',
        dangerousCompounds: q.dangerous_compounds || [],
        symptoms: q.symptoms || [],
        firstAid: q.first_aid || '',
        source: 'user_history',
      },
    };
  }

  // 3. 知识库也没有 → 返回未找到，AI 可自行用知识回复
  return {
    success: true,
    data: {
      foodName,
      found: false,
      source: 'not_found',
      message: `"${foodName}"不在安全知识库中，请根据你的专业知识分析该食物对犬猫的安全性。`,
    },
  };
});

// ========== 6. check_symptom ==========

registerTool('check_symptom', async (args, context): Promise<ToolResult> => {
  const petId = await getPetId(context, args.pet_id as string | undefined);
  if (!petId) {
    return { success: false, message: '还没有添加宠物，无法进行症状分析' };
  }

  const symptom = (args.symptom as string).trim();
  const duration = (args.duration as string) || '未知';

  // ===== 紧急关键词检测（安全底线：自由文本最可靠的紧急信号，保持不变） =====
  const emergencyKeywords = ['抽搐', '昏迷', '呼吸困难', '吐血', '中毒', '车祸', '坠落', '瘫痪', '大出血', '休克'];
  const isEmergency = emergencyKeywords.some((kw) => symptom.includes(kw));

  if (isEmergency) {
    return {
      success: true,
      data: {
        riskLevel: 'emergency',
        message: '检测到紧急症状！请立即带宠物前往最近的宠物医院！',
        needHospital: true,
        emergency: true,
      },
    };
  }

  // ===== 图谱评估（设计 §8：聊天路径消费权威图谱，与症状初筛页判断一致） =====
  // 文本能映射到已知症状名 → 用图谱规则定级；映射不上 → 回落关键词兜底
  let riskLevel: 'warning' | 'caution' = 'caution';
  let ruleName: string | undefined;
  const graph = await loadActiveGraph();
  const mappedIds = graph ? mapSymptomTextToIds(graph, symptom) : [];
  if (graph && mappedIds.length > 0) {
    const evaluated = evaluateSymptomLevel(graph, mappedIds, duration === '未知' ? undefined : duration);
    if (evaluated.level === 'emergency') {
      return {
        success: true,
        data: {
          riskLevel: 'emergency',
          message: '检测到高风险症状组合！请尽快就医检查。这不是诊断，请咨询专业兽医。',
          needHospital: true,
          emergency: true,
        },
      };
    }
    if (evaluated.level === 'warning') {
      riskLevel = 'warning';
      ruleName = evaluated.ruleName;
    }
  }

  // ===== 关键词兜底（文本未映射到图谱症状时保持原逻辑） =====
  if (mappedIds.length === 0) {
    const warningKeywords = ['呕吐', '拉稀', '腹泻', '不吃', '发烧', '精神差', '便血', '尿血', '跛行', '肿胀'];
    if (warningKeywords.some((kw) => symptom.includes(kw))) {
      riskLevel = 'warning';
    }
  }

  // 记录症状检查
  const id = uuidv4();
  await pool.query(
    `INSERT INTO pet_symptom_checks
      (id, pet_id, user_id, symptoms, duration, risk_level, ai_advice, recommended_actions)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      id, petId, context.userId,
      [symptom], duration,
      riskLevel,
      riskLevel === 'warning'
        ? `根据症状"${symptom}"（持续${duration}），建议尽快就医检查。这不是诊断，请咨询专业兽医。${ruleName ? `（依据：${ruleName}）` : ''}`
        : `根据症状"${symptom}"（持续${duration}），建议密切观察。如果症状加重或持续超过24小时，请就医。`,
      riskLevel === 'warning'
        ? ['立即就医', '暂时禁食观察', '记录症状变化']
        : ['密切观察', '保持正常饮食', '如加重请就医'],
    ]
  );

  return {
    success: true,
    data: {
      riskLevel,
      message: riskLevel === 'warning'
        ? '建议尽快就医检查，这不是诊断，请咨询专业兽医。'
        : '建议密切观察，如果症状加重请及时就医。',
      needHospital: riskLevel === 'warning',
      disclaimer: '以上为 AI 辅助分析，不替代兽医诊断。',
    },
  };
});

// ========== 7. get_vaccine_calendar ==========

registerTool('get_vaccine_calendar', async (args, context): Promise<ToolResult> => {
  const petId = await getPetId(context, args.pet_id as string | undefined);
  if (!petId) {
    return { success: false, message: '还没有添加宠物' };
  }

  // 表名为 pet_vaccinations（对齐生产 schema；早期写成 pet_vaccines 导致表不存在）
  // 注意：该表无 vaccine_name 字段，疫苗名在 type 列（如"猫三联""狂犬疫苗"），category 为分类
  const { rows } = await pool.query(
    `SELECT type, category, date, next_date, status, notes
     FROM pet_vaccinations
     WHERE pet_id = $1 AND user_id = $2
     ORDER BY date ASC NULLS LAST`,
    [petId, context.userId]
  );

  if (rows.length === 0) {
    return { success: true, data: { vaccines: [], message: '还没有疫苗记录' } };
  }

  const now = new Date();
  const upcoming = rows.filter((r) => r.next_date && new Date(r.next_date) >= now);
  const overdue = rows.filter((r) => r.next_date && new Date(r.next_date) < now && r.status !== 'completed');

  return {
    success: true,
    data: {
      total: rows.length,
      upcoming: upcoming.map((r) => ({
        name: r.type || r.category || '疫苗',
        date: r.next_date,
        status: r.status,
        notes: r.notes,
      })),
      overdue: overdue.map((r) => ({
        name: r.type || r.category || '疫苗',
        date: r.next_date,
        status: r.status,
      })),
    },
  };
});

// ========== 8. get_health_trends ==========

registerTool('get_health_trends', async (args, context): Promise<ToolResult> => {
  const petId = await getPetId(context, args.pet_id as string | undefined);
  if (!petId) {
    return { success: false, message: '还没有添加宠物' };
  }

  const days = Math.min(90, Math.max(7, (args.days as number) || 30));
  const since = new Date();
  since.setDate(since.getDate() - days);

  const { rows } = await pool.query(
    `SELECT weight, spirit_level, appetite_level, poop_level, created_at
     FROM pet_health_entries
     WHERE pet_id = $1 AND user_id = $2 AND created_at >= $3
     ORDER BY created_at ASC`,
    [petId, context.userId, since.toISOString()]
  );

  if (rows.length === 0) {
    return { success: true, data: { message: `最近${days}天没有打卡记录，无法生成趋势` } };
  }

  // 体重趋势
  const weightData = rows
    .filter((r) => r.weight)
    .map((r) => ({
      date: new Date(r.created_at).toLocaleDateString('zh-CN'),
      weight: Number(r.weight),
    }));

  let weightTrend = '无数据';
  if (weightData.length >= 2) {
    const first = weightData[0].weight;
    const last = weightData[weightData.length - 1].weight;
    const diff = last - first;
    if (Math.abs(diff) < 0.3) weightTrend = '保持稳定';
    else if (diff > 0) weightTrend = `上升 ${diff.toFixed(1)}kg`;
    else weightTrend = `下降 ${Math.abs(diff).toFixed(1)}kg`;
  }

  // 精神/食欲趋势
  const scoreMap: Record<string, number> = { '很好': 4, '正常': 3, '一般': 2, '不太好': 1 };
  const recentSpirits = rows.slice(-7).map((r) => scoreMap[r.spirit_level] || 3);
  const recentAppetites = rows.slice(-7).map((r) => scoreMap[r.appetite_level] || 3);
  const avgSpirit = recentSpirits.reduce((a, b) => a + b, 0) / recentSpirits.length;
  const avgAppetite = recentAppetites.reduce((a, b) => a + b, 0) / recentAppetites.length;

  return {
    success: true,
    data: {
      totalRecords: rows.length,
      recentDays: days,
      weightTrend,
      weightHistory: weightData.slice(-10),
      spiritTrend: avgSpirit >= 3 ? '良好' : avgSpirit >= 2 ? '一般' : '需关注',
      appetiteTrend: avgAppetite >= 3 ? '良好' : avgAppetite >= 2 ? '一般' : '需关注',
    },
  };
});

// ========== 9. search_breed_info ==========

registerTool('search_breed_info', async (args, context): Promise<ToolResult> => {
  // String() 归一：LLM 偶发传数字/对象时 normalize 调 .replace 会抛 TypeError，这里兜底成字符串
  let breedName = String(args.breed ?? '').trim();

  // 如果没有指定品种，查询当前宠物品种
  if (!breedName && context.petId) {
    const { rows } = await pool.query(
      'SELECT breed FROM pet_profiles WHERE id = $1 AND user_id = $2',
      [context.petId, context.userId]
    );
    if (rows.length > 0) breedName = rows[0].breed;
  }

  if (!breedName) {
    return { success: false, message: '请提供品种名称' };
  }

  // 接服务端权威品种库（breed_knowledge 热更新表，空表惰性播种），按 name/aliases 归一匹配。
  // 命中 → 返回 breedId 并下发 breed_flow 动作，前端跳品种详情页（可再一键设为我的宠物品种）。
  // Array.isArray 守卫：管理端种子/历史行不经 isValidBreedData 校验，非数组时 for..of 会抛错，
  // 退化为「未命中引导」而非「工具执行失败」的通用报错。
  const latest = await breedRepository.getLatestBreeds();
  const rawBreeds = latest?.data?.breeds;
  const breeds = (Array.isArray(rawBreeds) ? rawBreeds : []) as Array<{ id: string; name: string; species: string; aliases?: string[] }>;
  const match = findBreedMatch(breeds, breedName);
  if (match) {
    const emoji = match.species === 'cat' ? '🐱' : '🐶';
    return {
      success: true,
      data: { action: 'breed_flow', breedId: match.id, breedName: match.name, species: match.species },
      message: `${emoji} 这是「${match.name}」的品种百科。已为你打开详情页，可查看体型/性格/常见病/喂养建议，也能一键把它设为你的宠物品种～`,
    };
  }

  // 未命中品种库：给出引导，避免把「查不到」误报成具体品种信息
  return {
    success: true,
    data: {
      found: false,
      breed: breedName,
    },
    message: `暂时没在品种百科里找到「${breedName}」的详细资料（可能是不常见品种或叫法不同），你可以换个常见叫法试试（如「英短」「金毛」），或去「品种百科」页面浏览完整列表。`,
  };
});

// ========== 10. get_family_pets ==========

registerTool('get_family_pets', async (args, context): Promise<ToolResult> => {
  const { rows } = await pool.query(
    `SELECT id, name, species, breed, gender, birth_date, weight
     FROM pet_profiles WHERE user_id = $1 ORDER BY created_at`,
    [context.userId]
  );

  if (rows.length === 0) {
    return { success: true, data: { pets: [], message: '还没有添加宠物' } };
  }

  const pets = rows.map((p) => {
    const age = p.birth_date
      ? `${Math.floor((Date.now() - new Date(p.birth_date).getTime()) / (365.25 * 24 * 60 * 60 * 1000))}岁`
      : '未知';
    return {
      id: p.id,
      name: p.name,
      species: p.species,
      breed: p.breed,
      gender: p.gender === 'male' ? '公' : p.gender === 'female' ? '母' : '未知',
      age,
      weight: p.weight ? `${p.weight}kg` : '未知',
      isActive: context.petId === p.id,
    };
  });

  return {
    success: true,
    data: {
      count: pets.length,
      activePet: pets.find((p) => p.isActive)?.name || pets[0]?.name,
      pets,
    },
  };
});

// ========== 11. record_feeding ==========

registerTool('record_feeding', async (args, context): Promise<ToolResult> => {
  const petId = await getPetId(context, args.pet_id as string | undefined);
  if (!petId) {
    return { success: false, message: '还没有添加宠物' };
  }

  const food = (args.food as string).trim();
  const note = (args.note as string) || null;

  // 记录到 pet_facts 中（作为喂养记录）
  // 注意：pet_facts.id 是 bigint 自增（nextval），不能传 uuid；省略 id 让序列自动生成
  await pool.query(
    `INSERT INTO pet_facts (pet_id, user_id, category, fact)
     VALUES ($1, $2, 'feeding', $3)`,
    [petId, context.userId, `${new Date().toLocaleDateString('zh-CN')} 喂了${food}${note ? `（${note}）` : ''}`]
  );

  return {
    success: true,
    data: {
      message: `已记录喂养：${food}${note ? `（${note}）` : ''}`,
    },
  };
});

// ========== 12. search_hospital ==========

registerTool('search_hospital', async (args, context): Promise<ToolResult> => {
  const isEmergency = args.emergency === true;

  // pet_hospitals 表在生产库不存在（早期迁移建表失败），医院数据为前端静态内容。
  // 这里不查库，直接给出就医指引（紧急/非紧急两种话术），避免查询不存在的表导致 500。
  if (isEmergency) {
    return {
      success: true,
      data: {
        emergency: true,
        message: '⚠️ 情况紧急，请立即带宠物前往最近的宠物医院或 24 小时急诊！可在微信或地图 App 搜索"宠物医院"，优先选择有急诊标注的。若宠物有中毒、大出血、抽搐等紧急情况，请直接联系就近医院并说明症状。',
      },
    };
  }

  return {
    success: true,
    data: {
      emergency: false,
      message: '可以在微信或地图 App 搜索"宠物医院"查看附近的医院与评分。建议优先选择：① 24 小时营业的急诊医院 ② 有宠物专科的医院 ③ 距你家近、口碑好的。需要我帮你查某类症状对应的科室建议吗？',
    },
  };
});

// ========== 13. start_naming ==========

registerTool('start_naming', async (args, context): Promise<ToolResult> => {
  return {
    success: true,
    data: { action: 'naming_flow' },
    message: '我来帮你为宠物取个好名字！请上传一张宠物的照片，或者告诉我宠物的品种和特征～',
  };
});

// ========== 14. start_checkin ==========

registerTool('start_checkin', async (args, context): Promise<ToolResult> => {
  return {
    success: true,
    data: { action: 'checkin_flow' },
    message: '好的，现在来记录今天的健康状态吧！',
  };
});

// ========== 15. record_memory ==========

registerTool('record_memory', async (args, context): Promise<ToolResult> => {
  const petId = await getPetId(context, args.pet_id as string | undefined);
  if (!petId) {
    return { success: false, message: '还没有添加宠物，无法记录回忆' };
  }

  const content = (args.content as string)?.trim();

  // 分支 A：LLM 已从用户消息中提取回忆内容 → 直接写入数据库
  if (content) {
    const { rows: petRows } = await pool.query(
      'SELECT name, species FROM pet_profiles WHERE id = $1 AND user_id = $2',
      [petId, context.userId]
    );
    const petName = petRows[0]?.name || '宠物';
    const petEmoji = petRows[0]?.species === 'cat' ? '🐱' : '🐶';

    const momentId = uuidv4();
    await pool.query(
      `INSERT INTO pet_moments (id, user_id, pet_id, type, content, photos)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        momentId,
        context.userId,
        petId,
        'memory',
        JSON.stringify({ petName, petEmoji, description: content }),
        [],
      ]
    );

    return {
      success: true,
      data: { saved: true, momentId },
      message: `回忆已记录 ✦\n\n"${content}"\n\n已保存到「时光」页面，你可以去查看哦～`,
    };
  }

  // 分支 B：用户未提供具体内容 → 触发前端回忆录制流程
  return {
    success: true,
    data: { action: 'memory_flow' },
    message: '好的，进入回忆录制模式 ✦\n\n请在下方输入框写一段话描述这段回忆，也可以先上传一张照片，我会在你输入完成后保存到「时光」页面。',
  };
});

// ========== 16. get_chronic_advice（AI 慢病管理建议，会员专属） ==========
// 复用 chronicAiService.analyzeChronicAdvice：后端从 pet_chronic_records 权威读取慢病数据，
// 注入宠物档案/打卡/记忆后生成管理建议。Agent 场景下由工具内部调用，无会员校验（聊天本身已登录）。

registerTool('get_chronic_advice', async (args, context): Promise<ToolResult> => {
  const petId = await getPetId(context, args.pet_id as string | undefined);
  if (!petId) {
    return { success: false, message: '还没有添加宠物' };
  }
  const { analyzeChronicAdvice } = await import('./chronicAiService.js');
  try {
    const result = await analyzeChronicAdvice(context.userId, petId, {
      focus: (args.focus as string) || undefined,
    });
    if (result.unsafe) {
      return { success: false, message: '本次分析未通过安全校验，请稍后再试' };
    }
    return { success: true, data: { aiAdvice: result.aiAdvice } };
  } catch (err) {
    return { success: false, message: `慢病管理建议生成失败：${err instanceof Error ? err.message : '未知错误'}` };
  }
});

// ========== 17. get_feeding_advice（AI 个性化喂养建议，会员专属） ==========
// 复用 feedingAiService.analyzeFeedingAdvice：注入宠物档案/喂养记录/记忆后生成喂食建议。

registerTool('get_feeding_advice', async (args, context): Promise<ToolResult> => {
  const petId = await getPetId(context, args.pet_id as string | undefined);
  if (!petId) {
    return { success: false, message: '还没有添加宠物' };
  }

  // 读取宠物档案（供前端画像 + 后端权威覆盖）
  const { rows } = await pool.query(
    'SELECT id, name, species, breed, birth_date, weight, is_neutered FROM pet_profiles WHERE id = $1 AND user_id = $2',
    [petId, context.userId]
  );
  if (rows.length === 0) {
    return { success: false, message: '宠物不存在' };
  }
  const pet = rows[0];

  const { analyzeFeedingAdvice } = await import('./feedingAiService.js');
  try {
    const result = await analyzeFeedingAdvice(context.userId, petId, {
      petName: pet.name || '',
      species: pet.species === 'dog' ? 'dog' : 'cat',
      breed: pet.breed || '',
      ageMonths: pet.birth_date ? Math.max(0, Math.floor((Date.now() - new Date(pet.birth_date).getTime()) / (1000 * 60 * 60 * 24 * 30))) : 0,
      weight: Number(pet.weight) || 0,
      bodyCondition: 'normal',
      isPuppyKitten: false,
      isSenior: false,
      isNeutered: Boolean(pet.is_neutered),
      chronicConditions: [],
      allergies: [],
      currentAdvice: '',
    });
    if (result.unsafe) {
      return { success: false, message: '本次分析未通过安全校验，请稍后再试' };
    }
    return { success: true, data: { aiAdvice: result.aiAdvice } };
  } catch (err) {
    return { success: false, message: `喂养建议生成失败：${err instanceof Error ? err.message : '未知错误'}` };
  }
});

// ========== 18. scan_chronic_risk（慢病风险扫描，会员专属） ==========
// 复用 chronicRiskService.scanChronicRisk：L2 规则预警 + L3 AI 疑似识别（仅疑似/建议排查）。

registerTool('scan_chronic_risk', async (args, context): Promise<ToolResult> => {
  const petId = await getPetId(context, args.pet_id as string | undefined);
  if (!petId) {
    return { success: false, message: '还没有添加宠物' };
  }
  const { scanChronicRisk } = await import('./chronicRiskService.js');
  try {
    const result = await scanChronicRisk(context.userId, petId);
    if (result.unsafe) {
      return { success: false, message: '本次风险分析未通过安全校验，请稍后再试' };
    }
    return {
      success: true,
      data: { signals: result.signals, aiInsight: result.aiInsight },
    };
  } catch (err) {
    return { success: false, message: `风险扫描失败：${err instanceof Error ? err.message : '未知错误'}` };
  }
});

console.log('[Agent Tools] 18 个工具已注册完成');