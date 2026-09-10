/**
 * Agent 智能对话服务 - ReAct 循环驱动的宠物管家
 * 包含系统提示词构建、LLM 调用、工具调度、记忆系统集成、安全守卫
 */
import { config } from '../config.js';
import {
  executeTool,
  getToolDefinitionsForLLM,
  type ToolCall,
} from './toolRegistry.js';
import { pool } from '../db.js';
import { detectBreedQuestion } from './agentRuleIntent.js';
import {
  buildMemoryContext,
  ingestMemories,
  saveConversation,
  loadConversationHistory,
  summarizePetMemory,
  getActiveMemories,
  detectContradiction,
  type MemoryEntry,
} from './memoryService.js';

// ========== 对话成本日志（AI 算账，2026-08-23） ==========

/** LLM 调用 token 用量（OpenAI 兼容响应的 usage 字段） */
export interface LLMUsage {
  prompt_tokens: number;
  completion_tokens: number;
}

/** 对话日志参数（写入 agent_conversation_logs 表） */
export interface ConversationLogParams {
  userId: string;
  petId?: string;
  intent?: string;
  toolChain: string[];
  iterations: number;
  promptTokens: number;
  completionTokens: number;
  durationMs: number;
  status: 'ok' | 'timeout' | 'error';
  error?: string;
}

/**
 * 记录一轮对话的成本日志（AI 算账）
 * 写入失败静默（日志绝不能影响对话主流程）
 * @param params - 对话统计（意图/工具链/token/耗时/状态）
 */
export async function recordConversationLog(params: ConversationLogParams): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO agent_conversation_logs
         (user_id, pet_id, intent, tool_chain, iterations, prompt_tokens, completion_tokens, duration_ms, status, error)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        params.userId,
        params.petId || null,
        params.intent || null,
        params.toolChain,
        params.iterations,
        params.promptTokens,
        params.completionTokens,
        params.durationMs,
        params.status,
        // 错误摘要截断 + 脱敏（不记录完整堆栈/敏感信息）
        params.error ? params.error.slice(0, 500) : null,
      ],
    );
  } catch (err) {
    // 日志失败静默（不阻塞对话主流程）
    console.warn('[AgentLog] 对话日志写入失败（静默）:', (err as Error).message);
  }
}

/**
 * 日志错误脱敏（审查项修复）：只保留第一行摘要
 * LLM API 错误响应体可能回显请求内容（含用户输入），防敏感信息落日志
 */
function sanitizeLogError(err: unknown): string {
  const message = err instanceof Error ? err.message : 'AI 服务异常';
  return message.split('\n')[0].slice(0, 200);
}

// ========== 类型定义 ==========

/**
 * 会话首条固定声明（立项 v0.2 P0-4 §七.4 ②）
 * 新会话第一条 AI 回复强制前缀，明确"健康记录工具"定位，规避「拟人化互动」类目
 * （强制自有算法备案）。措辞与商店/官网口径一致：非情感陪伴、非医疗建议。
 */
export const SESSION_DISCLAIMER =
  '【温馨提示】星河宠记 AI 助手是宠物健康记录工具，非情感陪伴、非医疗建议；健康问题请以兽医诊断为准。';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
  name?: string;
}

export interface AgentContext {
  userId: string;
  petId?: string;
  petName?: string;
  petBreed?: string;
  petAge?: string;
}

export interface AgentEvent {
  type: 'thinking' | 'tool_call' | 'tool_result' | 'token' | 'done' | 'error';
  data?: unknown;
}

// ========== 配置 ==========

const MAX_ITERATIONS = 10;
const AGENT_TIMEOUT_MS = 90_000;

function getApiKey(): string {
  return config.ai.apiKey || '';
}

/** 返回已配置的模型服务地址（config 已保证非空兜底为火山方舟默认值） */
function getBaseUrl(): string {
  return config.ai.baseUrl || '';
}

/** 返回已配置的模型名（config 已保证非空兜底为 deepseek-v4-flash-ga-260731） */
function getModel(): string {
  return config.ai.model || '';
}

// ========== 记忆系统：构建系统提示词 ==========

export async function buildSystemPrompt(context: AgentContext, userMessage: string, intentHint?: string): Promise<string> {
  // 立项 v0.2 P0-4（§七.4 ①）：定位工具化——去人格化承诺/恋人化语气，规避「拟人化互动」类目
  // （强制自有算法备案 3.7-13.5 万）。吉祥物形象保留，但语气始终是"工具助手"而非"情感角色"。
  let prompt = `你是"团团"，星河宠记的 AI 宠物管家（戴金色星冠的橘猫吉祥物形象）。你的定位是宠物健康记录与养宠工具助手，语气专业、友好、简洁。

## ⚡ 路由指南（最重要！先读这里）

当用户发送消息时，你必须先判断用户意图，然后选择正确的工具。以下是详细的路由规则和示例：

### 🏷️ 取名 → 调用 start_naming
用户想为新宠物取名、换名字、求推荐名字时，必须调用 start_naming。
示例：
- "帮我想个名字" → start_naming
- "叫什么名字好" → start_naming
- "起个名字" → start_naming
- "给我家猫取个名" → start_naming
- "有什么好名字推荐" → start_naming
- "想不出叫什么" → start_naming
- "改个名字" → start_naming
- "帮豆豆换个名字" → start_naming
- "求推荐可爱名字" → start_naming
- "帮我想想它叫啥" → start_naming

### 📋 打卡 → 调用 start_checkin 或 record_health_checkin
用户想记录宠物今天状态时：
- 如果用户只是表达了打卡意图但未提供具体数据 → 调用 start_checkin（启动前端打卡流程）
- 如果用户已明确描述了状态数据（如"精神很好，食欲正常"）→ 调用 record_health_checkin（直接记录）
示例：
- "打卡" → start_checkin
- "记录一下今天" → start_checkin
- "今天状态怎么样" → start_checkin
- "做个记录" → start_checkin
- "豆豆今天精神不太好" → start_checkin（启动流程让用户详细填写）
- "记录一下豆豆今天的情况" → start_checkin
- "精神很好，食欲正常，排便正常" → record_health_checkin（已有具体数据）

### 📸 回忆 → 调用 record_memory
用户想记录宠物回忆、写日记、保存美好时刻时，调用 record_memory。
**关键：如果用户已在消息中描述了回忆内容，必须把内容作为 content 参数传入，工具会直接保存到「时光」页面。**
示例：
- "记录回忆" → record_memory（不传 content，启动录制流程）
- "写个日记" → record_memory（不传 content，启动录制流程）
- "记录回忆：豆豆今天追逗猫棒玩疯了" → record_memory（content="豆豆今天追逗猫棒玩疯了"，直接保存）
- "写个日记：今天带它去公园散步" → record_memory（content="今天带它去公园散步"，直接保存）
- "记下这件事：它今天把花瓶打碎了" → record_memory（content="它今天把花瓶打碎了"，直接保存）
- "今天发生了一件有趣的事，它在沙发上翻跟头" → record_memory（content="它在沙发上翻跟头"，直接保存）
- "记录一下我们今天的经历，去了宠物公园" → record_memory（content="去了宠物公园"，直接保存）

### 🏥 症状 → 调用 check_symptom
用户描述宠物不适症状时，调用 check_symptom。
示例：
- "豆豆吐了" → check_symptom
- "拉肚子怎么办" → check_symptom
- "精神不好" → check_symptom
- "不吃东西" → check_symptom
- "帮我看看怎么了" → check_symptom
- "是不是生病了" → check_symptom
- "豆豆今天有点蔫" → check_symptom
- "感觉不太对劲" → check_symptom
- "没精神" → check_symptom
- "老挠自己" → check_symptom

### 🍎 食物查询 → 调用 query_food_safety
用户明确询问某种食物对宠物是否安全、有毒时，才调用 query_food_safety。
**关键区分：用户是在"提问"食物安全性，而不是在"陈述"宠物吃了什么。**
示例：
- "巧克力能吃吗" → query_food_safety
- "葡萄可以喂吗" → query_food_safety
- "这个有毒吗" → query_food_safety
- "查一下鸡肉对猫安全吗" → query_food_safety
- "猫能吃什么" → query_food_safety
- "推荐一些安全的食物" → query_food_safety
**以下情况不要调用 query_food_safety（用户在分享日常，不是在查食物）：**
- "烧鸡今天吃了超多" → 直接回复（分享日常）
- "它今天吃了很多猫粮" → 直接回复（分享日常）
- "我只是和你分享" → 直接回复（聊天）
- "它把罐头全吃完了" → 直接回复（分享日常）
- "今天给它喂了鸡胸肉，它很喜欢" → 直接回复（分享日常）

### 🐱 品种百科 → 调用 search_breed_info
用户询问品种信息时，调用 search_breed_info。
示例：
- "金毛怎么样" → search_breed_info
- "英短好养吗" → search_breed_info
- "查一下柯基" → search_breed_info
- "这是什么品种" → search_breed_info
- "品种推荐" → search_breed_info
- "适合新手养的狗" → search_breed_info

### 💬 普通聊天 / 分享日常 → 直接回复
用户只是在聊天、问候、表达情感、分享宠物日常时，直接文字回复，不调用任何工具。
**关键判断：如果用户不是在提问、不是在寻求建议、不是在要求记录，就属于聊天/分享，直接回复即可。**
示例：
- "你好" → 直接回复
- "今天天气真好" → 直接回复
- "豆豆真可爱" → 直接回复
- "谢谢你" → 直接回复
- "烧鸡今天吃了超多" → 直接回复（分享日常，关心一下即可）
- "它今天吃了很多猫粮" → 直接回复（分享日常）
- "它把罐头全吃完了" → 直接回复（分享日常）
- "今天给它喂了鸡胸肉，它很喜欢" → 直接回复（分享日常）
- "我只是和你分享" → 直接回复（聊天）
- "它今天一直在睡觉" → 直接回复（分享日常）
- "它刚才追逗猫棒玩疯了" → 直接回复（分享日常）
- "它今天对我发脾气了" → 直接回复（分享日常）

## 你的能力
你可以通过调用工具来帮助用户管理宠物健康：
- 记录健康打卡（精神状态、食欲、排便、运动）
- 查询食物安全性
- 症状初筛（评估是否需要就医，不做诊断）
- 查询疫苗日历
- 查看健康趋势
- 查询品种百科
- 管理家庭宠物
- 记录喂养
- AI取名（调用 start_naming 工具）
- 健康打卡（调用 start_checkin 工具）
- 记录回忆（调用 record_memory 工具）
- 慢性病 AI 管理建议（调用 get_chronic_advice，如"糖尿病怎么护理"）
- AI 个性化喂养建议（调用 get_feeding_advice，如"怎么喂""吃多少"）
- 慢性病风险扫描（调用 scan_chronic_risk，如"有没有健康隐患""帮我看看有没有问题"）

### 🩺 慢病管理 / 喂养建议 / 风险扫描 → 调用 AI 工具
用户询问慢病护理、喂养建议、健康风险时：
- "慢性病怎么护理""糖尿病要注意什么" → get_chronic_advice
- "怎么喂""吃多少""推荐什么食物" → get_feeding_advice
- "有没有慢性病风险""健康有没有隐患""帮我全面看看" → scan_chronic_risk
示例：
- "豆豆有糖尿病，平时要注意什么" → get_chronic_advice
- "我家猫应该喂多少合适" → get_feeding_advice
- "帮我看看我家狗最近有没有健康问题" → scan_chronic_risk

## 核心原则
1. 主动使用工具获取信息，不要凭空猜测
2. 如果用户意图不明确，先用工具获取上下文再回复
3. 每次回复控制在 3-5 句，温暖简洁
4. 如果检测到宠物严重症状，必须建议就医并推荐医院
5. 绝对不能做医学诊断、推荐具体药物
6. 涉及医疗建议时必须附带免责声明
7. 检测到用户情绪危机时触发安全干预
8. 定位红线（最重要）：你是工具助手，不是情感陪伴角色——禁止恋人化/家人化语气与承诺（如"我永远陪着你""我会一直爱你""想我了就跟我说""我是你的家人"），禁止诱导用户与你建立情感依赖；表达关心时始终围绕宠物健康与记录本身

## 当前宠物信息
`;

  // 注入宠物档案
  if (context.petId && context.userId) {
    try {
      const { rows } = await pool.query(
        `SELECT name, species, breed, gender, birth_date, weight, is_neutered, notes
         FROM pet_profiles WHERE id = $1 AND user_id = $2`,
        [context.petId, context.userId]
      );
      if (rows.length > 0) {
        const p = rows[0];
        const age = p.birth_date
          ? `${Math.floor((Date.now() - new Date(p.birth_date).getTime()) / (365.25 * 24 * 60 * 60 * 1000))}岁`
          : '未知';
        prompt += `- 名字：${p.name}
- 品种：${p.breed}（${p.species === 'cat' ? '猫' : '狗'}）
- 年龄：${age}
- 体重：${p.weight || '未知'}kg
- 性别：${p.gender === 'male' ? '公' : p.gender === 'female' ? '母' : '未知'}
- 绝育：${p.is_neutered ? '已绝育' : '未绝育'}
- 备注：${p.notes || '无'}
`;
      }
    } catch {
      // 查询失败不阻塞
    }
  }

  // 注入记忆引擎上下文（记忆、矛盾、健康洞察）
  if (context.petId && context.userId) {
    try {
      const memCtx = await buildMemoryContext(context.userId, context.petId, userMessage);
      if (memCtx.memories) {
        prompt += `\n## 关于这只宠物的长期记忆（AI 自动整理）\n${memCtx.memories}\n`;
      }
      if (memCtx.contradictions) {
        prompt += `\n## ⚠️ 记忆冲突提醒\n${memCtx.contradictions}\n`;
      }
      if (memCtx.healthInsights) {
        prompt += `\n${memCtx.healthInsights}\n`;
      }
    } catch {
      // 记忆加载失败不阻塞
    }
  }

  // 注入长期记忆（宠物特征）- 作为辅助补充
  if (context.petId) {
    try {
      const { rows: facts } = await pool.query(
        `SELECT category, fact FROM pet_facts
         WHERE pet_id = $1 AND user_id = $2
         ORDER BY created_at DESC LIMIT 20`,
        [context.petId, context.userId]
      );
      if (facts.length > 0) {
        prompt += `\n## 宠物特征/喜好（用户手动记录）\n`;
        const categories: Record<string, string[]> = {};
        for (const f of facts) {
          if (!categories[f.category]) categories[f.category] = [];
          categories[f.category].push(f.fact);
        }
        for (const [cat, items] of Object.entries(categories)) {
          const label: Record<string, string> = {
            like: '喜欢', dislike: '讨厌', habit: '习惯', personality: '性格', general: '其他',
          };
          prompt += `- ${label[cat] || cat}：${items.join('；')}\n`;
        }
      }
    } catch {
      // 查询失败不阻塞
    }
  }

  // 注入短期记忆（最近打卡）
  if (context.petId) {
    try {
      const { rows: checkins } = await pool.query(
        `SELECT spirit_level, appetite_level, poop_level, exercise_level, note, created_at
         FROM pet_health_entries WHERE pet_id = $1 AND user_id = $2
         ORDER BY created_at DESC LIMIT 7`,
        [context.petId, context.userId]
      );
      if (checkins.length > 0) {
        prompt += `\n## 最近打卡记录\n`;
        for (const c of checkins) {
          const date = new Date(c.created_at).toLocaleDateString('zh-CN');
          prompt += `- ${date}：精神${c.spirit_level || '?'} 食欲${c.appetite_level || '?'} 排便${c.poop_level || '?'}${c.note ? `（${c.note}）` : ''}\n`;
        }
      }
    } catch {
      // 查询失败不阻塞
    }
  }

  // 注入家庭宠物列表（多宠上下文：名字/品种/年龄/性别/已故/最近状态一句话）
  if (context.userId) {
    try {
      const { rows: familyPets } = await pool.query(
        `SELECT p.name, p.species, p.breed, p.gender, p.birth_date, p.is_deceased,
                (SELECT CASE WHEN h.spirit_level IN ('一般','不太好') OR h.appetite_level IN ('一般','不太好')
                        THEN '最近状态一般，建议多留意'
                        ELSE '最近状态正常' END
                 FROM pet_health_entries h
                 WHERE h.pet_id = p.id
                 ORDER BY h.created_at DESC LIMIT 1) AS recent_status
         FROM pet_profiles p
         WHERE p.user_id = $1 AND p.id != $2
         ORDER BY p.created_at`,
        [context.userId, context.petId || '']
      );
      if (familyPets.length > 0) {
        prompt += `\n## 家庭其他宠物（用户全家养的宠物，你可能被问到它们）\n`;
        for (const fp of familyPets) {
          // 年龄文本（有出生日期才显示）
          let ageText = '';
          if (fp.birth_date) {
            const ageYears = Math.floor(
              (Date.now() - new Date(fp.birth_date).getTime()) / (365.25 * 24 * 3600 * 1000),
            );
            if (ageYears >= 1) ageText = `${ageYears}岁`;
            else ageText = `${Math.max(1, Math.floor(((Date.now() - new Date(fp.birth_date).getTime()) / (30.44 * 24 * 3600 * 1000))))}个月`;
          }
          const genderText = fp.gender === 'male' ? '公' : fp.gender === 'female' ? '母' : '';
          const deceasedText = fp.is_deceased ? '（已故）' : '';
          const statusText = fp.recent_status ? `，${fp.recent_status}` : '';
          prompt += `- ${fp.name}（${fp.breed}，${fp.species === 'cat' ? '猫' : '狗'}${genderText ? `，${genderText}` : ''}${ageText ? `，${ageText}` : ''}${deceasedText}）${statusText}\n`;
        }
        prompt += `\n用户提到"家里的小黑/豆豆"等具体名字时，先确认指的是哪只，再结合对应宠物的情况回答。\n`;
      }
    } catch {
      // 查询失败不阻塞
    }
  }

  prompt += `\n## 重要
- 你拥有工具调用能力和长期记忆能力，可以记住关于宠物的重要信息
- 看到「关于这只宠物的长期记忆」中的内容，说明你之前已经了解这些信息，请在回复中自然引用
- 如果记忆冲突提醒中有标记，说明用户的说法与之前记录不一致，请优先信任新信息
- 遇到需要查询或记录的情况，请主动调用工具
- 食物安全查询工具（query_food_safety）会先查知识库，如果知识库没有该食物的数据，工具会返回 source=not_found。此时你可以根据你的专业知识来分析该食物对犬猫的安全性，但必须在回答末尾添加免责声明："以上信息仅供参考，不能替代兽医的专业建议"。
- 当 query_food_safety 返回某个 safetyLevel 时，必须**如实转述并对应到结论话术，严禁夸大或缩小风险**：safetyLevel=safe →「可以吃（适量）」；caution →「少量谨慎，观察反应」；dangerous →「禁止喂食」；toxic →「有毒，禁止喂食，误食立即就医」。例如知识库给出「西瓜=safe」就该回答「可以少量吃」，绝不能误导用户说「不能吃/高风险」。
- 不要假装你已经知道数据，必须通过工具获取。但工具明确告诉你"请根据你的专业知识分析"时，你可以使用自己的知识来回答。
- 如果用户没有指定宠物，默认使用当前活跃宠物
- 回复时用第二人称"你"，语气温暖自然`;

  // 意图提示（2026-09-10）：思考模式不支持强制指定函数的 tool_choice，
  // 高置信度意图改用 auto + 这里注入的确定性提示，保证模型仍调用正确工具，
  // 而不是凭记忆臆测（否则会重演"西瓜=safe 却被答成不能吃"的事故）。
  if (intentHint) {
    prompt += `\n\n## 🎯 本轮意图提示（务必遵守）
意图分类器已判定本条消息需要调用工具 **${intentHint}**。请先调用该工具获取权威数据，再基于工具返回的数据如实回答，严禁跳过工具、凭记忆臆测。`;
  }

  return prompt;
}

// ========== 第一步：意图分类（两步路由核心） ==========

/** 意图分类结果 */
interface IntentResult {
  intent: string;
  confidence: number;
  reason: string;
  /** LLM 调用 token 用量（AI 算账用；降级路径可能为空） */
  usage?: LLMUsage;
}

/** 意图 → 工具名映射（高置信度时强制调用） */
const INTENT_TOOL_MAP: Record<string, string | null> = {
  chat: null,           // 聊天/分享 → 不调用任何工具
  naming: 'start_naming',
  memory: 'record_memory',
  symptom: 'check_symptom',
  food: 'query_food_safety',
  breed: 'search_breed_info',
  feeding: 'record_feeding',
  vaccine: 'get_vaccine_calendar',
  hospital: 'search_hospital',
  family: 'get_family_pets',
  checkin: '__auto__',   // 可能是 start_checkin 或 record_health_checkin
  pet_info: '__auto__',  // 可能是 get_pet_profile 或 get_pet_facts
  health_trend: '__auto__', // 可能是 get_recent_checkins 或 get_health_trends
};

/**
 * 第一步：用 LLM 做意图分类
 * 独立的短 prompt，只输出 JSON，速度快、成本低
 */
async function classifyIntent(
  userMessage: string,
  history: ChatMessage[],
): Promise<IntentResult> {
  const apiKey = getApiKey();
  if (!apiKey) {
    return { intent: 'chat', confidence: 0, reason: 'AI 未配置，默认聊天' };
  }

  // 构建分类 prompt（含最近 3 条对话上下文）
  const recentHistory = history.slice(-3)
    .map(m => `${m.role === 'user' ? '用户' : 'AI'}: ${m.content.slice(0, 100)}`)
    .join('\n');

  const classifyPrompt = `你是意图分类器。根据用户消息判断意图，只输出JSON，不要输出其他内容。

## 意图类别
- chat: 聊天、问候、分享日常、表达情感、感谢（不调用任何工具）
- naming: 为宠物取名、换名字、求推荐名字
- checkin: 健康打卡、记录今天状态
- memory: 记录回忆、写日记、保存美好时刻（包括用户已提供具体回忆内容的情况，如"记录回忆：豆豆今天玩疯了"）
- symptom: 宠物不适、生病症状、精神不好
- food: 询问某种食物是否安全/能不能吃/有没有毒
- breed: 品种信息、品种推荐、品种百科
- feeding: 记录喂养/喂食
- vaccine: 疫苗日历/疫苗接种
- hospital: 查找医院/宠物医院
- pet_info: 查询宠物档案/基本信息
- family: 家庭宠物管理/添加宠物
- health_trend: 健康趋势/历史打卡记录

## 关键区分规则（务必遵守）
1. **分享 vs 查食物**：
   - "烧鸡今天吃了超多" → chat（分享日常，不是查食物）
   - "它把罐头全吃完了" → chat（分享日常）
   - "今天喂了鸡胸肉，它很爱吃" → chat（分享日常）
   - "巧克力能吃吗" → food（询问安全性）
   - "葡萄对猫有毒吗" → food（询问安全性）
   - 判断标准：用户在"陈述"宠物吃了什么 → chat；用户在"提问"某食物是否安全 → food

2. **分享 vs 症状**：
   - "它今天一直在睡觉" → chat（分享日常）
   - "它今天没精神，不吃不喝" → symptom（描述不适症状）
   - 判断标准：正常行为描述 → chat；异常/不适描述 → symptom

3. **分享 vs 记录**：
   - "它刚才追逗猫棒玩疯了" → chat（分享日常）
   - "记个日记" / "记录回忆" → memory（明确要求记录）
   - 判断标准：用户在分享但没要求记录 → chat；用户明确要求记录 → memory

## 最近对话上下文
${recentHistory || '（无）'}

## 输出格式
{"intent":"类别","confidence":0.0到1.0,"reason":"简短原因"}`;

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
          { role: 'system', content: classifyPrompt },
          { role: 'user', content: userMessage },
        ],
        temperature: 0.1,
        max_tokens: 100,
        stream: false,
      }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      return { intent: 'chat', confidence: 0, reason: '分类器请求失败，降级为 auto' };
    }

    const data = await response.json() as {
      choices: Array<{ message: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };

    const content = data.choices[0]?.message?.content || '';
    // 提取 JSON（兼容 markdown 代码块包裹）
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return { intent: 'chat', confidence: 0, reason: '分类器输出解析失败，降级为 auto' };
    }

    const result = JSON.parse(jsonMatch[0]) as IntentResult;
    return {
      intent: result.intent in INTENT_TOOL_MAP ? result.intent : 'chat',
      confidence: typeof result.confidence === 'number' ? result.confidence : 0,
      reason: result.reason || '',
      // AI 算账：记录意图分类这次调用的 token 用量
      usage: {
        prompt_tokens: data.usage?.prompt_tokens ?? 0,
        completion_tokens: data.usage?.completion_tokens ?? 0,
      },
    };
  } catch {
    return { intent: 'chat', confidence: 0, reason: '分类器异常，降级为 auto' };
  }
}

// ========== 调用 LLM（支持 function calling） ==========

interface LLMResponse {
  content: string | null;
  toolCalls: ToolCall[] | null;
  finishReason: string;
  reasoningContent: string | null;
  /** token 用量（AI 算账用） */
  usage: LLMUsage;
}

/** tool_choice 参数类型：'auto' | 'none' | 指定工具 */
type ToolChoice = 'auto' | 'none' | { type: 'function'; function: { name: string } };

/**
 * 组装 callLLM 请求体（导出供单测）
 *
 * 关键兼容（2026-09-10 生产实测）：DeepSeek V4 Flash 默认开启思考模式，
 * 「强制指定函数」的 tool_choice 会被 API 直接 400 拒绝：
 *   "Thinking mode does not support this tool_choice"
 * 因此 Agent 路由不再强制指定函数，改用 auto + 意图提示（见 agentLoop）。
 * 此处保持思考模式默认开启（不传 thinking 参数）——思考模式能显著提升工具参数提取质量
 * （如从"猫咪能吃西瓜吗"里准确抽出"西瓜"），实测 auto + 思考模式 200 且正确返回 tool_calls。
 */
export function buildLLMRequestBody(
  messages: ChatMessage[],
  toolChoice?: ToolChoice,
): Record<string, unknown> {
  return {
    model: getModel(),
    messages,
    temperature: 0.7,
    max_tokens: 1024,
    stream: false,
    tools: getToolDefinitionsForLLM(),
    tool_choice: toolChoice || 'auto',
  };
}

async function callLLM(
  messages: ChatMessage[],
  stream: boolean,
  toolChoice?: ToolChoice,
): Promise<LLMResponse> {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error('AI 服务未配置');
  }

  const postChat = (body: Record<string, unknown>) => fetch(`${getBaseUrl()}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });

  const response = await postChat(buildLLMRequestBody(messages, toolChoice));

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(`AI API error: ${response.status} ${errorText}`);
  }

  const data = await response.json() as {
    choices: Array<{
      message: {
        content?: string;
        tool_calls?: Array<{
          id: string;
          type: 'function';
          function: { name: string; arguments: string };
        }>;
      };
      finish_reason: string;
    }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };

  const choice = data.choices[0];
  const msg = choice.message;

  const toolCalls: ToolCall[] = [];
  if (msg.tool_calls) {
    for (const tc of msg.tool_calls) {
      try {
        toolCalls.push({
          name: tc.function.name,
          arguments: JSON.parse(tc.function.arguments),
        });
      } catch {
        console.error(`[Agent] 工具参数解析失败: ${tc.function.name}`);
      }
    }
  }

  return {
    content: msg.content || null,
    toolCalls: toolCalls.length > 0 ? toolCalls : null,
    finishReason: choice.finish_reason,
    reasoningContent: (msg as Record<string, unknown>).reasoning_content as string || null,
    // AI 算账：记录本次主循环调用的 token 用量
    usage: {
      prompt_tokens: data.usage?.prompt_tokens ?? 0,
      completion_tokens: data.usage?.completion_tokens ?? 0,
    },
  };
}

// ========== Agent 主循环（ReAct） ==========

export async function* agentLoop(
  userMessage: string,
  history: ChatMessage[],
  context: AgentContext,
): AsyncGenerator<AgentEvent> {
  const startTime = Date.now();

  // AI 算账：累计 token/工具链，try/finally 统一兜底写成本日志（幂等，只写一次）
  let promptTokens = 0;
  let completionTokens = 0;
  const toolChain: string[] = [];
  let logStatus: 'ok' | 'timeout' | 'error' = 'ok';
  let logError: string | undefined;
  let logWritten = false;
  let intentResult: IntentResult | undefined;
  let iterations = 0;
  let finalContent = '';
  // 工具调用 id 单调计数器：修复同毫秒多工具调用或跨毫秒两次 Date.now() 导致的 id 撞车/不匹配
  let toolCallSeq = 0;

  /** 写成本日志（幂等；异步不阻塞；finally 兜底正常/超时/异常/客户端断开路径） */
  const writeLog = () => {
    if (logWritten) return;
    logWritten = true;
    void recordConversationLog({
      userId: context.userId,
      petId: context.petId,
      intent: intentResult?.intent,
      toolChain,
      iterations,
      promptTokens,
      completionTokens,
      durationMs: Date.now() - startTime,
      status: logStatus,
      error: logError,
    });
  };

  try {
    // ========== 第一步：意图分类（规则预筛优先） ==========
    yield { type: 'thinking', data: { iteration: 0, label: '理解意图中...' } };
    // 确定性品种提问预筛：命中则跳过 LLM 意图分类——既省一次付费分类调用，
    // 又消除「LLM 把"这是什么猫"误判为 chat 导致不调 search_breed_info、不跳品种详情页」的不确定性
    if (detectBreedQuestion(userMessage)) {
      intentResult = { intent: 'breed', confidence: 1.0, reason: '规则预筛：品种提问', usage: undefined };
      console.log('[Agent] 意图预筛命中: breed（规则，跳过 LLM 分类）');
    } else {
      intentResult = await classifyIntent(userMessage, history);
      console.log(`[Agent] 意图分类: ${intentResult.intent} (置信度: ${intentResult.confidence}) - ${intentResult.reason}`);
      // 算账：意图分类调用的 token 计入本轮
      if (intentResult.usage) {
        promptTokens += intentResult.usage.prompt_tokens;
        completionTokens += intentResult.usage.completion_tokens;
      }
    }

    // 根据意图决定 tool_choice + 意图提示
  let initialToolChoice: ToolChoice = 'auto';
  let intentHint = '';
  const CONFIDENCE_THRESHOLD = 0.7;

  if (intentResult.confidence >= CONFIDENCE_THRESHOLD) {
    const mappedTool = INTENT_TOOL_MAP[intentResult.intent];
    if (mappedTool === null) {
      // chat 意图 → 禁用所有工具，直接回复
      initialToolChoice = 'none';
      console.log('[Agent] 路由决策: chat → 禁用工具，直接回复');
    } else if (mappedTool && mappedTool !== '__auto__') {
      // 思考模式模型不支持「强制指定函数」的 tool_choice（会 400），
      // 改用 auto + 意图提示：既保证模型调用正确工具，又保留思考推理（参数提取更准）。
      initialToolChoice = 'auto';
      intentHint = mappedTool;
      console.log(`[Agent] 路由决策: ${intentResult.intent} → auto + 意图提示调用 ${mappedTool}`);
    } else {
      // 多工具意图 → auto
      console.log(`[Agent] 路由决策: ${intentResult.intent} → auto（多工具候选）`);
    }
  } else {
    console.log(`[Agent] 路由决策: 置信度 ${intentResult.confidence} < ${CONFIDENCE_THRESHOLD} → auto（降级）`);
  }

  // 构建系统提示词（传入用户消息以检索相关记忆；intentHint 注入确定性路由提示）
  const systemPrompt = await buildSystemPrompt(context, userMessage, intentHint);

  // 构建消息列表
  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    ...history.slice(-10),
    { role: 'user', content: userMessage },
  ];

  while (iterations < MAX_ITERATIONS) {
    // 超时检查
    if (Date.now() - startTime > AGENT_TIMEOUT_MS) {
      logStatus = 'timeout';
      yield { type: 'error', data: { message: '思考超时，请稍后重试' } };
      return;
    }

    iterations++;
    yield { type: 'thinking', data: { iteration: iterations } };

    try {
      // 第一次迭代用意图分类的 tool_choice，后续迭代用 auto（处理工具结果）
      const toolChoice = iterations === 1 ? initialToolChoice : 'auto';
      const response = await callLLM(messages, false, toolChoice);
      // 算账：主循环每次调用的 token 累计
      promptTokens += response.usage?.prompt_tokens ?? 0;
      completionTokens += response.usage?.completion_tokens ?? 0;

      // LLM 想调用工具
      if (response.toolCalls && response.toolCalls.length > 0) {
        for (const toolCall of response.toolCalls) {
          // 算账：记录工具调用链（数量/长度上限，防行膨胀，审查项修复）
          if (toolChain.length < 20) {
            toolChain.push(toolCall.name.slice(0, 100));
          }
          // 通知前端：正在调用工具
          yield {
            type: 'tool_call',
            data: { name: toolCall.name, arguments: toolCall.arguments },
          };

          // 执行工具
          const result = await executeTool(toolCall, {
            userId: context.userId,
            petId: context.petId,
          });

          // 通知前端：工具执行结果
          yield {
            type: 'tool_result',
            data: {
              name: toolCall.name,
              success: result.success,
              message: result.message,
              data: result.data,
            },
          };

          // 将工具调用和结果加入消息历史
          // 每个工具调用生成一次单调递增 id（修复同毫秒/跨毫秒 Date.now() 导致 id 撞车或不匹配）
          const toolCallId = `call_${++toolCallSeq}_${toolCall.name}`;
          const assistantMsg: ChatMessage = {
            role: 'assistant',
            content: '',
            tool_calls: [
              {
                id: toolCallId,
                type: 'function',
                function: {
                  name: toolCall.name,
                  arguments: JSON.stringify(toolCall.arguments),
                },
              },
            ],
          };
          // DeepSeek V4 Flash 要求回传 reasoning_content
          if (response.reasoningContent) {
            (assistantMsg as unknown as Record<string, unknown>).reasoning_content = response.reasoningContent;
          }
          messages.push(assistantMsg);
          messages.push({
            role: 'tool',
            content: JSON.stringify(result),
            tool_call_id: toolCallId,
          });
        }
        // 继续循环，让 LLM 处理工具结果
        continue;
      }

      // LLM 生成最终回复
      if (response.content) {
        finalContent = response.content;
        // 立项 v0.2 P0-4（§七.4 ②）：会话首条固定声明——新会话（无历史）第一条 AI 回复
        // 强制前缀合规声明，确定性输出、不依赖 LLM 自觉
        if (history.length === 0) {
          finalContent = `${SESSION_DISCLAIMER}\n\n${finalContent}`;
        }
        // 逐字流式输出
        const chars = Array.from(finalContent);
        for (let i = 0; i < chars.length; i += 3) {
          yield {
            type: 'token',
            data: { text: chars.slice(i, i + 3).join('') },
          };
        }
        yield { type: 'done', data: { content: finalContent, iterations } };
        // 异步保存对话记录 & 触发记忆摄入（不阻塞响应）
        const petIdForSave = context.petId || null;
        saveConversation(context.userId, petIdForSave, 'user', userMessage).catch(() => {});
        saveConversation(context.userId, petIdForSave, 'assistant', finalContent).catch(() => {});
        // 异步记忆摄入（传入已有记忆避免重复）+ 矛盾检测
        (async () => {
          const existing = await getActiveMemories(context.userId, context.petId || '', 20);
          await ingestMemories(context.userId, context.petId || '', userMessage, finalContent, existing);
          await detectContradiction(context.userId, context.petId || '', userMessage);
        })().catch(() => {});
        return;
      }

      // 没有内容也没有工具调用，结束
      yield { type: 'done', data: { content: '收到，让我想想...', iterations } };
      // 保存用户消息（无有效助手回复，跳过记忆摄入）
      saveConversation(context.userId, context.petId || null, 'user', userMessage).catch(() => {});
      return;

    } catch (error) {
      const message = error instanceof Error ? error.message : 'AI 服务异常';
      logStatus = 'error';
      logError = sanitizeLogError(error);

      // 如果已经执行过工具调用，返回部分结果
      if (iterations > 1) {
        yield {
          type: 'error',
          data: { message: `部分操作完成，但回复生成失败：${message}` },
        };
        return;
      }

      yield { type: 'error', data: { message } };
      return;
    }
  }

  // 超过最大迭代次数
  yield {
    type: 'done',
    data: {
      content: finalContent || '我已收集了相关信息，但分析时间较长。请告诉我你想了解什么？',
      iterations,
    },
  };
  // 异步保存对话记录 & 触发记忆摄入（不阻塞响应）
  saveConversation(context.userId, context.petId || null, 'user', userMessage).catch(() => {});
  if (finalContent) {
    saveConversation(context.userId, context.petId || null, 'assistant', finalContent).catch(() => {});
    // 异步记忆摄入 + 矛盾检测
    (async () => {
      const existing = await getActiveMemories(context.userId, context.petId || '', 20);
      await ingestMemories(context.userId, context.petId || '', userMessage, finalContent, existing);
      await detectContradiction(context.userId, context.petId || '', userMessage);
    })().catch(() => {});
  }
  } catch (error) {
    // 前置异常（意图分类/系统提示词等未覆盖路径）：记 error 后原样抛出（保持原行为）
    logStatus = 'error';
    logError = sanitizeLogError(error);
    throw error;
  } finally {
    // 统一兜底：正常/超时/异常/客户端断开（生成器 return() 会触发 finally）都写日志
    writeLog();
  }
}

// ========== 安全守卫（输入检查） ==========

/**
 * 规则预筛（2026-09 成本优化）：命中「用户危机/虐待/遗弃/弃养」等信号才触发付费 LLM 守卫，
 * 常见良性消息直接放行，省掉每条消息一次独立的安全 LLM 调用（agentRouter 已按此 gate）。
 * 注意：只针对「用户本人 / 主动虐待 / 遗弃」类语言，不误判宠物生病/抑郁/离世等宠物健康内容。
 */
const RISK_PATTERNS = [
  // —— 用户自伤 / 轻生 / 危机（第一人称或明确信号）——
  /自杀|自残|自伤|轻生|寻死|割腕|服毒|跳楼|跳河|上吊|烧炭|吞药/,
  /想死|想去死|去死|不想活|不想活了|活不下去|活着没意思|活着好累|撑不下去了?|撑不住了?/,
  /结束(自己|我的|生命|这一切|所有一切)|伤害(自己|我自己)|自虐/,
  /离开这个世界|不如死了算了|活该去死|死(了)?算了|不想见(任何人|所有人)|想(永远)?离开/,
  // —— 虐待 / 伤害（含把字句；宾语可在动词前或后）——
  /虐待|家暴|虐猫|虐狗|毒打|暴打|往死里打/i,
  /打(它|ta|猫|狗|宠物|你)|揍(它|ta|猫|狗|你)/i,
  /把(它|ta|你|宠物|猫|狗)?(打死|弄死|杀死|宰了|药死|饿死|虐死|虐待|往死里打|揍死|丢掉)/i,
  /(打死|弄死|杀死|宰了|药死|饿死|虐死|揍死)(它|ta|宠物|猫|狗|你)/i,
  // —— 遗弃 / 弃养 / 抛弃 / 送人（含把字句）——
  /遗弃|弃养|抛弃|送人|不(想)?要(它|ta|宠物|猫|狗|这只|了)/i,
  /不想养(了|它|ta|猫|狗)?|(把|将)(它|ta|你|宠物|猫|狗)?(扔了|丢了|丢弃|扔掉|遗弃|送人|送走)|(扔了|丢了|丢弃|扔掉|送走)(它|ta|宠物|猫|狗|你)/i,
];

export function preScreenRisk(text: string): boolean {
  return RISK_PATTERNS.some((p) => p.test(text));
}

/** 守卫 fail-closed 时的提示（命中预筛即可能处于情绪/困境，倾向提供帮助而非冷文） */
const SAFETY_FAILCLOSED_REASON = '你的消息可能需要支持。如需帮助请拨打24小时心理援助热线：400-161-9995。';

/**
 * 安全守卫（输入检查）：LLM 判定是否危机/无关。命中预筛规则时 fail-closed（守卫异常也拦截），
 * 未命中预筛的良性消息由调用方跳过本函数（不产生成本）。
 * @param text - 用户输入
 * @param opts.failClosed - 命中预筛后传入 true：守卫服务异常/返回不可信时按「拦截」处理（安全优先）
 */
export async function guardCheckInput(text: string, opts?: { failClosed?: boolean }): Promise<{
  blocked: boolean;
  reason?: string;
}> {
  const apiKey = getApiKey();
  if (!apiKey) {
    // 未配置 key：预筛命中时仍按 fail-closed 拦截，避免「守卫缺失」放行风险信号
    return opts?.failClosed
      ? { blocked: true, reason: SAFETY_FAILCLOSED_REASON }
      : { blocked: false };
  }

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
          {
            role: 'system',
            content: '你是一个安全检测助手。分析用户输入，只回复JSON: {"score":0-10,"isCrisis":true/false}',
          },
          { role: 'user', content: text },
        ],
        temperature: 0,
        max_tokens: 50,
      }),
      signal: AbortSignal.timeout(5_000),
    });

    if (!response.ok) {
      return opts?.failClosed
        ? { blocked: true, reason: SAFETY_FAILCLOSED_REASON }
        : { blocked: false };
    }

    const data = await response.json() as {
      choices: Array<{ message: { content: string } }>;
    };
    const raw = data.choices[0].message.content || '';
    // 用 {} 提取包裹的 JSON（同 classifyIntent），防 LLM 返回 ```json 或夹带文字导致 JSON.parse 抛错
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return opts?.failClosed
        ? { blocked: true, reason: SAFETY_FAILCLOSED_REASON }
        : { blocked: false };
    }
    const parsed = JSON.parse(jsonMatch[0]);
    // 结构校验：isCrisis 必须 boolean、score 必须有限 number，否则视为守卫结果不可信（fail-closed）
    const validShape =
      typeof parsed.isCrisis === 'boolean' &&
      typeof parsed.score === 'number' &&
      Number.isFinite(parsed.score);

    if (parsed.isCrisis === true) {
      return {
        blocked: true,
        reason: '请拨打24小时心理援助热线：400-161-9995。你不需要一个人面对。',
      };
    }
    if (!validShape) {
      // 不可信响应（缺字段/非数值）：fail-closed 拦截，否则放行
      return opts?.failClosed
        ? { blocked: true, reason: SAFETY_FAILCLOSED_REASON }
        : { blocked: false };
    }
    if (parsed.score >= 8) {
      return { blocked: true, reason: '抱歉，我无法处理这条消息。请尝试与宠物相关的问题。' };
    }
    return { blocked: false };
  } catch {
    // 未命中预筛的良性消息 fail-open（不让守卫故障误伤正常用户）；命中预筛则 fail-closed
    return opts?.failClosed
      ? { blocked: true, reason: SAFETY_FAILCLOSED_REASON }
      : { blocked: false };
  }
}
