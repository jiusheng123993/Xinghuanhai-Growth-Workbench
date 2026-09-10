/**
 * AI Agent 路由 - 智能对话和工具调用
 * 支持 SSE 流式对话、对话历史加载、工具列表查询
 */
import { Router, type Request, type Response } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { agentHistoryQuerySchema, agentChatSchema, createChatSessionSchema, sessionIdParamsSchema } from '../schemas/index.js';
import { chatLimiter } from '../middleware/rateLimit.js';
import { agentLoop, guardCheckInput, preScreenRisk, type AgentContext, type ChatMessage } from '../services/agentService.js';
import { detectOffTopic, OFFTOPIC_REPLY } from '../services/agentRuleIntent.js';
import { loadConversationHistory, saveConversation } from '../services/memoryService.js';
import { PetRepository } from '../repositories/petRepository.js';
import { ChatSessionRepository, toSessionSummary } from '../repositories/chatSessionRepository.js';

// 注册所有工具（副作用导入）
import '../services/agentTools.js';

const router = Router();

const petRepository = new PetRepository();
const chatSessionRepository = new ChatSessionRepository();

/**
 * POST /api/agent/chat
 * Agent 对话接口，使用 SSE（Server-Sent Events）流式返回
 *
 * 事件类型：
 * - thinking: Agent 正在思考
 * - tool_call: Agent 调用工具
 * - tool_result: 工具执行结果
 * - token: 逐字流式输出
 * - done: 对话完成
 * - error: 错误
 */
// 限流：chatLimiter 30次/分钟（2026-09 审查修复：Agent 对话为多轮工具链 LLM 调用，成本高于单轮对话）
router.post('/chat', authMiddleware, chatLimiter, validate({ body: agentChatSchema }), async (req: Request, res: Response) => {
  const { message, history, petId, sessionId } = req.body;

  // 安全守卫（2026-09 成本优化）：命中规则预筛才调付费 LLM 守卫；良性消息直接放行省成本
  const needsGuard = preScreenRisk(message);
  const guardResult = needsGuard ? await guardCheckInput(message, { failClosed: true }) : { blocked: false };
  if (guardResult.blocked) {
    res.json({
      success: true,
      data: {
        reply: guardResult.reason || '抱歉，我无法处理这条消息。',
        blocked: true,
      },
    });
    return;
  }

  // 边界守卫（2026-09 越界收敛）：宠物管家只聊养宠相关。命中「人类恋爱/婚恋」等越界话题时
  // 确定性拒绝并拉回宠物主题——不调 LLM（省成本 + 硬保证），复用危机守卫的 blocked JSON 契约，
  // 前端 agentService 会把该 blocked JSON 转成 done 事件上屏（reply 为礼貌引导文案）。
  if (detectOffTopic(message)) {
    res.json({
      success: true,
      data: { reply: OFFTOPIC_REPLY, blocked: true },
    });
    return;
  }

  const userId = req.userId as string;

  // 如果指定了 petId，校验归属
  let validPetId: string | undefined;
  if (petId && typeof petId === 'string') {
    try {
      const isOwner = await petRepository.canAccess(petId, userId);
      if (isOwner) {
        validPetId = petId;
      }
    } catch {
      // 校验失败，不阻塞
    }
  }

  // 如果没有指定 petId，自动获取用户的第一只宠物
  if (!validPetId) {
    try {
      const firstPet = await petRepository.findFirstByUser(userId);
      if (firstPet) {
        validPetId = firstPet.id;
      }
    } catch {
      // 无宠物也可对话
    }
  }

  // 会话归属（多会话改造 2026-09-10）：校验传入 sessionId；未传/无效则惰性取该宠物最近活跃会话（兼容旧调用）
  let validSessionId: string | undefined;
  if (sessionId && typeof sessionId === 'string') {
    try {
      const session = await chatSessionRepository.findByIdAndUser(sessionId, userId);
      if (session) validSessionId = session.id;
    } catch {
      // 校验异常：fail-safe，消息不归会话（下次新建会话时归并存量 NULL）
    }
  }
  if (!validSessionId) {
    try {
      const recent = await chatSessionRepository.listByUser(userId, validPetId || null, 1);
      if (recent.length > 0) validSessionId = recent[0].id;
    } catch {
      // 忽略：无会话则消息归 NULL
    }
  }

  const context: AgentContext = { userId, petId: validPetId, sessionId: validSessionId };

  // 加载持久化对话历史
  let historyMessages: ChatMessage[] = [];
  try {
    const persistentHistory = await loadConversationHistory(userId, validPetId || null, 20, validSessionId);
    historyMessages = persistentHistory.map((h) => ({
      role: h.role,
      content: h.content.substring(0, 1000),
    }));
  } catch {
    // 加载失败不阻塞
  }

  // 合并前端提供的历史消息（追加在后，去重）
  if (Array.isArray(history)) {
    const frontendHistory: ChatMessage[] = [];
    for (const h of history.slice(-10)) {
      if (h.role && (h.role === 'user' || h.role === 'assistant') && typeof h.content === 'string') {
        frontendHistory.push({ role: h.role, content: h.content.substring(0, 1000) });
      }
    }
    for (const fh of frontendHistory) {
      const isDuplicate = historyMessages.some(
        (ph) => ph.role === fh.role && ph.content === fh.content,
      );
      if (!isDuplicate) {
        historyMessages.push(fh);
      }
    }
  }

  // 设置 SSE 响应头
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  let closed = false;

  // 客户端断开连接时清理
  req.on('close', () => {
    closed = true;
  });

  // 发送 SSE 事件的辅助函数
  const emit = (event: string, data: unknown) => {
    if (closed) return;
    try {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    } catch {
      closed = true;
    }
  };

  try {
    for await (const event of agentLoop(message, historyMessages, context)) {
      if (closed) break;
      emit(event.type, event.data);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Agent 异常';
    emit('error', { message: errorMessage });
  } finally {
    if (!closed) {
      try {
        res.end();
      } catch {
        // 连接已关闭
      }
    }
  }
});

/**
 * GET /api/agent/history
 * 加载持久化对话历史
 */
router.get('/history', authMiddleware, validate({ query: agentHistoryQuerySchema }), async (req: Request, res: Response) => {
  const userId = req.userId as string;
  const petId = (req.query.petId as string) || null;
  const sessionId = (req.query.sessionId as string) || null;
  const limit = req.query.limit as unknown as number;

  try {
    const history = await loadConversationHistory(userId, petId, limit, sessionId);
    res.json({ success: true, data: { history } });
  } catch (error) {
    const message = error instanceof Error ? error.message : '加载历史记录失败';
    res.status(500).json({ success: false, message });
  }
});

/**
 * GET /api/agent/sessions
 * 列出当前用户的聊天会话（可按 petId 过滤），按最近活跃倒序
 */
router.get('/sessions', authMiddleware, validate({ query: agentHistoryQuerySchema }), async (req: Request, res: Response) => {
  const userId = req.userId as string;
  const petId = (req.query.petId as string) || null;

  try {
    const rows = await chatSessionRepository.listByUser(userId, petId, 50);
    res.json({ success: true, data: { sessions: rows.map(toSessionSummary) } });
  } catch (error) {
    const message = error instanceof Error ? error.message : '加载会话列表失败';
    res.status(500).json({ success: false, message });
  }
});

/**
 * POST /api/agent/sessions
 * 新建会话：创建后把该宠物下 session_id IS NULL 的存量消息归并进来（存量兼容，只生效一次）
 */
router.post('/sessions', authMiddleware, validate({ body: createChatSessionSchema }), async (req: Request, res: Response) => {
  const userId = req.userId as string;
  const petId = (req.body.petId as string) || null;

  try {
    const session = await chatSessionRepository.createSession(userId, petId);
    // 归并存量消息（首次新建会话时把升级前无会话归属的历史消息收编）
    await chatSessionRepository.mergeLegacyMessages(userId, petId, session.id);
    res.json({ success: true, data: { session: toSessionSummary(session) } });
  } catch (error) {
    const message = error instanceof Error ? error.message : '新建会话失败';
    res.status(500).json({ success: false, message });
  }
});

/**
 * DELETE /api/agent/sessions/:id
 * 删除会话（含级联删除其消息；归属校验防横向越权）
 */
router.delete('/sessions/:id', authMiddleware, validate({ params: sessionIdParamsSchema }), async (req: Request, res: Response) => {
  const userId = req.userId as string;
  const id = req.params.id as string;

  try {
    const deleted = await chatSessionRepository.deleteSession(id, userId);
    if (!deleted) {
      res.status(404).json({ success: false, message: '会话不存在或无权操作' });
      return;
    }
    res.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : '删除会话失败';
    res.status(500).json({ success: false, message });
  }
});

/**
 * GET /api/agent/tools
 * 返回可用工具列表（供调试和前端展示）
 */
router.get('/tools', authMiddleware, (_req: Request, res: Response) => {
  const { TOOL_DEFINITIONS } = require('../services/toolRegistry.js');
  res.json({
    success: true,
    data: {
      tools: TOOL_DEFINITIONS.map((t: { name: string; description: string }) => ({
        name: t.name,
        description: t.description,
      })),
      count: TOOL_DEFINITIONS.length,
    },
  });
});

export default router;