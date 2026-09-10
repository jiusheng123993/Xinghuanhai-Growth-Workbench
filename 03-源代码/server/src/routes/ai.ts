/**
 * AI 服务路由 - 对话、安全检测、取名、语音识别、品种识别
 * 集成 DeepSeek 和阿里云百炼 AI 服务
 */
import { Router, type Request, type Response } from 'express';
import multer from 'multer';
import { authMiddleware } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { uploadLimiter, aiRecognizeLimiter, chatLimiter, namingLimiter } from '../middleware/rateLimit.js';
import { chatMessageSchema } from '../schemas/index.js';
import { chat, guardCheck, guardCheckOutput, bailianChat, bailianASR } from '../services/aiService.js';
import { detectOffTopic, OFFTOPIC_REPLY } from '../services/agentRuleIntent.js';
import { saveConversation } from '../services/memoryService.js';
import { recognizeHealthReport } from '../services/healthReportService.js';
import { analyzeImage } from '../services/visionService.js';
import { PetFactRepository } from '../repositories/petFactRepository.js';
import { PetRepository } from '../repositories/petRepository.js';
import { ChatSessionRepository } from '../repositories/chatSessionRepository.js';

const router = Router();

const petFactRepository = new PetFactRepository();
const petRepository = new PetRepository();
const chatSessionRepository = new ChatSessionRepository();

// 共享上传配置：multipart 表单（photo / audio 等）
// 需对 MIME 做白名单——本路由的 /photo-analyze、/breed-recognize、/health-report-recognize、
// /voice 等都会把上传负载转发给**付费**视觉/ASR 模型，若不限类型，任何 Content-Type 负载
// 都能打进来烧算力（对比 timeline.ts /ai-describe 已用同一白名单）。
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'audio/mpeg', 'audio/mp3', 'audio/mp4', 'audio/wav', 'audio/aac', 'audio/m4a'];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('不支持的文件类型'));
    }
  },
});

// 限流：chatLimiter 30次/分钟（2026-09 审查修复：此前未挂载，付费 LLM 入口仅剩全局兜底）
router.post('/chat', authMiddleware, chatLimiter, validate({ body: chatMessageSchema }), async (req: Request, res: Response) => {
  try {
    const { messages, temperature, max_tokens, petId, persistUserContent, sessionId } = req.body;

    // 边界守卫（2026-09 越界收敛）：与 /api/agent/chat 同口径。旧版链路前端 chatService
    // 已有同款确定性拦截，此处补服务端纵深兜底——直连本接口时对与宠物无关的越界话题
    // （人类恋爱/婚恋等）也硬拦截，不调 LLM；软约束 prompt 仍在，此处保证边界确定性。
    const lastUserMessage = (messages as Array<{ role: string; content: unknown }> | undefined)
      ?.filter((m) => m.role === 'user')
      .pop();
    if (lastUserMessage && typeof lastUserMessage.content === 'string' && detectOffTopic(lastUserMessage.content)) {
      res.json({ success: true, data: { content: OFFTOPIC_REPLY } });
      return;
    }

    const result = await chat(messages, { temperature, max_tokens });
    res.json({ success: true, data: { content: result } });

    // 异步写入 Agent 持久化历史（2026-09-10）：旧版链路此前不落库，发图轮/降级轮的对话
    // 退出页面即失忆——用户发图后追问"这是什么猫"跨会话无上下文。写入后 agentLoop 的
    // loadConversationHistory 能召回。归属校验防止把对话记到他人宠物名下（横向越权防线）；
    // saveConversation 内部截断 2000 字且静默失败，绝不阻塞主回复。
    if (typeof petId === 'string' && petId) {
      try {
        const canAccess = await petRepository.canAccess(petId, req.userId as string);
        if (canAccess) {
          // 会话归属校验（多会话 P1 修复）：sessionId 必须属于当前用户，否则落 NULL（宁漏记不越权写元数据）
          let validSessionId: string | null = null;
          if (typeof sessionId === 'string' && sessionId) {
            try {
              const owned = await chatSessionRepository.findByIdAndUser(sessionId, req.userId as string);
              if (owned) validSessionId = sessionId;
            } catch {
              // 校验异常：fail-safe，落 NULL
            }
          }
          const userMessagesToSave = messages.filter((m: { role: string }) => m.role === 'user');
          const lastUser = userMessagesToSave[userMessagesToSave.length - 1];
          // 发图轮前端会传 persistUserContent（"[图片] 文字｜视觉观察：…"合并文本），
          // 与前端 chatHistory 逐字一致：Agent 链路按精确匹配去重才能命中，跨会话也能
          // 召回观察文本；普通文字轮无该字段，存消息原文
          const userContentToSave =
            typeof persistUserContent === 'string' && persistUserContent
              ? persistUserContent
              : lastUser?.content;
          if (userContentToSave) {
            void saveConversation(req.userId as string, petId, 'user', userContentToSave, undefined, validSessionId);
          }
          // 空串回复不落库（审查 P3：避免孤儿空条目）
          if (result) {
            void saveConversation(req.userId as string, petId, 'assistant', result, undefined, validSessionId);
          }
        }
      } catch (err) {
        // 归属校验异常：跳过持久化（fail-safe 宁漏记不越权写），记一行脱敏摘要供观测
        console.warn('[AIChat] 对话持久化跳过（归属校验异常）:', (err as Error).message?.split('\n')[0]?.slice(0, 200));
      }
    }

    // 异步提取宠物特征，不阻塞主回复
    if (petId && typeof petId === 'string' && messages.length > 0) {
      const userMessages = messages.filter((m: { role: string }) => m.role === 'user');
      if (userMessages.length > 0) {
        const lastUserMsg = userMessages[userMessages.length - 1].content;
        extractAndSavePetFacts(petId, req.userId as string, lastUserMsg).catch((err) => {
          console.error('[PetFacts] 提取特征失败:', err.message);
        });
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'AI 服务异常';
    res.status(500).json({ success: false, message });
  }
});

/**
 * 从用户消息中提取宠物特征/喜好/习惯，保存到 pet_facts 表
 */
async function extractAndSavePetFacts(petId: string, userId: string, userMessage: string): Promise<void> {
  // 过滤太短的消息，避免误提取
  if (userMessage.length < 4) return;

  const extractPrompt = `从以下用户消息中提取关于宠物的特征、喜好、习惯或性格信息。
如果消息中包含"记录"、"记住"、"喜欢"、"讨厌"、"习惯"、"性格"等关键词，则提取相关内容。
如果没有明确的宠物特征信息，返回空数组。
返回格式：严格的 JSON 数组，每个元素包含 category 和 fact 字段。
category 可选值：like（喜欢）、dislike（讨厌）、habit（习惯）、personality（性格）、general（其他）
fact 字段：一句话描述具体特征，不超过 100 字。

用户消息：${userMessage}

请只返回 JSON 数组，不要包含其他文字。`;

  try {
    const extractResult = await chat(
      [{ role: 'user', content: extractPrompt }],
      { temperature: 0, max_tokens: 300 }
    );

    // 尝试从回复中提取 JSON 数组
    const jsonMatch = extractResult.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return;

    const facts = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(facts) || facts.length === 0) return;

    for (const fact of facts) {
      if (!fact.fact || typeof fact.fact !== 'string') continue;
      const category = ['like', 'dislike', 'habit', 'personality', 'general'].includes(fact.category)
        ? fact.category
        : 'general';

      await petFactRepository.insertFact(
        petId,
        userId,
        category,
        fact.fact.substring(0, 200),
      );
      console.log(`[PetFacts] 已保存特征: pet=${petId}, category=${category}, fact=${fact.fact.substring(0, 50)}`);
    }
  } catch (err) {
    // 提取失败不影响主流程，仅记录日志
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[PetFacts] 提取特征异常:', msg);
  }
}

router.post('/guard', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { text } = req.body;

    if (!text || typeof text !== 'string') {
      res.status(400).json({ success: false, message: 'text 参数不能为空' });
      return;
    }

    const result = await guardCheck(text);
    res.json({ success: true, data: result });
  } catch (error) {
    const message = error instanceof Error ? error.message : '安全检测异常';
    res.status(500).json({ success: false, message });
  }
});

router.post('/guard/output', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { text } = req.body;

    if (!text || typeof text !== 'string') {
      res.status(400).json({ success: false, message: 'text 参数不能为空' });
      return;
    }

    const result = await guardCheckOutput(text);
    res.json({ isUnsafeMedicalAdvice: result.isUnsafeMedicalAdvice });
  } catch (error) {
    const message = error instanceof Error ? error.message : '输出安全检测异常';
    res.status(500).json({ success: false, message });
  }
});

// 限流：namingLimiter 10次/分钟（2026-09 审查修复：此前取名引擎无限流，属免费 LLM 烧钱面）
router.post('/naming/interpret', authMiddleware, namingLimiter, async (req: Request, res: Response) => {
  try {
    const { name, species, breed, gender } = req.body;

    if (!name || typeof name !== 'string') {
      res.status(400).json({ success: false, message: 'name 参数不能为空' });
      return;
    }

    const systemPrompt = `你是一位专业的宠物取名大师，擅长为${species === 'cat' ? '猫咪' : '狗狗'}取名并解读名字的含义。
请根据用户提供的宠物名字，从字义、寓意、五行、音律、文化内涵等角度进行专业解读。
回复要求：结构化、有深度、语气温暖，控制在 300 字以内。`;

    const messages = [
      { role: 'system' as const, content: systemPrompt },
      {
        role: 'user' as const,
        content: `请解读宠物名字"${name}"，这是一只${breed || ''}${gender === 'male' ? '公' : gender === 'female' ? '母' : ''}${species === 'cat' ? '猫' : '狗'}`,
      },
    ];

    const result = await chat(messages, { temperature: 0.7, max_tokens: 600 });

    let safeResult = result;
    try {
      const guardResult = await guardCheckOutput(result);
      if (guardResult.isUnsafeMedicalAdvice) {
        safeResult = '名字解读生成完成，但部分内容因安全策略已过滤。';
      }
    } catch {
      // guard check failed, return original result
    }

    res.json({ success: true, data: { interpretation: safeResult } });
  } catch (error) {
    const message = error instanceof Error ? error.message : '取名解读异常';
    res.status(500).json({ success: false, message });
  }
});

router.post('/naming/recommend', authMiddleware, namingLimiter, async (req: Request, res: Response) => {
  try {
    const { species, breed, gender, style, count } = req.body;

    if (!species) {
      res.status(400).json({ success: false, message: 'species 参数不能为空' });
      return;
    }

    const countNum = Math.min(Math.max(count || 5, 1), 10);
    const styleText = style || '可爱温馨';

    const systemPrompt = `你是一位专业的宠物取名大师，擅长为${species === 'cat' ? '猫咪' : '狗狗'}取名字。
请根据用户提供的宠物信息，生成 ${countNum} 个${styleText}风格的名字建议。
每个名字附带简短寓意说明（20字以内）。
回复格式要求：严格返回 JSON 数组，每个元素包含 name 和 meaning 字段。`;

    const messages = [
      { role: 'system' as const, content: systemPrompt },
      {
        role: 'user' as const,
        content: `请为一只${breed || ''}${gender === 'male' ? '公' : gender === 'female' ? '母' : ''}${species === 'cat' ? '猫' : '狗'}推荐${countNum}个${styleText}风格的名字。`,
      },
    ];

    const result = await chat(messages, { temperature: 0.9, max_tokens: 800 });

    try {
      const jsonMatch = result.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        const names = JSON.parse(jsonMatch[0]);
        res.json({ success: true, data: { names } });
        return;
      }
    } catch {
      // parse failed, return raw text
    }

    res.json({ success: true, data: { names: [], raw: result } });
  } catch (error) {
    const message = error instanceof Error ? error.message : '取名推荐异常';
    res.status(500).json({ success: false, message });
  }
});

/**
 * 语音转文字接口
 * 接收音频上传，使用 AI 进行语音识别，返回转写文本
 * 限流：uploadLimiter 10次/分钟（2026-09 审查修复：付费 ASR 调用，此前无任何专用限流）
 */
router.post('/voice', authMiddleware, uploadLimiter, upload.single('audio'), async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      res.status(400).json({ success: false, message: '请上传音频文件' });
      return;
    }

    const audioBase64 = req.file.buffer.toString('base64');
    const mimeType = req.file.mimetype || 'audio/mp3';

    const text = await bailianASR(audioBase64, mimeType);

    res.json({
      success: true,
      data: {
        text: text.trim() || '无法识别语音内容',
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : '语音转文字服务异常';
    console.error('[Voice] 语音转文字失败:', message);
    res.status(500).json({ success: false, message });
  }
});

/**
 * 拍照识别品种接口
 * 接收宠物照片上传，使用 AI 多模态能力识别品种
 * 安全：aiRecognizeLimiter 限流（每次=1 次付费视觉 LLM 调用，防算力滥用）
 */
router.post('/breed-recognize', authMiddleware, aiRecognizeLimiter, upload.single('photo'), async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      res.status(400).json({ success: false, message: '请上传宠物照片' });
      return;
    }

    const imageBase64 = req.file.buffer.toString('base64');
    const mimeType = req.file.mimetype || 'image/jpeg';

    const systemPrompt = `你是一个专业的宠物品种识别专家。请根据用户提供的宠物照片，识别出宠物的品种。
    
分析要求：
1. 判断这是狗还是猫
2. 识别具体品种名称（中文名）
3. 给出置信度（0-100）

请严格按以下 JSON 格式返回，不要包含其他文字：
{
  "species": "dog" 或 "cat",
  "breedName": "品种中文名",
  "confidence": 85,
  "reason": "识别依据的简短说明（20字以内）"
}`;

    const result = await bailianChat(
      [
        { role: 'system' as const, content: systemPrompt },
        {
          role: 'user' as const,
          content: [
            {
              type: 'text' as const,
              text: '请识别这张照片中的宠物品种：',
            },
            {
              type: 'image_url' as const,
              image_url: {
                url: `data:${mimeType};base64,${imageBase64}`,
              },
            },
          ],
        },
      ],
      { temperature: 0.1, max_tokens: 300 }
    );

    // 解析 AI 返回的 JSON
    try {
      const jsonMatch = result.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        res.json({ success: false, message: '未能识别出品种，请尝试更清晰的照片' });
        return;
      }

      const parsed = JSON.parse(jsonMatch[0]);
      const species = parsed.species === 'cat' ? 'cat' : 'dog';
      const breedName = parsed.breedName || '';
      const confidence = Math.min(100, Math.max(0, Number(parsed.confidence) || 50));
      const reason = parsed.reason || '';

      if (!breedName) {
        res.json({ success: false, message: '未能识别出品种，请尝试更清晰的照片' });
        return;
      }

      res.json({
        success: true,
        data: {
          species,
          breedName,
          confidence,
          reason,
        },
      });
    } catch {
      res.json({ success: false, message: '品种识别结果解析失败，请重试' });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : '品种识别服务异常';
    console.error('[BreedRecognize] 品种识别失败:', message);
    res.status(500).json({ success: false, message });
  }
});

/**
 * 体检报告识别（回忆录 2.0 F8：Agent 识图能力）
 * 上传体检报告照片 → DeepSeek 视觉提取指标 → 存 health_reports + 写健康事件记忆
 * 安全：uploadLimiter 限流（视觉调用成本高）+ petId 归属校验（防越权写他人宠物）
 */
router.post('/health-report-recognize', authMiddleware, uploadLimiter, upload.single('photo'), async (req: Request, res: Response) => {
  try {
    const { petId } = req.body;
    if (!petId || typeof petId !== 'string') {
      res.status(400).json({ success: false, message: 'petId 参数不能为空' });
      return;
    }
    if (!req.file) {
      res.status(400).json({ success: false, message: '请上传体检报告照片' });
      return;
    }

    // 归属校验（安全红线：不能对他人宠物写健康数据）
    const isOwner = await petRepository.canAccess(petId, req.userId as string);
    if (!isOwner) {
      res.status(404).json({ success: false, message: '宠物不存在或无权操作' });
      return;
    }

    // 图片 → data URL（visionService 支持）
    const mimeType = req.file.mimetype || 'image/jpeg';
    const imageDataUrl = `data:${mimeType};base64,${req.file.buffer.toString('base64')}`;

    const result = await recognizeHealthReport({
      userId: req.userId as string,
      petId,
      imageDataUrl,
      reportDate: typeof req.body.report_date === 'string' ? req.body.report_date : undefined,
    });

    if (!result) {
      res.json({ success: false, message: '未能识别体检报告，请尝试更清晰的照片或手动录入' });
      return;
    }

    res.json({
      success: true,
      data: {
        id: result.id,
        metrics: result.metrics,
        hasAbnormal: result.hasAbnormal,
        rawText: result.rawText,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : '体检报告识别服务异常';
    console.error('[HealthReportRecognize] 识别失败:', message);
    res.status(500).json({ success: false, message });
  }
});

/**
 * 聊天「发图片」视觉分析接口
 * 上传宠物照片 → DeepSeek 视觉模型输出结构化照片描述 → 返回给前端注入对话上下文
 *
 * 背景：聊天页「发图片」此前是占位桩——只发文字、图片未上传，AI 永远"看不到"照片。
 * 本次打通：前端上传 → 本接口识别 → description 注入 system prompt → AI 基于照片回答。
 *
 * 安全：uploadLimiter 限流（每次=1 次付费视觉 LLM 调用，防算力滥用）
 * 不落库（与 timeline/ai-describe 口径一致，前端拿 description 自己用）；
 * 只描述照片**可见内容**，不确诊、不编造照片外信息。
 */
router.post('/photo-analyze', authMiddleware, uploadLimiter, upload.single('photo'), async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      res.status(400).json({ success: false, message: '请上传宠物照片' });
      return;
    }

    const mimeType = req.file.mimetype || 'image/jpeg';
    const imageDataUrl = `data:${mimeType};base64,${req.file.buffer.toString('base64')}`;

    const systemPrompt = `你是"星河宠记"的宠物照片分析助手。用户上传了一张宠物照片，请用简洁、自然的中文输出一段对照片的观察描述，供后续 AI 管家基于照片回答用户问题。
要求：
1. 只描述照片中**能看到**的内容：体型、毛色、花纹、神态、动作、环境、可能的状态特征（如是否精神、被毛状况）。可酌情指出肉眼可见的异常信号（如流泪、红肿、皮屑），但不要下诊断结论。
2. 如能根据外貌特征判断出品种或疑似品种，用"看起来像/疑似 XX 品种"的措辞顺带说明（如"看起来像英国短毛猫"）；判断不了就不提，不要编造。
3. 不要编造照片里看不到的信息（如病史、年龄、性格、喜好）。
4. 语气客观中肯，像一位有经验的宠物观察者。
5. 直接输出描述文字，不要用"AI""生成"等字眼，不要加标题、引号或列表，150 字以内。`;

    const result = await analyzeImage({
      imageUrl: imageDataUrl,
      prompt: systemPrompt,
      maxTokens: 400,
    });

    // 视觉 key 未配置时降级：返回 503，前端提示"AI 分析功能暂不可用"（不再谎称看不到图）
    if (!result) {
      res.status(503).json({ success: false, message: 'AI 视觉能力未配置，无法分析照片' });
      return;
    }

    res.json({ success: true, data: { description: result.trim() } });
  } catch (error) {
    const message = error instanceof Error ? error.message : '照片分析服务异常';
    console.error('[PhotoAnalyze] 照片分析失败:', message);
    res.status(500).json({ success: false, message: '照片分析失败，请重试' });
  }
});

export default router;
