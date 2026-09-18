/**
 * 通用 Zod Schema 定义
 * 所有路由的参数校验 schema 集中管理
 * 按 TECH_DESIGN 3.1 节关键参数定义
 */
import { z } from 'zod';
import { config, MEMOIR_TIER_CONFIG } from '../config.js';

// ===== 通用 Schema =====

/** UUID 格式校验 */
export const uuidSchema = z.string().uuid('ID格式错误');

/**
 * 回忆录照片 URL 白名单（2026-09 审查 P1 SSRF 修复）
 * source_photos 会交给服务端 fetch 下载并交给视觉 LLM，原仅校验 URL 格式：
 * 内网地址（http://169.254.169.254/ 等）可被用作内网探测 + 落盘回读外泄通道。
 * 现仅放行：①本站相对路径 /uploads/...；②https(s) 且主机名为 PUBLIC_BASE_URL 主机或本地回环。
 */
export const memoirPhotoUrlSchema = z.string().max(500, '照片地址过长').superRefine((url, ctx) => {
  // 本站相对路径：由服务端拼 publicBaseUrl 后下载，天然可信
  if (url.startsWith('/uploads/')) return;
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: '照片地址仅支持 http(s)' });
      return;
    }
    const trustedHosts = new Set(['localhost', '127.0.0.1']);
    if (config.publicBaseUrl) {
      trustedHosts.add(new URL(config.publicBaseUrl).hostname);
    }
    if (!trustedHosts.has(u.hostname)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: '照片地址不受信任，仅支持本站上传的照片' });
    }
  } catch {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: '照片地址格式无效' });
  }
});

/** 分页参数 */
export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

/** 排序参数 */
export const sortSchema = z.object({
  sortBy: z.string().optional(),
  order: z.enum(['asc', 'desc']).default('desc'),
});

// ===== 认证模块 =====

/** 微信登录 */
export const wxLoginSchema = z.object({
  code: z.string().min(1, 'code不能为空'),
});

/** 发送短信验证码（App/H5 手机号登录） */
export const sendSmsSchema = z.object({
  phone: z.string().regex(/^1[3-9]\d{9}$/, '手机号格式不正确'),
});

/** 手机号验证码登录（App/H5） */
export const phoneLoginSchema = z.object({
  phone: z.string().regex(/^1[3-9]\d{9}$/, '手机号格式不正确'),
  code: z.string().regex(/^\d{4,6}$/, '验证码格式不正确'),
});

// ===== 宠物模块 =====

/** 创建宠物 */
export const createPetSchema = z.object({
  name: z.string({ error: 'name不能为空' }).min(1, 'name不能为空'),
  species: z.string({ error: 'species不能为空' }).min(1, 'species不能为空'),
  breed: z.string({ error: 'breed不能为空' }).min(1, 'breed不能为空').max(50, 'breed不能超过50字符'),
  breed_id: z.string({ error: 'breed_id不能为空' }).min(1, 'breed_id不能为空'),
  gender: z.string({ error: 'gender不能为空' }).min(1, 'gender不能为空'),
  birth_date: z.string({ error: 'birth_date不能为空' }).min(1, 'birth_date不能为空'),
  weight: z.number().optional(),
  avatar_photo_url: z.string().nullable().optional(),
  avatar_cartoon_url: z.string().nullable().optional(),
  // 全方位角色设定图（迁移 030）：四视图全身参考图，供全家福/回忆录使用；设为当前时写入
  avatar_multiview_url: z.string().nullable().optional(),
  avatar_style: z.string().nullable().optional(),
  photos: z.array(z.unknown()).optional(),
  is_neutered: z.boolean().optional(),
  microchip_id: z.string().optional(),
  notes: z.string().optional(),
});

/** 更新宠物 */
export const updatePetSchema = createPetSchema.partial();

// ===== 健康打卡模块 =====

/** 创建健康打卡
 * 2026-09 审查 P1 收紧：①weight 补范围（负数/巨数入库会污染趋势 AVG）；②risk_level 改枚举
 * （原仅 min(1)，任意串入库，且前端值域为 low/medium/high/emergency）；③note/ai_feedback 补长度上限、
 * anomaly_items 补数组与元素上限——超长文本经 recordHealthMemory 落库后会被无截断拼进 AI 提示词
 * （token 成本 + 间接注入面）。 */
export const createCheckinSchema = z.object({
  poop_level: z.number().int().min(1).max(5),
  appetite_level: z.number().int().min(1).max(5),
  spirit_level: z.number().int().min(1).max(5),
  exercise_level: z.number().int().min(0).max(5),
  weight: z.number().min(0).max(200).optional(),
  has_anomaly: z.boolean().optional(),
  anomaly_items: z.array(z.string().max(50)).max(20).optional(),
  ai_feedback: z.string().max(2000).nullable().optional(),
  // 值域：新版前端上报 {low,medium,high,emergency}（见 miniapp checkinService.mapRiskLevel），
  // 兼容收留旧版小程序的 legacy 值 {normal,caution,warning}（旧版本仍在微信线上分发，
  // 硬拒会导致老版本用户打卡 400）；任意其他串仍然拒绝（修复原 min(1) 任意串入库）
  risk_level: z.enum(['low', 'medium', 'high', 'emergency', 'normal', 'caution', 'warning']),
  note: z.string().max(500).nullable().optional(),
});

// ===== 家庭模块 =====

/** 创建家庭 */
export const createFamilySchema = z.object({
  name: z.string({ error: '家庭名称不能为空' }).trim().min(1, '家庭名称不能为空').max(50, '名称最长50字符'),
  avatarUrl: z.string().url().optional(),
});

/** 更新家庭 */
export const updateFamilySchema = z.object({
  name: z.string().min(1).max(50).optional(),
  avatarUrl: z.string().url().optional(),
});

/** 添加家庭成员 */
export const addFamilyMemberSchema = z.object({
  petId: z.string({ error: '宠物ID不能为空' }).min(1, '宠物ID不能为空').max(100, '宠物ID过长'),
  role: z.string().max(50).optional(),
});

/** 更新家庭成员角色 */
export const updateFamilyMemberRoleSchema = z.object({
  role: z.string({ error: '角色不能为空' }).trim().min(1, '角色不能为空').max(50, '角色最长 50 字符'),
});

/** 凭家庭邀请码加入家庭（多成员共同养宠，2026-08-24） */
export const joinFamilySchema = z.object({
  code: z
    .string({ error: '邀请码不能为空' })
    .trim()
    .min(1, '邀请码不能为空')
    .max(32, '邀请码格式不正确'),
});

/** 8 种标准家庭人关系（2026-08-24） */
export const FAMILY_USER_RELATION_TYPES = [
  'couple',            // 情侣
  'father_daughter',   // 父女
  'father_son',        // 父子
  'mother_daughter',   // 母女
  'mother_son',        // 母子
  'siblings',          // 兄弟姐妹
  'friends',           // 朋友
  'other',             // 其他
] as const;

/** 创建家庭成员（人）关系（owner 管理）：a ↔ b 两人之间的一种关系 */
export const createFamilyUserRelationSchema = z.object({
  userIdA: z.string({ error: '请选择成员 A' }).min(1, '请选择成员 A').max(100, '成员ID过长'),
  userIdB: z.string({ error: '请选择成员 B' }).min(1, '请选择成员 B').max(100, '成员ID过长'),
  relationType: z.enum(FAMILY_USER_RELATION_TYPES, { error: '关系类型不正确' }),
});

/** 上传/保存全家福（用户上传或 Canvas 降级生成） */
export const uploadFamilyPhotoSchema = z.object({
  photoUrl: z.string({ error: 'photoUrl 不能为空' }).trim().min(1, 'photoUrl 不能为空').max(2048, 'photoUrl 过长'),
  photoType: z.enum(['canvas_fallback', 'uploaded'], { error: 'photoType 必须为 canvas_fallback 或 uploaded' }).default('uploaded'),
  memberCount: z.number({ error: 'memberCount 必须为数字' }).int('memberCount 必须为整数').min(0, 'memberCount 不能为负').max(50, 'memberCount 过大').default(0),
  memberNames: z.array(z.string().max(50, '成员名称过长')).max(50, '成员名称最多 50 项').default([]),
  description: z.string().max(500, 'description 最长 500 字符').nullable().optional(),
});

// ===== 食物查询模块 =====

/** 食物查询 */
export const foodQuerySchema = z.object({
  keyword: z.string().min(1, '关键词不能为空').max(50, '关键词最长50字符'),
});

// ===== AI 对话模块 =====

/** 发送对话消息（2026-09 审查 P1 收紧成本上限：此前 messages 无条数/单条长度限、max_tokens 无上限，
 *  10MB body 可直喂付费 LLM 形成烧钱口；20 条 × 4000 字 × max_tokens≤4096 覆盖真实聊天上下文） */
export const chatMessageSchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(['system', 'user', 'assistant']),
        content: z.string().max(4000, '单条消息内容过长'),
      }),
      { error: 'messages 不能为空' },
    )
    .min(1, 'messages 不能为空')
    .max(20, '对话轮数超限（最多 20 条）'),
  temperature: z.number().min(0).max(2).optional(),
  max_tokens: z.number().int().min(1).max(4096).optional(),
  // 思考模式开关（2026-09-10 取名事故修复）：Ark/DeepSeek V4 默认**开启思考**，
  // max_tokens 会被 reasoning_content 吃满 → content 返回空串。需要完整 JSON 正文的
  // 结构化调用（AI 取名推荐/命理解读等）必须显式传 'disabled'，否则调用方只能拿到
  // 空内容、静默降级为本地兜底文案（实测：2048 tokens 全被思考吃掉，content 长度 0）。
  // 路由层透传给 aiService.chat 的 options.thinking（aiService.ts:105 转成 {thinking:{type}}）。
  thinking: z.enum(['enabled', 'disabled']).optional(),
  // .min(1) 对齐 agentChatSchema（2026-09-10 审查 P3：空串 petId 此前在路由内被静默跳过，
  // 提前到 schema 层拒绝，防御纵深）
  petId: z.string().min(1).optional(),
  // 发图轮持久化用户消息的合并文本（可选，2026-09-10 发图带文字配套）：前端把
  // "[图片] 文字｜视觉观察：…"整体传上来落库，与前端 chatHistory 逐字一致——
  // Agent 链路按"role+content 精确匹配"去重，双侧一致才能命中去重，跨会话重进
  // 页面也能召回视觉观察文本。仅作存储用途、不进当轮 prompt；长度上限与
  // saveConversation 内部 2000 截断口径一致
  persistUserContent: z.string().max(2000).optional(),
  // 会话 id（多会话改造 2026-09-10）：旧版 /api/ai/chat 降级链路也按会话落库，避免降级轮消息游离在会话外
  sessionId: z.string().min(1).optional(),
});

// ===== 取名模块 =====

/**
 * 取名推荐（POST /api/ai/naming/recommend）
 *
 * 2026-09-10 补挂：此接口此前**无任何请求体校验**（只有一个 `if (!species)`），
 * 而 express.json 的 body 上限是 10MB —— 单次请求可把近 10MB 文本灌进付费 LLM，
 * 构成成本 DoS 面。这里对齐同类接口的口径：所有自由文本限长、枚举强校验。
 * 同时删除旧 `generateNameSchema`（字段为 petId/style 英文枚举，与实际接口完全不符、
 * 全仓零引用，属死代码）。
 */
export const namingRecommendSchema = z.object({
  species: z.enum(['cat', 'dog'], { error: 'species 必须是 cat 或 dog' }),
  breed: z.string().max(50, 'breed 最长 50 字符').optional(),
  gender: z.enum(['male', 'female', 'unknown']).optional(),
  style: z.string().max(30, 'style 最长 30 字符').optional(),
  count: z.coerce.number().int().min(1).max(10).optional(),
});

/** 取名解读（POST /api/ai/naming/interpret）：name 为用户输入，必须限长 */
export const namingInterpretSchema = z.object({
  name: z.string({ error: 'name 参数不能为空' }).trim().min(1, 'name 参数不能为空').max(20, 'name 最长 20 字符'),
  species: z.enum(['cat', 'dog']).optional(),
  breed: z.string().max(50, 'breed 最长 50 字符').optional(),
  gender: z.enum(['male', 'female', 'unknown']).optional(),
});

/**
 * 取名参考照片外貌提取（POST /api/naming/photo/appearance）
 *
 * photoUrl 复用回忆录照片同源的 SSRF 白名单（仅本站相对路径 /uploads/ 或本站域名），
 * 避免用户传入内网地址让视觉链路变成探测通道。
 * petId（2026-09-10 审查 P1 补）：本接口是**付费视觉调用**，必须做归属校验——
 * 否则任何登录用户都能拿已知站内图片路径（如品牌预设头像）循环刷模型，与体检报告
 * 识别/发图分析共用同一个视觉 key，滥用会外溢成其他付费视觉能力不可用。
 */
export const namingAppearanceSchema = z.object({
  petId: uuidSchema,
  photoUrl: memoirPhotoUrlSchema,
});

// ===== 症状初筛模块 =====

/**
 * 症状初筛
 * AI 建议类字段做限长/类型化校验，防止前端传入任意内容（XSS/注入面收敛）
 */
export const symptomCheckSchema = z.object({
  symptoms: z.array(z.string().max(50), { error: '请提供症状列表' }).min(1, '请提供症状列表').max(20, '症状过多'),
  duration: z.string().max(100).optional(),
  severity: z.string().max(20).optional(),
  additional_info: z.unknown().optional(),
  risk_level: z.enum(['normal', 'caution', 'warning', 'emergency']).optional(),
  possible_conditions: z.array(z.string().max(100)).max(10).optional(),
  ai_advice: z.string().max(2000).nullable().optional(),
  recommended_actions: z.array(z.string().max(200)).max(20).optional(),
  knowledge_match: z.unknown().nullable().optional(),
});

/**
 * AI 深度分析（会员专属，Phase 2）
 * 请求体 = 前端本地初筛结论（规则+图谱依据） + 症状信息；服务端注入宠物档案/打卡/记忆召回
 */
export const aiSymptomAnalysisSchema = z.object({
  symptoms: z.array(z.string().max(50), { error: '请提供症状列表' }).min(1, '请提供症状列表').max(20, '症状过多'),
  symptom_names: z.array(z.string().max(50)).min(1).max(20),
  risk_level: z.enum(['normal', 'caution', 'warning', 'emergency']),
  possible_conditions: z.array(z.string().max(100)).max(10).optional(),
  conclusions: z
    .array(
      z.object({
        text: z.string().max(300),
        basis: z.string().max(20),
        confidence: z.enum(['high', 'medium', 'low']),
      })
    )
    .max(10)
    .optional(),
  duration: z.string().max(100).optional(),
  severity: z.string().max(20).optional(),
});

// ===== 知识图谱模块（Phase 3：热更新 + 用户纠错 + 管理端） =====

/** 用户纠错反馈（小程序端提交） */
export const knowledgeFeedbackSchema = z.object({
  entity_type: z.enum(['disease', 'risk_level', 'advice', 'other'], { error: 'entity_type 不合法' }),
  entity_name: z.string({ error: '请提供被纠错的内容' }).trim().min(1, '请提供被纠错的内容').max(100, '内容名称过长'),
  suggestion: z.string({ error: '请填写纠错建议' }).trim().min(1, '请填写纠错建议').max(1000, '建议过长'),
  check_id: z.string().max(100).optional(),
  pet_id: z.string().max(100).optional(),
});

/** 管理端保存图谱（data 为图谱对象，含 riskRules/diseases 等，服务端合并版本） */
export const adminKnowledgeSchema = z.object({
  data: z.record(z.string(), z.unknown(), { error: 'data 必须为对象' }),
});

/** 管理端审核反馈 */
export const adminReviewSchema = z.object({
  action: z.enum(['approve', 'reject'], { error: 'action 必须为 approve/reject' }),
  note: z.string().max(500).optional(),
});

/** 管理端保存品种知识库（data 含 breeds 数组等，服务端合并版本；细粒度结构校验在路由层做） */
export const adminBreedSchema = z.object({
  data: z.record(z.string(), z.unknown(), { error: 'data 必须为对象' }),
});

// ===== 兑换码模块（2026-08-23） =====

/** 用户兑换码（登录态提交） */
export const redeemSchema = z.object({
  code: z.string({ error: '请填写兑换码' }).trim().min(1, '请填写兑换码').max(50, '兑换码过长'),
});

/** 管理端生成兑换码 */
export const adminRedeemGenerateSchema = z.object({
  count: z.number().int().min(1).max(100).optional(),
  days: z.number().int().min(1).max(36500),
  note: z.string().max(200).optional(),
});

// ===== 记忆模块 =====

/** 记忆列表查询（可按宠物过滤） */
export const memoryListQuerySchema = z.object({
  petId: z.string().optional(),
});

/** 修正记忆内容 */
export const memoryUpdateSchema = z.object({
  content: z.string({ error: '请提供记忆内容' }).trim().min(1, '记忆内容不能为空').max(2000, '记忆内容过长'),
});

// ===== 疫苗模块 =====

/** 添加疫苗记录 */
export const createVaccineSchema = z.object({
  type: z.enum(['vaccine', 'deworm'], { error: '类型必须为 vaccine 或 deworm' }),
  category: z.string({ error: '请提供类别' }).min(1, '请提供类别'),
  date: z.string({ error: '请提供日期和下次日期' }).min(1, '请提供日期和下次日期'),
  next_date: z.string({ error: '请提供日期和下次日期' }).min(1, '请提供日期和下次日期'),
  status: z.string().optional(),
  hospital: z.string().optional(),
  doctor: z.string().optional(),
  notes: z.string().optional(),
  reminder_enabled: z.boolean().optional(),
});

// ===== 会员模块 =====

/** 创建会员订单（旧接口，保留以兼容 membership.ts 旧调用） */
export const createOrderSchema = z.object({
  plan: z.enum(['monthly', 'quarterly', 'yearly'], { error: 'plan 参数无效，可选值：monthly, quarterly, yearly' }),
});

/** 创建会员订阅支付订单（新接口，走支付流程） */
export const createMembershipOrderSchema = z.object({
  plan: z.enum(['monthly', 'quarterly', 'yearly'], {
    error: 'plan 参数无效，可选值：monthly, quarterly, yearly',
  }),
});

// ===== 支付模块 - 创建回忆录订单 =====

/**
 * 创建回忆录付费订单
 *
 * 入参与 createMemoirSchema 保持一致，但走支付流程：
 *   1. 服务端校验归属/并发/参数/价格
 *   2. 创建 pending 订单（product_metadata 存业务上下文）
 *   3. 调微信支付下单，返回 JSAPI 支付参数
 *   4. 前端调起支付 → 微信回调 → 创建 memoir 任务
 */
/** 回忆标签枚举（F4 记忆驱动回忆录：与记忆引擎回忆标签一致） */
const MEMOIR_TAGS = ['milestone', 'daily_joy', 'bonding', 'special_day', 'family', 'health_heal', 'farewell', 'seasonal'] as const;

export const createMemoirOrderSchema = z
  .object({
    pet_id: z.string({ error: 'pet_id 不能为空' }).min(1, 'pet_id 不能为空').max(100, 'pet_id 过长'),
    memoir_type: z.enum(['daily', 'memorial', 'seasonal', 'milestone', 'custom'], {
      error: 'memoir_type 必须为 daily/memorial/seasonal/milestone/custom',
    }),
    // 三档定价体系档位（可选，缺省按 memoir_type 历史规则回退；与 createMemoirSchema 同逻辑）
    tier: z.enum(['light', 'standard', 'full'], { error: 'tier 必须为 light/standard/full' }).optional(),
    source_photos: z
      .array(memoirPhotoUrlSchema, { error: 'source_photos 不能为空' })
      .min(1, '至少需要1张照片'),
    source_text: z.string().max(2000).optional(),
    music_style: z.enum(['warm', 'nostalgic', 'cheerful', 'peaceful']).optional(),
    duration: z.number().int().min(5).max(180).optional(),
    style_preset: z.string().max(100).optional(),
    /** 用户导入的自定义 BGM URL（2026-09-09，合成优先；仅本站 /uploads/ 相对路径） */
    custom_bgm_url: z.string().max(500).optional(),
    // F4：回忆标签（与 createMemoirSchema 一致，走支付流程也透传）
    tags: z.array(z.enum(MEMOIR_TAGS, { error: 'tags 必须是有效回忆标签' })).max(8).optional(),
    // G2 记忆勾选（透传进订单 product_metadata → 回调后建任务）
    selected_moment_ids: z.array(z.string().uuid({ error: 'selected_moment_ids 必须为 UUID' })).max(10, '最多勾选 10 条回忆').optional(),
  })
  .superRefine((data, ctx) => {
    // 解析档位（与 createMemoirSchema 同逻辑：显式 tier 优先，缺省按类型回退）
    const tier = data.tier ?? (data.memoir_type === 'memorial' ? 'full' : 'light');
    // 档位边界直接从 MEMOIR_TIER_CONFIG 派生（审查 P2-8：消除手抄字面量漂移风险）
    const tierCfg = MEMOIR_TIER_CONFIG[tier];
    if (data.source_photos.length < tierCfg.minPhotos || data.source_photos.length > tierCfg.maxPhotos) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['source_photos'],
        message: `source_photos 照片数量需 ${tierCfg.minPhotos}-${tierCfg.maxPhotos} 张，当前 ${data.source_photos.length} 张`,
      });
    }
    if (data.duration !== undefined) {
      if (data.duration < tierCfg.minDuration || data.duration > tierCfg.maxDuration) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['duration'],
          message: `duration 时长需 ${tierCfg.minDuration}-${tierCfg.maxDuration} 秒，当前 ${data.duration} 秒`,
        });
      }
    }
  });

// ===== 时间线模块 =====

/** 创建时间线事件 - 回忆类型白名单 */
export const timelineMomentTypeSchema = z.enum(
  ['memory', 'diary', 'milestone', 'photo', 'note'],
  { error: 'type 必须为 memory/diary/milestone/photo/note' },
);

/** 创建时间线事件 */
export const createTimelineEventSchema = z.object({
  petId: z.string({ error: '请提供宠物ID' }).min(1, '请提供宠物ID').max(100, '宠物ID过长'),
  /**
   * 这条回忆还属于哪些宠物（多宠共同回忆，2026-09-11 新增）
   *
   * 【为什么不用新列】归属信息写进 pet_moments.content（JSONB）即可 —— 表结构零变更、不需要数据库迁移；
   *   petId 仍表示**主宠物**（= petIds[0]，服务端会强制把 petId 放进 pets 的第一位），
   *   按宠物维度读取的路径（回忆录素材盘点、按宠物查询回忆）行为不变。
   *   ⚠️ 不含"家庭动态"：那张表读的是 pet_health_entries / pet_family_feeds，从不读 pet_moments。
   * 【服务端会做什么】逐个校验归属（不允许拿别人的宠物 id 来贴标签），
   *   并用数据库里的**真实名字/物种**生成 content.pets，不信任客户端传来的名字。
   */
  petIds: z
    .array(z.string({ error: '宠物ID不能为空' }).min(1, '宠物ID不能为空').max(100, '宠物ID过长'))
    .max(10, '一条回忆最多关联 10 只宠物')
    .optional(),
  type: timelineMomentTypeSchema.optional(),
  content: z.record(z.string(), z.unknown()).optional(),
  /**
   * 照片地址列表（最多 9 张）
   * 格式约束：只允许站内相对路径（/uploads/...）或 http(s) 完整地址，
   * 防止任意字符串/协议注入（与 createFeedSchema 的 url 校验口径一致）
   */
  photos: z
    .array(
      z
        .string({ error: '照片地址不能为空' })
        .min(1, '照片地址不能为空')
        .refine((v) => /^(\/|https?:\/\/)/i.test(v), '照片地址必须是 /uploads 路径或 http(s) 地址'),
    )
    .max(9, 'photos 最多 9 张')
    .optional(),
  /**
   * 回忆发生日期（补记支撑）：YYYY-MM-DD 纯日期，不传则默认今天
   * refine 双重校验：①必须能解析为合法日期；②禁止未来日期（防污染时间线排序，
   * 前端 Picker 已限 end=today，这里 API 兜底，容忍 24h 时钟偏差）
   */
  happenedAt: z
    .string({ error: 'happenedAt 格式不正确' })
    .max(32, 'happenedAt 过长')
    .refine((v) => !Number.isNaN(new Date(v).getTime()), 'happenedAt 不是合法日期')
    .refine((v) => new Date(v).getTime() <= Date.now() + 24 * 60 * 60 * 1000, 'happenedAt 不能是未来日期')
    .optional(),
});

/** AI 润色回忆文案请求 */
export const timelineAiPolishSchema = z.object({
  text: z.string({ error: 'text 不能为空' }).trim().min(1, '文案不能为空').max(1000, '文案过长，最多 1000 字'),
});

// ===== 回忆录模块 =====

/** 回忆录档位枚举（2026-09-09 三档定价体系：light 轻纪念 / standard 标准回忆录 / full 完整回忆录） */
const MEMOIR_TIERS = ['light', 'standard', 'full'] as const;

/**
 * 创建回忆录任务
 * 档位 tier（可选）决定照片数与时长校验：
 *   - light：1-3 张，5-30 秒（轻纪念）
 *   - standard：5-7 张，40-50 秒（标准回忆录）
 *   - full：8-15 张，60-90 秒（完整回忆录）
 * tier 缺省时按 memoir_type 历史规则回退（memorial→full，其余→light），兼容旧客户端。
 * 勾选记忆 selected_moment_ids（可选）：时光线回忆 ID 列表，仅勾选的进入旁白锚定。
 */
export const createMemoirSchema = z
  .object({
    memoir_type: z.enum(['daily', 'memorial', 'seasonal', 'milestone', 'custom'], { error: 'memoir_type 必须为 daily/memorial/seasonal/milestone/custom' }),
    tier: z.enum(MEMOIR_TIERS, { error: 'tier 必须为 light/standard/full' }).optional(),
    source_photos: z.array(memoirPhotoUrlSchema, { error: 'source_photos 不能为空' })
      .min(1, '至少需要1张照片'),
    source_text: z.string().max(2000).optional(),
    music_style: z.enum(['warm', 'nostalgic', 'cheerful', 'peaceful']).optional(),
    duration: z.number().int().min(5).max(180).optional(),
    style_preset: z.string().max(100).optional(),
    /** 用户导入的自定义 BGM URL（2026-09-09，合成优先；仅本站 /uploads/ 相对路径） */
    custom_bgm_url: z.string().max(500).optional(),
    // F4：回忆标签（用户选，分镜按标签筛核心层记忆）
    tags: z.array(z.enum(MEMOIR_TAGS, { error: 'tags 必须是有效回忆标签' })).max(8).optional(),
    // G2 记忆勾选：仅勾选的时光线回忆进入旁白锚定（用户控制权，后端逐条校验归属）
    selected_moment_ids: z.array(z.string().uuid({ error: 'selected_moment_ids 必须为 UUID' })).max(10, '最多勾选 10 条回忆').optional(),
  })
  .superRefine((data, ctx) => {
    // 解析档位：显式 tier 优先，缺省按 memoir_type 历史规则回退（与 resolveMemoirTier 同逻辑）
    const tier = data.tier ?? (data.memoir_type === 'memorial' ? 'full' : 'light');
    // 档位边界直接从 MEMOIR_TIER_CONFIG 派生（审查 P2-8：消除手抄字面量漂移风险）
    const tierCfg = MEMOIR_TIER_CONFIG[tier];
    if (data.source_photos.length < tierCfg.minPhotos || data.source_photos.length > tierCfg.maxPhotos) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['source_photos'],
        message: `source_photos 照片数量需 ${tierCfg.minPhotos}-${tierCfg.maxPhotos} 张，当前 ${data.source_photos.length} 张`,
      });
    }
    if (data.duration !== undefined) {
      if (data.duration < tierCfg.minDuration || data.duration > tierCfg.maxDuration) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['duration'],
          message: `duration 时长需 ${tierCfg.minDuration}-${tierCfg.maxDuration} 秒，当前 ${data.duration} 秒`,
        });
      }
    }
  });

// ===== 家庭动态墙模块 =====

/** 创建家庭动态 */
export const createFeedSchema = z.object({
  feed_type: z.enum(
    ['moment', 'achievement', 'health_milestone', 'family_event'],
    { error: 'feed_type 无效' },
  ),
  content: z.string({ error: 'content 不能为空' })
    .min(1, 'content 不能为空')
    .max(2000, 'content 最长 2000 字符'),
  pet_id: z.string().optional(),
  photos: z.array(z.string().url(), { error: 'photos 必须为合法 URL 数组' })
    .max(9, 'photos 最多 9 张')
    .optional(),
});

/** 更新家庭动态 */
export const updateFeedSchema = z.object({
  content: z.string({ error: 'content 不能为空' })
    .min(1, 'content 不能为空')
    .max(2000, 'content 最长 2000 字符')
    .optional(),
  photos: z.array(z.string().url(), { error: 'photos 必须为合法 URL 数组' })
    .max(9, 'photos 最多 9 张')
    .optional(),
});

/** 家庭动态查询参数 */
export const feedQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(100).default(20),
  feed_type: z.string().optional(),
  pet_id: z.string().optional(),
});

// ===== 家庭周报模块 =====

/** 家庭周报列表查询参数 */
export const weeklyReportQuerySchema = z.object({
  page: z.coerce.number().int().min(1, 'page 最小为 1').default(1),
  page_size: z.coerce.number().int().min(1, 'page_size 最小为 1').max(100, 'page_size 最大为 100').default(20),
  year: z.coerce.number().int().min(2020, 'year 不合法').max(2100, 'year 不合法').optional(),
});

// ===== 分享卡片模块 =====

/** 生成分享卡片请求 */
export const generateShareCardSchema = z.object({
  card_type: z.enum(
    ['health_report', 'weekly_summary', 'milestone', 'family_tree', 'memoir', 'naming', 'birthday', 'achievement', 'daily_moment', 'yearly_review'],
    { error: 'card_type 无效' },
  ),
  source_data: z
    .object({
      report_id: z.string().optional(),
      memoir_id: z.string().optional(),
      pet_id: z.string().optional(),
      milestone_id: z.string().optional(),
      snapshot_id: z.string().optional(),
      name_history_id: z.string().optional(),
      feed_id: z.string().optional(),
      custom_text: z.string().max(500, 'custom_text 最长 500 字符').optional(),
      custom_photos: z.array(z.string().url(), { error: 'custom_photos 必须为合法 URL 数组' })
        .max(9, 'custom_photos 最多 9 张')
        .optional(),
    })
    .refine(
      (data) => Object.values(data).some((v) => v !== undefined),
      { message: 'source_data 不能为空' },
    ),
  style: z
    .object({
      theme: z.enum(['warm', 'elegant', 'cute', 'minimal']).optional(),
      background_color: z.string().max(20, 'background_color 最长 20 字符').optional(),
      font_family: z.string().max(50, 'font_family 最长 50 字符').optional(),
    })
    .optional(),
});

/** 分享行为请求（记录分享） */
export const shareActionSchema = z.object({
  share_channel: z.enum(['wechat', 'moments', 'save', 'copy'], { error: 'share_channel 无效' }),
});

/** 分享卡片列表查询参数 */
export const shareCardQuerySchema = z.object({
  page: z.coerce.number().int().min(1, 'page 最小为 1').default(1),
  page_size: z.coerce.number().int().min(1, 'page_size 最小为 1').max(100, 'page_size 最大为 100').default(20),
  card_type: z.string().optional(),
});

// ===== 家族图谱模块 =====

/** 关系类型枚举（血缘+非血缘） */
const RELATION_TYPES = ['friend', 'rival', 'companion', 'parent_child', 'sibling', 'mate', 'other'] as const;

/** 创建宠物关系 */
export const createRelationshipSchema = z
  .object({
    pet_id_a: z.string({ error: 'pet_id_a 不能为空' }).min(1, 'pet_id_a 不能为空'),
    pet_id_b: z.string({ error: 'pet_id_b 不能为空' }).min(1, 'pet_id_b 不能为空'),
    relation_type: z.enum(RELATION_TYPES, { error: 'relation_type 无效' }),
    direction: z.enum(['a_to_b', 'b_to_a', 'mutual']).optional(),
    label_a: z.string().max(50, 'label_a 最长 50 字符').optional(),
    label_b: z.string().max(50, 'label_b 最长 50 字符').optional(),
  })
  .refine((data) => data.pet_id_a !== data.pet_id_b, {
    message: 'pet_id_a 和 pet_id_b 不能相同',
    path: ['pet_id_b'],
  });

/** 更新宠物关系（仅允许更新 label） */
export const updateRelationshipSchema = z.object({
  label_a: z.string().max(50, 'label_a 最长 50 字符').optional(),
  label_b: z.string().max(50, 'label_b 最长 50 字符').optional(),
});

/** 创建血缘关系 */
export const createLineageSchema = z
  .object({
    parent_id: z.string({ error: 'parent_id 不能为空' }).min(1, 'parent_id 不能为空'),
    child_id: z.string({ error: 'child_id 不能为空' }).min(1, 'child_id 不能为空'),
    litter_date: z.string().optional(),
  })
  .refine((data) => data.parent_id !== data.child_id, {
    message: 'parent_id 和 child_id 不能相同',
    path: ['child_id'],
  });

/** 创建家族图谱快照 */
export const createSnapshotSchema = z.object({
  layout_type: z.enum(['tree', 'radial', 'force', 'manual'], { error: 'layout_type 无效' }),
  graph_data: z.record(z.string(), z.unknown(), { error: 'graph_data 不能为空' }),
  thumbnail_url: z.string().url('thumbnail_url 必须为合法 URL').optional(),
});

/** 快照列表查询参数 */
export const snapshotQuerySchema = z.object({
  page: z.coerce.number().int().min(1, 'page 最小为 1').default(1),
  page_size: z.coerce.number().int().min(1, 'page_size 最小为 1').max(100, 'page_size 最大为 100').default(20),
});

// ===== 年度回忆图集模块 =====

/** 创建年度回忆请求 */
export const createYearlyReviewSchema = z.object({
  year: z
    .number({ error: 'year 必须为整数' })
    .int('year 必须为整数')
    .min(2000, 'year 不合法')
    .max(2100, 'year 不合法'),
  auto_select: z.boolean().optional(),
  custom_photos: z
    .array(z.string().url(), { error: 'custom_photos 必须为合法 URL 数组' })
    .max(100, 'custom_photos 最多 100 张')
    .optional(),
  title: z.string().max(100, 'title 最长 100 字符').optional(),
});

/** 更新年度回忆请求 */
export const updateYearlyReviewSchema = z.object({
  title: z.string().max(100, 'title 最长 100 字符').optional(),
  review_data: z
    .object({
      sections: z
        .array(
          z.object({
            type: z.enum(['monthly', 'milestone', 'health', 'growth'], {
              error: 'section.type 无效',
            }),
            photos: z.array(z.string().url()).max(50),
            title: z.string().max(100),
            description: z.string().max(500),
          }),
        )
        .max(50, 'sections 最多 50 项')
        .optional(),
    })
    .optional(),
  cover_url: z.string().url('cover_url 必须为合法 URL').optional(),
});

/** 年度列表查询参数 */
export const yearlyReviewListQuerySchema = z.object({
  page: z.coerce.number().int().min(1, 'page 最小为 1').default(1),
  page_size: z.coerce.number().int().min(1, 'page_size 最小为 1').max(100, 'page_size 最大为 100').default(20),
});

// ===== 排行榜模块 =====

/** 排行榜查询参数 */
export const leaderboardQuerySchema = z.object({
  period: z.enum(['weekly', 'monthly', 'all_time'], { error: 'period 无效' }).default('weekly'),
});

/** 分配角色请求 */
export const assignRoleSchema = z.object({
  pet_id: z.string({ error: 'pet_id 不能为空' }).min(1, 'pet_id 不能为空'),
  role_type: z.enum(
    ['guardian', 'comedian', 'sleepyhead', 'gourmet', 'athlete', 'princess', 'explorer', 'baby'],
    { error: 'role_type 无效' },
  ),
  assignment: z
    .string({ error: 'assignment 不能为空' })
    .min(1, 'assignment 不能为空')
    .max(100, 'assignment 最长 100 字符'),
});

/** 更新角色请求 */
export const updateRoleSchema = z.object({
  assignment: z.string().max(100, 'assignment 最长 100 字符').optional(),
  role_type: z
    .enum(['guardian', 'comedian', 'sleepyhead', 'gourmet', 'athlete', 'princess', 'explorer', 'baby'], {
      error: 'role_type 无效',
    })
    .optional(),
});

// ===== 健康打卡模块 - Query 参数 =====

/** 打卡历史查询参数 */
export const checkinHistoryQuerySchema = z.object({
  days: z.coerce.number().int('days 必须为整数').min(1, 'days 最小为 1').max(365, 'days 最大为 365').default(30),
});

// ===== 症状初筛模块 - Query 参数 =====

/** 症状初筛历史查询参数（分页） */
export const symptomHistoryQuerySchema = z.object({
  page: z.coerce.number().int('page 必须为整数').min(1, 'page 最小为 1').default(1),
  page_size: z.coerce.number().int('page_size 必须为整数').min(1, 'page_size 最小为 1').max(50, 'page_size 最大为 50').default(20),
});

// ===== 时间线模块 - Query 参数 =====

/** 回忆列表查询参数 */
export const timelineMomentsQuerySchema = z.object({
  pet_id: z.string().min(1, 'pet_id 不能为空').optional(),
  family_id: z.string().min(1, 'family_id 不能为空').optional(),
  limit: z.coerce.number().int('limit 必须为整数').min(1, 'limit 最小为 1').max(100, 'limit 最大为 100').default(50),
});

// ===== Agent 模块 - Query 参数 =====

/** Agent 对话历史查询参数 */
export const agentHistoryQuerySchema = z.object({
  petId: z.string().min(1, 'petId 不能为空').optional(),
  sessionId: z.string().min(1, 'sessionId 不能为空').optional(),
  limit: z.coerce.number().int('limit 必须为整数').min(1, 'limit 最小为 1').max(100, 'limit 最大为 100').default(20),
});

/** Agent 对话请求 */
export const agentChatSchema = z.object({
  message: z.string({ error: 'message 不能为空' }).trim().min(1, 'message 不能为空').max(2000, '消息过长，最多 2000 字'),
  history: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string().max(1000),
      }),
    )
    .max(10, 'history 最多 10 条')
    .optional(),
  petId: z.string().min(1, 'petId 不能为空').optional(),
  sessionId: z.string().min(1, 'sessionId 不能为空').optional(),
});

/** 新建聊天会话请求（多会话改造 2026-09-10） */
export const createChatSessionSchema = z.object({
  petId: z.string().min(1, 'petId 不能为空').optional(),
});

/** 会话 id 路径参数 */
export const sessionIdParamsSchema = z.object({
  id: z.string().min(1, 'id 不能为空'),
});

// ===== 健康趋势模块 - Query 参数 =====

/** 趋势图查询参数 */
export const trendQuerySchema = z.object({
  type: z.enum(['weight', 'appetite', 'poop'], { error: 'type 必须为 weight, appetite 或 poop' }).default('weight'),
  days: z.coerce.number().int('days 必须为整数').min(1, 'days 最小为 1').max(365, 'days 最大为 365').default(30),
});

/** 月度报告查询参数 */
export const trendReportQuerySchema = z.object({
  year: z.coerce.number().int('year 必须为整数').min(2000, 'year 不合法').max(2100, 'year 不合法').optional(),
  month: z.coerce.number().int('month 必须为整数').min(1, 'month 最小为 1').max(12, 'month 最大为 12').optional(),
});

// ===== 家庭模块 - Query 参数 =====

/** 家庭动态列表查询参数 */
export const familyMomentsQuerySchema = z.object({
  limit: z.coerce.number().int('limit 必须为整数').min(1, 'limit 最小为 1').max(100, 'limit 最大为 100').default(20),
});

/** 家庭新动态查询参数（since 时间戳必填） */
export const familyNewMomentsQuerySchema = z.object({
  since: z.string({ error: 'since 参数不能为空' }).min(1, 'since 参数不能为空'),
});

// ===== 全家福合成模块 =====

/**
 * 全家福场景 key 白名单（22 个，五大主题）。
 * schema 层保持零依赖故在此内联声明，但提为具名导出以便单测与服务端
 * familyPhotoService.ts 的 FAMILY_PHOTO_SCENES 做"双向"集合相等断言——
 * 只锁"服务端 ⊆ schema"会漏掉"schema 侧多加了 key 但服务端没写 SCENE_PROMPTS"的情况
 * （运行时会把字符串 "undefined" 拼进提示词）。改场景清单时两处必须同步。
 */
export const FAMILY_PHOTO_SCENE_KEYS = [
  // 居家时光
  'livingroom', 'window', 'futon', 'bookshelf',
  // 四季自然
  'sakura', 'garden', 'autumn', 'snow', 'lavender', 'forest',
  // 节日庆典
  'christmas', 'birthday', 'lunarnewyear', 'midautumn',
  // 旅行见闻
  'seaside', 'roof', 'cafe', 'camping',
  // 梦幻唯美
  'aurora', 'clouds', 'monet', 'ocean',
] as const

/** 全家福生成请求 */
export const generateFamilyPhotoSchema = z.object({
  style: z
    .string({ error: 'style 不能为空' })
    .refine(
      (val) => ['pixar', 'ghibli', 'oil', 'ink', 'nordic', 'cyberpunk'].includes(val),
      { message: 'style 必须为 pixar / ghibli / oil / ink / nordic / cyberpunk 之一' },
    ),
  // 场景（可选）：全家福的"地点感"，不传时服务端用默认温馨客厅；key 白名单见 FAMILY_PHOTO_SCENE_KEYS
  scene: z
    .string()
    .refine((val) => (FAMILY_PHOTO_SCENE_KEYS as readonly string[]).includes(val), {
      message: 'scene 必须为支持的全家福场景之一',
    })
    .optional(),
  // 自定义场景（可选）：用户自己写的一句场景描述（如"在我家的院子里"），
  // 服务端清洗截断后拼进提示词；与 scene 二选一或同时使用均可
  customScene: z
    .string({ error: 'customScene 不能为空' })
    .trim()
    .min(1, '自定义场景不能为空')
    .max(60, '自定义场景最长 60 字')
    .optional(),
  // 成员排位（可选）：petId 有序数组，顺序=画面从左到右座次；
  // 服务端按此重排成员并写"从左到右依次是…"，未知 id 静默忽略（稳定排序追加在后）
  memberOrder: z
    .array(z.string().uuid('memberOrder 内必须是合法宠物 id'))
    .max(20, 'memberOrder 最多 20 个成员')
    .optional(),
});

// ===== 回忆录模块 - Query 参数 =====

/** 回忆录列表查询参数（分页） */
export const memoirListQuerySchema = z.object({
  page: z.coerce.number().int('page 必须为整数').min(1, 'page 最小为 1').default(1),
  page_size: z.coerce.number().int('page_size 必须为整数').min(1, 'page_size 最小为 1').max(100, 'page_size 最大为 100').default(20),
});

/** 回忆录预览请求 */
export const memoirPreviewSchema = z.object({
  memoir_id: z.string({ error: 'memoir_id 不能为空' }).min(1, 'memoir_id 不能为空'),
});

/**
 * 提示词改写请求（2026-09-09 人机协同）：用户对当前提示词提修改要求 → LLM 出下一版。
 * segments 沿用分镜段结构（宽松版，只要求能定位到要改的段），严格校验在 LLM 返回后做。
 */
export const memoirPromptRefineSchema = z.object({
  /** 当前版本的分镜段（photo_index 定位，seedance_prompt/narration 为改写目标） */
  segments: z
    .array(
      z.object({
        photo_index: z.number().int().min(0).max(30),
        seedance_prompt: z.string().min(1).max(2000),
        narration: z.string().max(500).optional(),
        shot_type: z.string().max(30).optional(),
        camera: z.string().max(30).optional(),
        lighting: z.string().max(30).optional(),
        transition: z.string().max(30).optional(),
        duration_sec: z.number().int().min(2).max(10).optional(),
      }),
    )
    .min(1, '至少需要一组提示词段')
    .max(15, '最多 15 段'),
  /** 用户修改要求（如"更温馨一点""第一段改成傍晚光线"） */
  user_request: z.string({ error: '请填写修改要求' }).min(1, '请填写修改要求').max(500, '修改要求过长'),
});

/** 提示词确认请求（2026-09-09 人机协同）：用户确认最终版提示词 → 留存作证 */
export const memoirPromptConfirmSchema = z.object({
  tier: z.enum(['light', 'standard', 'full'], { error: 'tier 必须为 light/standard/full' }),
  script: z.record(z.string(), z.unknown(), { error: 'script 不能为空' }),
});

// ===== 疫苗模块 - Body 参数 =====

/** 设置疫苗提醒请求 */
export const vaccineReminderSchema = z.object({
  reminder_enabled: z.boolean({ error: '请提供 reminder_enabled 布尔值' }),
});

// ===== 宠物模块 - Body 参数 =====

/** 宠物离世标记请求 */
export const petDeceasedSchema = z.object({
  deceased_date: z.string().min(1, 'deceased_date 不能为空').optional(),
});

// ===== 慢性病追踪模块 =====

/** 创建慢性病记录 */
export const createChronicRecordSchema = z.object({
  condition: z.string({ error: 'condition 不能为空' }).trim().min(1, 'condition 不能为空').max(100, 'condition 最长 100 字符'),
  diagnosed_date: z.string({ error: 'diagnosed_date 不能为空' }).regex(/^\d{4}-\d{2}-\d{2}$/, '诊断日期格式应为 YYYY-MM-DD'),
  severity: z.enum(['mild', 'moderate', 'severe'], { error: 'severity 必须为 mild/moderate/severe' }).default('moderate'),
  status: z.enum(['active', 'managed', 'resolved'], { error: 'status 必须为 active/managed/resolved' }).default('active'),
  medications: z.array(z.string().max(100, '药品名称过长')).max(20, '药品最多 20 项').optional(),
  vet_name: z.string().max(50, 'vet_name 最长 50 字符').nullable().optional(),
  vet_contact: z.string().max(20, 'vet_contact 最长 20 字符').nullable().optional(),
  next_checkup_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '复查日期格式应为 YYYY-MM-DD').nullable().optional(),
  notes: z.string().max(500, 'notes 最长 500 字符').nullable().optional(),
  symptoms: z.array(z.string().max(50, '症状名称过长')).max(20, '症状最多 20 项').optional(),
});

/** 更新慢性病记录（全部字段可选） */
export const updateChronicRecordSchema = createChronicRecordSchema.partial();

/** 慢性病 AI 分析（会员专属）
 * 请求体最小化：慢病数据从服务端 pet_chronic_records 权威读取，focus 仅用于 prompt 定制
 */
export const chronicAiAnalysisSchema = z.object({
  focus: z.string().max(200, '关注点过长').optional(),
});

/** 慢性病风险扫描（会员专属）
 * 无请求体参数：数据全部从服务端权威读取（打卡/档案/记忆）
 */
export const chronicRiskScanSchema = z.object({}).strict();

// ===== 喂养记录模块 =====

/** 创建喂养记录 */
export const createFeedingRecordSchema = z.object({
  date: z.string({ error: 'date 不能为空' }).regex(/^\d{4}-\d{2}-\d{2}$/, '日期格式应为 YYYY-MM-DD'),
  food_type: z.string({ error: 'food_type 不能为空' }).trim().min(1, 'food_type 不能为空').max(50, 'food_type 最长 50 字符'),
  brand: z.string().max(50, 'brand 最长 50 字符').nullable().optional(),
  amount: z.number({ error: 'amount 必须为数字' }).min(0, 'amount 不能为负').max(9999, 'amount 过大').default(0),
  unit: z.string().max(20, 'unit 最长 20 字符').nullable().optional(),
  meal_time: z.string().max(20, 'meal_time 最长 20 字符').nullable().optional(),
  appetite: z.enum(['good', 'normal', 'poor'], { error: 'appetite 必须为 good/normal/poor' }).nullable().optional(),
  stool: z.enum(['normal', 'loose', 'hard'], { error: 'stool 必须为 normal/loose/hard' }).nullable().optional(),
  energy: z.enum(['high', 'normal', 'low'], { error: 'energy 必须为 high/normal/low' }).nullable().optional(),
  notes: z.string().max(500, 'notes 最长 500 字符').nullable().optional(),
});

/**
 * 更新喂养记录（全部字段可选）
 *
 * ⚠️【2026-09-11 修复】不能直接 `createFeedingRecordSchema.partial()`：
 *   `partial()` 只把字段变成可选，`amount` 上的 `.default(0)` **依然生效** ——
 *   于是"只想改备注"的请求（body 里没有 amount）会被 zod 补成 `amount: 0`，
 *   仓储层 `COALESCE($6, amount)` 拿到的是 0 而不是 NULL，**把用户原有的喂食量清零**。
 *   （实测：`{date, notes}` → 解析结果 `{amount: 0, notes}`。）
 *   这里显式把 amount 重定义为"纯可选"（无默认值），未传时保持 undefined →
 *   仓储层 COALESCE 收到 NULL → 维持原值。
 */
export const updateFeedingRecordSchema = createFeedingRecordSchema.partial().extend({
  amount: z.number({ error: 'amount 必须为数字' }).min(0, 'amount 不能为负').max(9999, 'amount 过大').optional(),
});

/** 喂养建议 AI 分析（会员专属）
 * 请求体 = 前端规则引擎产出的喂养画像；服务端注入宠物档案/喂养记录/记忆召回后调 LLM
 */
export const feedingAiAnalysisSchema = z.object({
  pet_name: z.string({ error: 'pet_name 不能为空' }).trim().min(1, 'pet_name 不能为空').max(30, 'pet_name 最长 30 字符'),
  species: z.enum(['dog', 'cat'], { error: 'species 必须为 dog/cat' }),
  breed: z.string().max(30, 'breed 最长 30 字符').optional().default(''),
  age_months: z.number().int('age_months 必须为整数').min(0, 'age_months 不能为负').max(600, 'age_months 过大').optional().default(0),
  weight: z.number().min(0, 'weight 不能为负').max(500, 'weight 过大').optional().default(0),
  body_condition: z.enum(['underweight', 'normal', 'overweight'], { error: 'body_condition 不合法' }).optional().default('normal'),
  is_puppy_kitten: z.boolean().optional().default(false),
  is_senior: z.boolean().optional().default(false),
  is_neutered: z.boolean().optional().default(false),
  chronic_conditions: z.array(z.string().max(30, '慢病名过长')).max(10, '慢病过多').optional().default([]),
  allergies: z.array(z.string().max(30, '过敏原过长')).max(10, '过敏原过多').optional().default([]),
  recent_appetite: z.enum(['good', 'normal', 'poor']).nullable().optional(),
  recent_stool: z.enum(['normal', 'loose', 'hard']).nullable().optional(),
  current_advice: z.string().max(2000, '规则建议过长').optional().default(''),
});

// ===== AI 建议记录模块（效果追踪） =====

/** 创建建议记录 */
export const createSuggestionRecordSchema = z.object({
  type: z.enum(['feeding', 'symptom', 'trend', 'chat'], { error: 'type 必须为 feeding/symptom/trend/chat' }),
  title: z.string({ error: 'title 不能为空' }).trim().min(1, 'title 不能为空').max(100, 'title 最长 100 字符'),
  content: z.string({ error: 'content 不能为空' }).trim().min(1, 'content 不能为空').max(1000, 'content 最长 1000 字符'),
  priority: z.enum(['high', 'medium', 'low'], { error: 'priority 必须为 high/medium/low' }).default('medium'),
});

/** 更新建议采纳状态 */
export const updateSuggestionAdoptionSchema = z.object({
  adopted: z.boolean({ error: 'adopted 必须为布尔值' }),
});
