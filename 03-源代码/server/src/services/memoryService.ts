/**
 * memory-body 记忆引擎 — Agent 核心壁垒
 *
 * 五层架构：
 *   1. memoryIngestor  — 摄入：从对话自动提取结构化记忆
 *   2. memoryGraph     — 图谱：记忆关联、矛盾检测、模式发现
 *   3. memoryRetrieval — 检索：按语义相关性 + 时效性 + 重要性检索
 *   4. memoryEvolution — 演化：置信度调整、记忆合并、关键转折点
 *   5. memoryDecay     — 衰减：不重要记忆自然降级，重要记忆加固
 */
import { pool } from '../db.js';
import { config } from '../config.js';
import { ChatSessionRepository } from '../repositories/chatSessionRepository.js';

/** 聊天会话仓库单例（saveConversation 内部维护会话计数/标题用） */
const chatSessionRepo = new ChatSessionRepository();

// ========== 类型定义 ==========

export interface MemoryEntry {
  id?: number;
  userId: string;
  petId: string | null;
  category: MemoryCategory;
  key: string;
  content: string;
  importance: number;
  confidence: number;
  source: 'auto' | 'manual' | 'contradiction_resolved';
  evidence: string[];
  decayRate: number;
  status: 'active' | 'dormant' | 'expired' | 'contradicted';
  meta: Record<string, unknown>;
}

export type MemoryCategory =
  | 'health'        // 健康相关（症状、体征、趋势）
  | 'behavior'      // 行为习惯（作息、活动）
  | 'habit'         // 日常生活习惯（如早上7点遛狗）
  | 'preference'    // 偏好（喜欢/讨厌的食物、玩具等）
  | 'event'         // 重要事件（就医、生日、旅行）
  | 'feeding'       // 喂养记录模式
  | 'medical'       // 医疗记录（疫苗、手术、用药）
  | 'contradiction' // 矛盾记忆（同一事物有冲突记录）
  | 'general';      // 通用

export interface ExtractedFact {
  category: MemoryCategory;
  key: string;
  content: string;
  importance: number;
  evidence: string[];
}

export interface ContradictionResult {
  found: boolean;
  existing: MemoryEntry | null;
  newContent: string;
  newEvidence: string;
  action: 'confirm_new' | 'keep_old' | 'unresolved';
}

export interface MemoryContext {
  /** 注入系统提示词的相关记忆 */
  memories: string;
  /** 发现的矛盾警告 */
  contradictions: string;
  /** 健康趋势洞察 */
  healthInsights: string;
  /** 本次对话中提取的新事实 */
  extractedFacts: ExtractedFact[];
}

export interface HealthInsight {
  type: 'trend' | 'anomaly' | 'milestone' | 'reminder';
  title: string;
  description: string;
  severity: 'info' | 'caution' | 'warning';
}

// ========== API 调用辅助 ==========

function getApiKey(): string {
  return config.ai?.apiKey || '';
}

/** 返回已配置的模型服务地址（config 已保证非空兜底为火山方舟默认值） */
function getBaseUrl(): string {
  return config.ai?.baseUrl || '';
}

/** 返回已配置的模型名（config 已保证非空兜底为 deepseek-v4-flash-ga-260731） */
function getModel(): string {
  return config.ai?.model || '';
}

/** 调用 LLM 做结构化提取（轻量级，temperature=0） */
async function callLLMForExtraction(
  systemPrompt: string,
  userContent: string,
): Promise<string | null> {
  const apiKey = getApiKey();
  if (!apiKey) return null;

  try {
    const response = await fetch(`${getBaseUrl()}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: getModel(),
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userContent },
        ],
        temperature: 0,
        max_tokens: 800,
      }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) return null;
    const data = (await response.json()) as {
      choices: Array<{ message: { content: string } }>;
    };
    return data.choices[0]?.message?.content || null;
  } catch {
    return null;
  }
}

// ============================================================================
// 1. memoryIngestor — 从对话自动提取结构化记忆
// ============================================================================

/**
 * 从一轮对话中提取可持久化的记忆事实
 * 每次 Agent 回复完成后调用，异步执行不阻塞用户
 */
export async function ingestMemories(
  userId: string,
  petId: string,
  userMessage: string,
  assistantMessage: string,
  existingMemories: MemoryEntry[],
): Promise<ExtractedFact[]> {
  const apiKey = getApiKey();
  if (!apiKey) return [];

  const existingContext = existingMemories.length > 0
    ? existingMemories
        .slice(0, 20)
        .map((m) => `  [${m.category}] ${m.key}: ${m.content}`)
        .join('\n')
    : '（暂无已有记忆）';

  const systemPrompt = `你是宠物记忆提取器。从用户和AI助手的对话中，提取值得长期记住的信息。

## 分类标准
- health: 症状、体征、健康变化（如"上周开始掉毛"）
- behavior: 行为习惯变化（如"最近不爱出门散步"）
- habit: 日常生活规律（如"每天早上7点遛狗"）
- preference: 喜好（如"喜欢吃牛肉"、"讨厌洗澡"）
- event: 重要事件（如"上周六打了疫苗"）
- feeding: 喂养记录（如"现在每天吃200g狗粮"）
- medical: 医疗相关（如"上次体检医生说心脏有点杂音"）
- general: 其他值得记住的信息

## 规则
1. 只提取 NEW 信息（与已有记忆不重复）
2. 只提取 FACTS，不提取观点或建议
3. 每条信息必须是将来有用的长期记忆
4. importance 1-10：8-10=医疗/重要事件，5-7=健康/行为变化，1-4=日常偏好/习惯
5. 能明确时间的事件必须像这样标注：{date: "2026-03-15", event: "疫苗"}

## 输出格式（纯 JSON 数组）
[{"category":"类型","key":"唯一键_英文snake_case","content":"记忆内容","importance":5,"evidence":["原对话中的证据片段"]}]

## 已有记忆（勿重复）
${existingContext}

## 对话
用户: ${userMessage}
助手: ${assistantMessage}

只输出 JSON 数组，如果无需提取则输出 []。`;

  const result = await callLLMForExtraction(systemPrompt, `${userMessage}\n${assistantMessage}`);
  if (!result) return [];

  try {
    const jsonStr = result.replace(/```json\s*|```/g, '').trim();
    const facts: ExtractedFact[] = JSON.parse(jsonStr);
    if (!Array.isArray(facts)) return [];

    const validFacts = facts.filter(
      (f) => f.category && f.key && f.content && typeof f.importance === 'number',
    );

    // 写入数据库
    for (const fact of validFacts) {
      await upsertMemory(userId, petId, fact);
    }

    return validFacts;
  } catch {
    return [];
  }
}

/** UPSERT 记忆（新记忆覆盖旧同 key 记忆） */
async function upsertMemory(
  userId: string,
  petId: string,
  fact: ExtractedFact,
): Promise<void> {
  try {
    // F4 分层：重要度 ≥7 的记忆自动进入核心层（回忆录素材库）；否则流水层（可衰减）
    const level = fact.importance >= 7 ? 'core' : 'flow';
    // 按分类映射回忆标签（medical/health → health_heal；其余暂空，后续 AI 辅助打标）
    const tags = fact.category === 'medical' || fact.category === 'health'
      ? ['health_heal']
      : [];
    await pool.query(
      `INSERT INTO agent_memories
         (user_id, pet_id, category, key, content, importance, confidence, source, evidence, meta, tags, level)
       VALUES ($1,$2,$3,$4,$5,$6,0.8,'auto',$7,$8,$9,$10)
       ON CONFLICT (user_id, pet_id, key)
       DO UPDATE SET
         content = EXCLUDED.content,
         importance = GREATEST(agent_memories.importance, EXCLUDED.importance),
         confidence = LEAST(1.0, agent_memories.confidence + 0.1),
         evidence = agent_memories.evidence || EXCLUDED.evidence,
         tags = agent_memories.tags || EXCLUDED.tags,
         level = CASE WHEN agent_memories.level = 'core' OR EXCLUDED.importance >= 7 THEN 'core' ELSE 'flow' END,
         updated_at = now()`,
      [
        userId,
        petId,
        fact.category,
        fact.key,
        fact.content,
        fact.importance,
        fact.evidence,
        JSON.stringify({ extractedAt: new Date().toISOString() }),
        tags,
        level,
      ],
    );
  } catch {
    // 静默失败，不阻塞对话
  }
}

// ============================================================================
// 2. memoryGraph — 矛盾检测 & 模式发现
// ============================================================================

/**
 * 检测用户新输入是否与已有记忆矛盾
 */
export async function detectContradiction(
  userId: string,
  petId: string,
  userMessage: string,
): Promise<ContradictionResult[]> {
  const apiKey = getApiKey();
  if (!apiKey) return [];

  // 获取相关记忆
  const memories = await getActiveMemories(userId, petId);
  if (memories.length === 0) return [];

  const memoryContext = memories
    .slice(0, 30)
    .map((m) => `[${m.category}:${m.key}] ${m.content} (置信度:${m.confidence.toFixed(1)})`)
    .join('\n');

  const systemPrompt = `你是矛盾检测器。判断用户新输入是否与已有记忆矛盾。

## 规则
1. 只有直接矛盾才算（如"豆豆喜欢牛肉" vs "豆豆不吃牛肉"）
2. 信息补充不算矛盾（如"以前每天吃200g" vs "现在每天吃250g"）
3. 每对矛盾标注：confirm_new=新信息更可信, keep_old=旧记忆保留, unresolved=无法判断

## 已有记忆
${memoryContext}

## 用户新输入
${userMessage}

## 输出格式（纯 JSON 数组）
[{"existing_key":"冲突的已有记忆key","existing_memory":"已有记忆内容","new_content":"新的说法","new_evidence":"用户原始语句","action":"confirm_new|keep_old|unresolved"}]
如果无矛盾输出 []。`;

  const result = await callLLMForExtraction(systemPrompt, userMessage);
  if (!result) return [];

  try {
    const jsonStr = result.replace(/```json\s*|```/g, '').trim();
    const contradictions = JSON.parse(jsonStr);
    if (!Array.isArray(contradictions)) return [];

    const results: ContradictionResult[] = [];
    for (const c of contradictions) {
      const existing = memories.find((m) => m.key === c.existing_key);
      results.push({
        found: true,
        existing: existing || null,
        newContent: c.new_content || '',
        newEvidence: c.new_evidence || '',
        action: c.action || 'unresolved',
      });

      // 标记旧记忆状态
      if (existing?.id) {
        await pool.query(
          `UPDATE agent_memories SET status = 'contradicted', updated_at = now()
           WHERE id = $1`,
          [existing.id],
        );
      }

      // 如果是 confirm_new，创建新记忆替代
      if (c.action === 'confirm_new' && c.new_content) {
        await pool.query(
          `INSERT INTO agent_memories
             (user_id, pet_id, category, key, content, importance, confidence, source, evidence, status, meta)
           VALUES ($1,$2,'contradiction',$3,$4,$5,0.7,'contradiction_resolved',$6,'active',$7)
           ON CONFLICT (user_id, pet_id, key) DO UPDATE SET
             content = EXCLUDED.content,
             importance = EXCLUDED.importance,
             source = 'contradiction_resolved',
             updated_at = now()`,
          [
            userId,
            petId,
            c.existing_key + '_v2',
            c.new_content,
            existing?.importance || 5,
            [c.new_evidence],
            JSON.stringify({ resolvedAt: new Date().toISOString(), replacedKey: c.existing_key }),
          ],
        );
      }
    }

    return results;
  } catch {
    return [];
  }
}

// ============================================================================
// 3. memoryRetrieval — 智能检索
// ============================================================================

/**
 * 获取当前活跃的记忆（用于注入系统提示词）
 * 策略：重要性高 + 最近被检索过 + 非衰减状态
 */
export async function getActiveMemories(
  userId: string,
  petId: string,
  limit = 30,
): Promise<MemoryEntry[]> {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM agent_memories
       WHERE user_id = $1 AND pet_id = $2 AND status = 'active'
       ORDER BY importance DESC, last_recalled DESC NULLS LAST, created_at DESC
       LIMIT $3`,
      [userId, petId, limit],
    );

    return rows.map(rowToMemoryEntry);
  } catch {
    return [];
  }
}

/**
 * 症状分析记忆召回（带闸门，见 设计方案-2026-08-22 第六章 6.3）
 * 只召回：health/medical 类 + active + importance≥5 + 近90天 + 内容命中症状关键词
 * 用途：AI 深度分析/症状初筛的"类人背景"，只作展示（basis='record'），不参与 riskLevel 推导
 * @param userId - 用户 ID
 * @param petId - 宠物 ID
 * @param keywords - 召回关键词（症状中文名等）
 * @param limit - 返回条数上限
 * @returns 召回的记忆（含内容/重要度/分类/时间）
 */
export async function recallHealthMemories(
  userId: string,
  petId: string,
  keywords: string[],
  limit = 5,
): Promise<Array<{ content: string; importance: number; category: string; created_at: string }>> {
  try {
    if (keywords.length === 0) return [];
    // 转义 ILIKE 通配符（%/_），防止用户可控关键词（如 "100%"）变成宽匹配（审查项修复）
    const escaped = keywords.map((k) => k.replace(/[\\%_]/g, (m) => '\\' + m));
    const { rows } = await pool.query(
      `SELECT content, importance, category, created_at
       FROM agent_memories
       WHERE user_id = $1 AND pet_id = $2
         AND status = 'active'
         AND category IN ('health', 'medical')
         AND importance >= 5
         AND created_at >= NOW() - INTERVAL '90 days'
         AND content ILIKE ANY($3::text[])
       ORDER BY importance DESC, created_at DESC
       LIMIT $4`,
      [userId, petId, escaped.map((k) => `%${k}%`), limit],
    );
    return rows;
  } catch {
    // 记忆召回失败不阻塞主流程（降级为无记忆）
    return [];
  }
}

function rowToMemoryEntry(row: Record<string, unknown>): MemoryEntry {
  return {
    id: row.id as number,
    userId: row.user_id as string,
    petId: row.pet_id as string | null,
    category: row.category as MemoryCategory,
    key: row.key as string,
    content: row.content as string,
    importance: row.importance as number,
    confidence: row.confidence as number,
    source: row.source as MemoryEntry['source'],
    evidence: (row.evidence as string[]) || [],
    decayRate: row.decay_rate as number,
    status: row.status as MemoryEntry['status'],
    meta: (row.meta as Record<string, unknown>) || {},
  };
}

/**
 * 构建 Agent 对话的记忆上下文
 * 检索：语义相关 + 重要性 + 时效性
 */
export async function buildMemoryContext(
  userId: string,
  petId: string,
  userMessage: string,
): Promise<MemoryContext> {
  const memories = await getActiveMemories(userId, petId);

  // 按类别分组记忆
  const byCategory = new Map<MemoryCategory, MemoryEntry[]>();
  for (const m of memories) {
    if (!byCategory.has(m.category)) byCategory.set(m.category, []);
    byCategory.get(m.category)!.push(m);
  }

  // 构建记忆文本（优先重要度高 + 记录总数不超过 20 条）
  const memoryLines: string[] = [];
  const categoryOrder: MemoryCategory[] = ['medical', 'health', 'contradiction', 'habit', 'preference', 'feeding', 'behavior', 'event', 'general'];
  for (const cat of categoryOrder) {
    const catMemories = byCategory.get(cat);
    if (!catMemories) continue;
    for (const m of catMemories.slice(0, 5)) {
      memoryLines.push(`- [${m.category}] ${m.content}（重要性:${m.importance}）`);
    }
  }
  const memoriesText = memoryLines.slice(0, 20).join('\n');

  // 健康趋势洞察
  const healthInsights = await generateHealthInsights(userId, petId);

  // 标记这些记忆为 "已检索"
  const memoryIds = memories.slice(0, 20).filter((m) => m.id).map((m) => m.id!);
  if (memoryIds.length > 0) {
    try {
      await pool.query(
        `UPDATE agent_memories SET last_recalled = now()
         WHERE id = ANY($1::bigint[])`,
        [memoryIds],
      );
    } catch {
      // 静默
    }
  }

  return {
    memories: memoriesText,
    contradictions: '',
    healthInsights,
    extractedFacts: [],
  };
}

// ============================================================================
// 4. 健康趋势洞察生成
// ============================================================================

async function generateHealthInsights(
  userId: string,
  petId: string,
): Promise<string> {
  try {
    // 读取最近 60 天打卡记录
    const { rows } = await pool.query(
      `SELECT spirit_level, appetite_level, poop_level, exercise_level, weight, note, created_at
       FROM pet_health_entries
       WHERE pet_id = $1 AND user_id = $2 AND created_at >= NOW() - INTERVAL '60 days'
       ORDER BY created_at ASC`,
      [petId, userId],
    );

    if (rows.length < 3) return '';

    const insights: HealthInsight[] = [];

    // 体重趋势
    const weights = rows.filter((r: Record<string, unknown>) => r.weight).map((r: Record<string, unknown>) => Number(r.weight));
    if (weights.length >= 3) {
      const first = weights[0];
      const last = weights[weights.length - 1];
      const diff = last - first;
      if (Math.abs(diff) > 1) {
        insights.push({
          type: 'trend',
          title: '体重变化',
          description: `近60天体重从${first}kg变为${last}kg（${diff > 0 ? '+' : ''}${diff.toFixed(1)}kg）`,
          severity: Math.abs(diff) > 3 ? 'warning' : 'info',
        });
      }
    }

    // 异常天数统计
    const scoreMap: Record<string, number> = { '很好': 4, '正常': 3, '一般': 2, '不太好': 1 };
    const abnormalDays = rows.filter((r: Record<string, unknown>) => {
      const s = scoreMap[r.spirit_level as string] || 3;
      const a = scoreMap[r.appetite_level as string] || 3;
      return s <= 2 || a <= 2;
    });

    if (abnormalDays.length > rows.length * 0.3) {
      insights.push({
        type: 'anomaly',
        title: '异常频率偏高',
        description: `近60天中${abnormalDays.length}/${rows.length}天有异常指标，占比${Math.round((abnormalDays.length / rows.length) * 100)}%`,
        severity: abnormalDays.length > rows.length * 0.5 ? 'warning' : 'caution',
      });
    }

    // 连续异常
    let consecutiveAbnormal = 0;
    let maxConsecutive = 0;
    for (const r of rows) {
      const s = scoreMap[r.spirit_level as string] || 3;
      const a = scoreMap[r.appetite_level as string] || 3;
      if (s <= 2 || a <= 2) {
        consecutiveAbnormal++;
        maxConsecutive = Math.max(maxConsecutive, consecutiveAbnormal);
      } else {
        consecutiveAbnormal = 0;
      }
    }

    if (maxConsecutive >= 3) {
      insights.push({
        type: 'anomaly',
        title: '连续异常',
        description: `最多连续${maxConsecutive}天出现异常指标`,
        severity: 'warning',
      });
    }

    // 疫苗逾期检测
    const { rows: vaccines } = await pool.query(
      `SELECT vaccine_name, scheduled_date
       FROM pet_vaccines
       WHERE pet_id = $1 AND user_id = $2 AND status != 'completed'
         AND scheduled_date < NOW() - INTERVAL '7 days'
       ORDER BY scheduled_date ASC`,
      [petId, userId],
    );

    if (vaccines.length > 0) {
      const overdueList = vaccines.map((v: Record<string, unknown>) =>
        `${v.vaccine_name}（${new Date(v.scheduled_date as string).toLocaleDateString('zh-CN')}到期）`,
      ).join('、');
      insights.push({
        type: 'reminder',
        title: '疫苗逾期',
        description: `${overdueList}已逾期，建议尽快安排`,
        severity: 'warning',
      });
    }

    if (insights.length === 0) return '';

    return '## 健康洞察（从历史数据自动分析）\n' +
      insights.map((i) => {
        const icon = i.severity === 'warning' ? '⚠️' : i.severity === 'caution' ? '⚡' : 'ℹ️';
        return `${icon} **${i.title}**：${i.description}`;
      }).join('\n');
  } catch {
    return '';
  }
}

// ============================================================================
// 5. memoryDecay — 衰减管理
// ============================================================================

/**
 * 执行记忆衰减（建议通过定时任务每天调用一次）
 * 规则：
 *  - importance 1-3：30天无检索 → dormant
 *  - importance 4-6：60天无检索 → dormant
 *  - importance 7-10：120天无检索 → dormant
 *  - dormant 180天 → expired
 */
export async function runMemoryDecay(): Promise<{ dormanted: number; expired: number }> {
  let dormanted = 0;
  let expired = 0;

  try {
    // 低重要性记忆 → dormant
    const { rowCount: d1 } = await pool.query(
      `UPDATE agent_memories SET status = 'dormant', updated_at = now()
       WHERE status = 'active'
         AND importance <= 3
         AND (last_recalled IS NULL OR last_recalled < NOW() - INTERVAL '30 days')
         AND created_at < NOW() - INTERVAL '30 days'`,
    );
    dormanted += d1 || 0;

    // 中重要性记忆 → dormant
    const { rowCount: d2 } = await pool.query(
      `UPDATE agent_memories SET status = 'dormant', updated_at = now()
       WHERE status = 'active'
         AND importance BETWEEN 4 AND 6
         AND (last_recalled IS NULL OR last_recalled < NOW() - INTERVAL '60 days')
         AND created_at < NOW() - INTERVAL '60 days'`,
    );
    dormanted += d2 || 0;

    // 高重要性记忆 → dormant
    const { rowCount: d3 } = await pool.query(
      `UPDATE agent_memories SET status = 'dormant', updated_at = now()
       WHERE status = 'active'
         AND importance >= 7
         AND (last_recalled IS NULL OR last_recalled < NOW() - INTERVAL '120 days')
         AND created_at < NOW() - INTERVAL '120 days'`,
    );
    dormanted += d3 || 0;

    // 休眠 → 过期
    const { rowCount: exh } = await pool.query(
      `UPDATE agent_memories SET status = 'expired', updated_at = now()
       WHERE status = 'dormant'
         AND updated_at < NOW() - INTERVAL '180 days'`,
    );
    expired += exh || 0;

    return { dormanted, expired };
  } catch {
    return { dormanted, expired };
  }
}

// ============================================================================
// 6. 对话持久化
// ============================================================================

/**
 * 保存一条对话消息
 * @param sessionId - 会话 id（多会话改造后新增）：非空时消息归入该会话，并维护会话计数/触达/标题
 */
export async function saveConversation(
  userId: string,
  petId: string | null,
  role: 'user' | 'assistant',
  content: string,
  metadata?: Record<string, unknown>,
  sessionId?: string | null,
): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO agent_conversations (user_id, pet_id, role, content, metadata, session_id)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [userId, petId, role, content.substring(0, 2000), JSON.stringify(metadata || {}), sessionId ?? null],
    );
    // 会话维护：有 sessionId 时消息计数 +1 并触达（列表排序 + 软提示阈值依据）
    if (sessionId) {
      await chatSessionRepo.touchSession(sessionId, 1);
      // 首条用户消息：把默认标题「新的对话」更新为消息截断（清洗空白，20 字封顶）
      if (role === 'user') {
        const cleanTitle = content.replace(/\s+/g, ' ').trim().substring(0, 20);
        await chatSessionRepo.updateTitleIfDefault(sessionId, cleanTitle || '新的对话');
      }
    }
  } catch {
    // 静默
  }
}

/**
 * 加载最近的对话历史
 * @param sessionId - 会话 id：非空时按会话隔离查询（附 user_id 校验防横向越权）；空时回退旧行为（按 user+pet 查）
 */
export async function loadConversationHistory(
  userId: string,
  petId: string | null,
  limit = 20,
  sessionId?: string | null,
): Promise<Array<{ role: 'user' | 'assistant'; content: string }>> {
  try {
    const { rows } = sessionId
      ? await pool.query(
          `SELECT role, content FROM agent_conversations
           WHERE session_id = $1 AND user_id = $2
           ORDER BY created_at DESC LIMIT $3`,
          [sessionId, userId, limit],
        )
      : await pool.query(
          `SELECT role, content FROM agent_conversations
           WHERE user_id = $1 AND pet_id = $2
           ORDER BY created_at DESC LIMIT $3`,
          [userId, petId, limit],
        );

    return rows
      .reverse()
      .map((r: Record<string, unknown>) => ({
        role: r.role as 'user' | 'assistant',
        content: r.content as string,
      }));
  } catch {
    return [];
  }
}

/**
 * 列出用户的记忆（可按宠物过滤，用于用户查看/纠错）
 * 状态排序：active 优先，其次 dormant/contradicted/expired
 */
export async function listUserMemories(
  userId: string,
  petId?: string | null,
): Promise<MemoryEntry[]> {
  try {
    const params: string[] = [userId];
    let petClause = '';
    if (petId) {
      params.push(petId);
      petClause = ' AND pet_id = $2';
    }
    const { rows } = await pool.query(
      `SELECT * FROM agent_memories
       WHERE user_id = $1${petClause}
       ORDER BY
         CASE status WHEN 'active' THEN 0 WHEN 'contradicted' THEN 1 WHEN 'dormant' THEN 2 ELSE 3 END,
         importance DESC,
         updated_at DESC
       LIMIT 200`,
      params,
    );
    return rows.map(rowToMemoryEntry);
  } catch {
    return [];
  }
}

/**
 * 修正记忆内容（用户手动纠错，source 标记为 manual 防止被自动提取覆盖）
 * 归属校验：记忆必须属于当前用户
 * @returns 是否更新成功（false = 记忆不存在或不属于当前用户）
 */
export async function updateUserMemory(
  userId: string,
  memoryId: number,
  content: string,
): Promise<boolean> {
  try {
    const trimmed = content.trim();
    if (!trimmed) return false;
    const { rowCount } = await pool.query(
      `UPDATE agent_memories
       SET content = $3,
           source = 'manual',
           status = 'active',
           importance = GREATEST(importance, 6),
           updated_at = now()
       WHERE id = $1 AND user_id = $2
       RETURNING id`,
      [memoryId, userId, trimmed.slice(0, 2000)],
    );
    return (rowCount ?? 0) > 0;
  } catch {
    return false;
  }
}

// ============================================================================
// 7. 记忆总结 — 生成"关于这只宠物我知道什么"
// ============================================================================

/** 生成宠物的综合记忆摘要（用于首次对话注入） */
export async function summarizePetMemory(
  userId: string,
  petId: string,
): Promise<string> {
  const memories = await getActiveMemories(userId, petId, 50);
  if (memories.length === 0) return '';

  const byCategory = new Map<MemoryCategory, string[]>();
  for (const m of memories) {
    if (!byCategory.has(m.category)) byCategory.set(m.category, []);
    byCategory.get(m.category)!.push(m.content);
  }

  const categoryLabels: Record<MemoryCategory, string> = {
    health: '健康记录',
    medical: '医疗记录',
    behavior: '行为习惯',
    habit: '日常规律',
    preference: '偏好',
    feeding: '喂养',
    event: '重要事件',
    contradiction: '已解决的认识变化',
    general: '其他',
  };

  const sections: string[] = [];
  for (const [cat, items] of byCategory) {
    if (items.length === 0) continue;
    sections.push(`### ${categoryLabels[cat]}\n${items.map((i) => `- ${i}`).join('\n')}`);
  }

  return sections.join('\n\n');
}

/**
 * 记录健康事件记忆（回忆录 2.0 F1：打卡异常/症状初筛自动沉淀）
 * 宠物不舒服时自动写记忆（importance 高），后续 Agent 对话能"记得"生病历史，
 * 回忆录也能从记忆里筛出健康时刻。
 * 幂等：同类事件当天一条（UPSERT by user_id+pet_id+key），避免记忆膨胀。
 * @param params - 健康事件参数
 */
export async function recordHealthMemory(params: {
  userId: string;
  petId: string;
  /** medical=症状/就医；health=打卡异常/日常健康 */
  category: 'medical' | 'health';
  /** 记忆内容（含日期/异常项/建议，供 Agent 和回忆录使用） */
  content: string;
  /** 重要度 1-10（按紧急程度：emergency=10 → 一般=7） */
  importance?: number;
  /** 溯源（打卡/初筛记录 ID，可回溯） */
  evidence?: string;
  /**
   * 事件子类后缀（可选）：拼进幂等 key（health_<category>_<日期>_<suffix>），
   * 使"初筛记忆"与"恢复事件记忆"（同天）互不覆盖
   */
  keySuffix?: string;
}): Promise<void> {
  const importance = Math.min(10, Math.max(1, params.importance ?? 7));
  // key：同类事件当天一条（当天多次异常覆盖为最新，防止逐条堆积）；keySuffix 区分子类事件
  const key = `health_${params.category}_${new Date().toISOString().slice(0, 10)}${params.keySuffix ? `_${params.keySuffix}` : ''}`;
  try {
    await pool.query(
      `INSERT INTO agent_memories
         (user_id, pet_id, category, key, content, importance, confidence, source, evidence, meta, tags, level)
       VALUES ($1,$2,$3,$4,$5,$6,0.9,'health_event',$7,$8, $9, 'core')
       ON CONFLICT (user_id, pet_id, key)
       DO UPDATE SET
         content = EXCLUDED.content,
         importance = GREATEST(agent_memories.importance, EXCLUDED.importance),
         evidence = agent_memories.evidence || EXCLUDED.evidence,
         tags = agent_memories.tags || EXCLUDED.tags,
         level = 'core',
         updated_at = now()`,
      [
        params.userId,
        params.petId,
        params.category,
        key,
        params.content,
        importance,
        // evidence 列是 TEXT[]（数组）：必须传数组，传字符串会 malformed array literal
        params.evidence ? [params.evidence] : null,
        JSON.stringify({ type: 'health_event', recordedAt: new Date().toISOString() }),
        // 健康事件标签（回忆录"health_heal"维度）；medical 归入核心
        [params.category === 'medical' ? 'health_heal' : 'health'],
      ],
    );
  } catch (err) {
    // 记忆失败不阻塞主流程（打卡/初筛已成功）
    console.warn('[Memory] 健康事件记忆记录失败（不阻塞主流程）:', (err as Error).message);
  }
}

/**
 * 按回忆标签取记忆（回忆录 2.0 F4：素材自动备好）
 * 回忆录创建时按用户选的标签筛选核心层记忆，作为分镜生成的素材上下文。
 * @param params - 筛选参数
 * @returns 记忆文本（按 importance 排序，可给分镜生成器）
 */
export async function getMemoriesByTags(params: {
  userId: string;
  petId: string;
  /** 回忆标签（如 milestone/daily_joy/bonding/farewell）；空=全部核心层 */
  tags?: string[];
  /** 最多取多少条（默认 20） */
  limit?: number;
}): Promise<string> {
  const limit = Math.min(50, Math.max(1, params.limit ?? 20));
  try {
    const tagClause = params.tags && params.tags.length > 0 ? 'AND tags && $4::text[]' : '';
    const values: unknown[] = [params.userId, params.petId, limit];
    if (params.tags && params.tags.length > 0) values.push(params.tags);

    const { rows } = await pool.query(
      `SELECT content, importance, tags, created_at
       FROM agent_memories
       WHERE user_id = $1 AND pet_id = $2
         AND status = 'active'
         AND level = 'core'
         ${tagClause}
       ORDER BY importance DESC, created_at DESC
       LIMIT $3`,
      values,
    );

    if (rows.length === 0) {
      return `（${params.tags && params.tags.length > 0 ? `标签「${params.tags.join('、')}」暂无核心记忆` : '暂无核心记忆'}）`;
    }

    return rows
      .map((r) => {
        const date = new Date(r.created_at).toLocaleDateString('zh-CN');
        const tags = Array.isArray(r.tags) && r.tags.length > 0 ? ` [${r.tags.join('/')}]` : '';
        return `- ${date}：${r.content}（重要度:${r.importance}）${tags}`;
      })
      .join('\n');
  } catch (err) {
    console.warn('[Memory] 按标签取记忆失败:', (err as Error).message);
    return '';
  }
}

/**
 * 读取时光线（pet_moments）回忆文本，作为回忆录分镜的第二记忆素材源。
 * 背景：回忆录卖点承诺"根据用户在小程序里的回忆生成"，除 agent_memories（对话/打卡沉淀）
 * 外，用户在「时光」页记录的回忆（content->>'description'，AI 描述或手写）同样是真实回忆素材。
 * 注意：happened_at 为 DATE 类型（迁移 021 修正过时区问题），空时由 created_at 兜底。
 * @param userId 用户 ID
 * @param petId 宠物 ID
 * @param limit 最多取多少条（默认 15，硬上限 50）
 * @returns 按发生日期倒序的回忆文本清单；无记录或查询失败返回空串（调用方据此判定"无记忆"）
 */
export async function getPetMomentsSummary(
  userId: string,
  petId: string,
  limit = 15,
): Promise<string> {
  const capped = Math.min(50, Math.max(1, limit));
  try {
    const { rows } = await pool.query(
      `SELECT type,
              CASE WHEN jsonb_typeof(content) = 'object' THEN content->>'description' END AS description,
              to_char(
                COALESCE(happened_at, (created_at AT TIME ZONE 'Asia/Shanghai')::date),
                'YYYY-MM-DD'
              ) AS day
       FROM pet_moments
       WHERE user_id = $1 AND pet_id = $2
         AND jsonb_typeof(content) = 'object'
         AND NULLIF(BTRIM(COALESCE(content->>'description', '')), '') IS NOT NULL
       ORDER BY COALESCE(happened_at, (created_at AT TIME ZONE 'Asia/Shanghai')::date) DESC, created_at DESC
       LIMIT $3`,
      [userId, petId, capped],
    );
    if (rows.length === 0) return '';
    // 每条截断 120 字：时光页 AI 描述可达百字级，×15 条会膨胀分镜上下文（token 成本 + 指令稀释）
    return rows
      .map((r) => {
        const desc = String(r.description ?? '');
        const clipped = desc.length > 120 ? `${desc.slice(0, 120)}…` : desc;
        return `- [时光·${r.type}] ${clipped}（${r.day}）`;
      })
      .join('\n');
  } catch (err) {
    console.warn('[Memory] 读取时光线回忆失败:', (err as Error).message);
    return '';
  }
}

/**
 * 按勾选 ID 列表读取时光线回忆摘要（G2 记忆勾选：用户从创建页勾选的回忆才进旁白）
 *
 * 安全约束：
 *   - 强制 user_id + pet_id 双重过滤（防横向越权：用户不能勾选别人家的回忆 ID），
 *     未命中归属的 ID 静默跳过，不报错
 *   - 输出格式与 getPetMomentsSummary 一致（每条截断 120 字）
 *
 * @returns 摘要文本（无命中返回空串）
 */
export async function getMomentSummariesByIds(
  userId: string,
  petId: string,
  momentIds: string[],
): Promise<string> {
  // 去重 + 上限保护（schema 层 max 10，此处防御性再截）
  const ids = [...new Set(momentIds)].slice(0, 10);
  if (ids.length === 0) return '';
  try {
    // pet_moments.id 是 TEXT 主键（迁移 007，值为 uuid 格式字符串）——
    // 必须用 $3::text[] 直比（审查 P1-1）：`id = ANY($3::uuid[])` 会报
    // operator does not exist: text = uuid，整条勾选链静默失效
    const { rows } = await pool.query(
      `SELECT id,
              type,
              CASE WHEN jsonb_typeof(content) = 'object' THEN content->>'description' END AS description,
              to_char(
                COALESCE(happened_at, (created_at AT TIME ZONE 'Asia/Shanghai')::date),
                'YYYY-MM-DD'
              ) AS day
       FROM pet_moments
       WHERE user_id = $1 AND pet_id = $2
         AND id = ANY($3::text[])
         AND jsonb_typeof(content) = 'object'
         AND NULLIF(BTRIM(COALESCE(content->>'description', '')), '') IS NOT NULL`,
      [userId, petId, ids],
    );
    if (rows.length === 0) return '';
    // 按用户勾选顺序输出（IDs 顺序即用户意图顺序，不按时间重排）
    const byId = new Map(rows.map((r) => [String(r.id), r]));
    return ids
      .map((id) => byId.get(id))
      .filter((r): r is (typeof rows)[number] => Boolean(r))
      .map((r) => {
        const desc = String(r.description ?? '');
        const clipped = desc.length > 120 ? `${desc.slice(0, 120)}…` : desc;
        return `- [时光·${r.type}] ${clipped}（${r.day}）`;
      })
      .join('\n');
  } catch (err) {
    console.warn('[Memory] 按勾选读取时光线回忆失败:', (err as Error).message);
    return '';
  }
}

console.log('[MemoryService] memory-body 引擎已就绪');
