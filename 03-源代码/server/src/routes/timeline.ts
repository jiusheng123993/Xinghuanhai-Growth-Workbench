/**
 * 回忆时间线路由 - 宠物回忆/日记的管理
 * 创建和查询回忆记录（按宠物/家庭/用户），上传回忆照片
 * 补充：回忆补记（happenedAt）、AI 生成/润色回忆文案、删除回忆
 */
import { Router, type Request, type Response } from 'express';
import crypto from 'crypto';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { authMiddleware } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { chatLimiter, uploadLimiter } from '../middleware/rateLimit.js';
import {
  createTimelineEventSchema,
  timelineMomentsQuerySchema,
  timelineAiPolishSchema,
} from '../schemas/index.js';
import { config } from '../config.js';
import { PetRepository } from '../repositories/petRepository.js';
import { FamilyRepository, FamilyMemberRepository } from '../repositories/familyRepository.js';
import { TimelineRepository } from '../repositories/timelineRepository.js';
import { analyzeImage } from '../services/visionService.js';
import { chat } from '../services/aiService.js';

const router = Router();

const petRepository = new PetRepository();
const familyRepository = new FamilyRepository();
const familyMemberRepository = new FamilyMemberRepository();
const timelineRepository = new TimelineRepository();

// 照片上传配置
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (_req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/heic'];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('仅支持 JPG/PNG/WebP/HEIC 格式'));
    }
  },
});

// 创建回忆
router.post('/moments', authMiddleware, validate({ body: createTimelineEventSchema }), async (req: Request, res: Response) => {
  try {
    const userId = req.userId!;
    const { petId, petIds, type, content, photos, happenedAt } = req.body;

    // 校验宠物归属
    const isOwner = await petRepository.canAccess(petId, userId);
    if (!isOwner) {
      res.status(403).json({ success: false, message: '无权操作此宠物' });
      return;
    }

    const momentId = crypto.randomUUID();
    const momentType = type || 'memory';
    const momentContent: Record<string, unknown> = { ...(content || {}) };
    /**
     * `content.pets` 是**服务端专属字段**（客户端伪造多宠标签没用，一律丢弃后由服务端重写）。
     * 注意：`petName/petEmoji` 保留客户端传值以兼容旧版本小程序（它们只影响自己看到的显示，
     * 且下面在能查到权威值时会被覆盖）。
     */
    delete momentContent.pets;
    const momentPhotos = Array.isArray(photos) ? photos : [];

    /**
     * 多宠共同回忆（2026-09-11 新增）
     *
     * 归属写成 content.pets = [{id,name,emoji}]，**不改表结构**（pet_id 仍是主宠物，兼容所有旧路径）。
     * 两道安全处理：
     *   ① 逐个宠物校验归属 —— 不允许客户端把别人的宠物 id 贴到自己的回忆上；
     *   ② 名字/物种从数据库取 —— 不信任客户端传来的名字（防伪造标签）。
     * 任何一只无权限就整体 403（不静默丢弃，避免"一半标签生效"的歧义数据）。
     */
    if (Array.isArray(petIds) && petIds.length) {
      /**
       * 去重，并**把主宠物放在第一位**：
       * petId 是本次请求的"主宠物"（落库到 pet_moments.pet_id，所有旧读取路径都认它），
       * 若客户端传的 petIds 里恰好没有它，就会出现"卡片标签里没有主宠物"的不一致 ——
       * 所以这里强制 `pets[0].id === petId`，保证 content.pets 与 pet_id 永远自洽。
       */
      const uniquePetIds = Array.from(new Set([petId, ...(petIds as string[]).filter(Boolean)])) as string[]
      // 一次查回"可访问的宠物"（含服务端权威的 name/species），少了的即无权限
      const accessible = await petRepository.findAccessibleByIds(uniquePetIds, userId)
      const ownedMap = new Map(accessible.map((r) => [r.id, r]))
      const notOwned = uniquePetIds.filter((id) => !ownedMap.has(id))
      if (notOwned.length > 0) {
        res.status(403).json({ success: false, message: '无权操作此宠物' })
        return
      }
      const emojiOf = (species: string | null) => (species === 'cat' ? '🐱' : species === 'dog' ? '🐕' : '🐾');
      momentContent.pets = uniquePetIds.map((id) => {
        const pet = ownedMap.get(id)!;
        return { id: pet.id, name: pet.name, emoji: emojiOf(pet.species) };
      });
      // 主宠物的名字/emoji 同步成服务端权威值（老读取路径只认这两个字段）
      const primary = ownedMap.get(petId);
      if (primary) {
        momentContent.petName = primary.name;
        momentContent.petEmoji = emojiOf(primary.species);
      }
    }

    const row = await timelineRepository.createMoment(
      momentId,
      userId,
      petId,
      momentType,
      JSON.stringify(momentContent),
      momentPhotos,
      // 补记：happenedAt 是合法日期字符串时透传，否则交给数据库默认 now()
      typeof happenedAt === 'string' && happenedAt ? happenedAt : undefined,
    );

    res.json({ success: true, data: row });
  } catch (err) {
    console.error('[Timeline CreateMoment Error]', err);
    res.status(500).json({ success: false, message: '保存回忆失败' });
  }
});

/**
 * AI 生成回忆描述：上传 1 张照片 → 视觉模型生成温暖的中文回忆文案
 * 安全：uploadLimiter 限流（视觉调用成本高），不落库，前端确认后再保存
 */
router.post('/ai-describe', authMiddleware, uploadLimiter, upload.single('photo'), async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      res.status(400).json({ success: false, message: '请上传照片' });
      return;
    }

    const mimeType = req.file.mimetype || 'image/jpeg';
    const imageDataUrl = `data:${mimeType};base64,${req.file.buffer.toString('base64')}`;

    const systemPrompt = `你是"星河宠记"的回忆文案助手。用户上传了一张宠物照片，请用温暖、有画面感的语言写一段 50~120 字的回忆描述。
要求：
1. 以"今天"或"这一天"开头，第一人称"我"，仿佛主人亲笔记录
2. 描述照片中能看到的宠物状态、动作、环境细节
3. 只描述照片可见内容，不要编造照片里没有的信息（如疾病、经历）
4. 语气温柔自然，像朋友圈日记，不要用"AI""生成"等字眼，不要用 emoji
5. 直接输出描述文字，不要加引号、标题或任何其他内容`;

    const result = await analyzeImage({
      imageUrl: imageDataUrl,
      prompt: systemPrompt,
      maxTokens: 400,
    });

    // 视觉 key 未配置时降级：返回占位提示（前端可隐藏 AI 按钮）
    if (!result) {
      res.status(503).json({ success: false, message: 'AI 视觉能力未配置，无法生成描述' });
      return;
    }

    res.json({ success: true, data: { description: result.trim() } });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'AI 生成描述失败';
    console.error('[Timeline AiDescribe Error]', message);
    res.status(500).json({ success: false, message: 'AI 生成描述失败，请重试' });
  }
});

/**
 * AI 润色回忆文案：用户写的简短文字 → 扩写/润色成温暖的回忆文案
 * 安全：chatLimiter 限流（对话算力），不落库，前端确认后再保存
 */
router.post('/ai-polish', authMiddleware, chatLimiter, validate({ body: timelineAiPolishSchema }), async (req: Request, res: Response) => {
  try {
    const { text } = req.body;

    const systemPrompt = `你是"星河宠记"的回忆文案助手。用户写了一段关于宠物的回忆草稿，请润色成温暖、自然、有画面感的回忆文案。
要求：
1. 保留用户表达的核心事实，不编造新内容
2. 语气温柔自然，像主人亲笔记录的日记，不超过 150 字
3. 不要用"AI""生成"等字眼，不要加引号、标题、列表
4. 直接输出润色后的文字`;

    // 关闭思考模式（thinking disabled）：润色是简单改写任务，不需要推理；
    // deepseek-v4-flash 思考默认开启，曾出现思考吃光 max_tokens=400 预算导致
    // 正文为空串 → 路由 503「AI 润色失败」的生产事故（生产复现 finish=length，
    // reasoning 独占 400 tokens）。关闭后 max_tokens 全部给正文，并留足余量。
    const result = await chat(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: text },
      ],
      { temperature: 0.7, max_tokens: 800, thinking: 'disabled' },
    );

    // 拦截未配置降级：aiService 无 key 时 chat 返回非空占位串（非 null），
    // 必须显式识别，否则会以 200 把占位文案当润色结果返回给用户
    if (!result || !result.trim()) {
      res.status(503).json({ success: false, message: 'AI 润色失败，请重试' });
      return;
    }
    if (result.includes('AI 服务暂未配置')) {
      res.status(503).json({ success: false, message: 'AI 服务暂未配置，无法润色' });
      return;
    }

    res.json({ success: true, data: { text: result.trim() } });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'AI 润色失败';
    console.error('[Timeline AiPolish Error]', message);
    res.status(500).json({ success: false, message: 'AI 润色失败，请重试' });
  }
});

/**
 * 删除回忆：校验归属（只能删自己的回忆）
 */
router.delete('/moments/:id', authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = req.userId!;
    // Express 5 中 params 值类型为 string | string[]，路由参数实际恒为 string，这里显式转换
    const momentId = String(req.params.id);

    // 先查归属，防止越权删除他人回忆
    const moment = await timelineRepository.findById(momentId);
    if (!moment) {
      res.status(404).json({ success: false, message: '回忆不存在' });
      return;
    }
    if (moment.user_id !== userId) {
      res.status(403).json({ success: false, message: '无权删除此回忆' });
      return;
    }

    await timelineRepository.deleteById(momentId);
    res.json({ success: true, data: { id: momentId } });
  } catch (err) {
    console.error('[Timeline DeleteMoment Error]', err);
    res.status(500).json({ success: false, message: '删除回忆失败' });
  }
});

// 获取回忆列表
router.get('/moments', authMiddleware, validate({ query: timelineMomentsQuerySchema }), async (req: Request, res: Response) => {
  try {
    const userId = req.userId!;
    const petId = req.query.pet_id as string | undefined;
    const familyId = req.query.family_id as string | undefined;
    const limit = req.query.limit as unknown as number;

    let rows;

    if (familyId) {
      // 按家庭查询：先校验家庭归属（防 IDOR：知晓他人 family_id 即可读取其家庭回忆）
      const isFamilyOwner = await familyRepository.isOwner(familyId, userId);
      if (!isFamilyOwner) {
        res.status(403).json({ success: false, message: '无权查看此家庭的回忆' });
        return;
      }
      // 获取家庭成员宠物ID，再查回忆
      const petIds = await familyMemberRepository.findPetIdsByFamilyId(familyId);
      if (petIds.length === 0) {
        res.json({ success: true, data: [] });
        return;
      }
      rows = await timelineRepository.findByPetIds(petIds, limit);
    } else if (petId) {
      rows = await timelineRepository.findByPetAndUser(petId, userId, limit);
    } else {
      // 查询当前用户所有回忆
      rows = await timelineRepository.findByUser(userId, limit);
    }

    res.json({ success: true, data: rows });
  } catch (err) {
    console.error('[Timeline GetMoments Error]', err);
    res.status(500).json({ success: false, message: '获取回忆失败' });
  }
});

// 上传回忆照片
// 限流：uploadLimiter 10次/分钟（2026-09 审查 P1 修复：10MB memoryStorage 此前仅全局 120/分兜底，
// 单用户 1 分钟可打约 1.2GB 内存；扩展名同步改服务端白名单映射，不再信原始文件名）
router.post('/photo/upload', authMiddleware, uploadLimiter, upload.single('photo'), async (req: Request, res: Response) => {
  try {
    const userId = req.userId!;
    const file = req.file;

    if (!file) {
      res.status(400).json({ success: false, message: '请选择照片' });
      return;
    }

    // 扩展名由服务端按 mimeType 白名单映射（防 .html/.php 等任意后缀落盘）
    const EXT_BY_MIME: Record<string, string> = {
      'image/jpeg': 'jpg',
      'image/png': 'png',
      'image/webp': 'webp',
      'image/heic': 'heic',
    };
    const ext = EXT_BY_MIME[file.mimetype] || 'jpg';
    const filename = `${crypto.randomUUID()}.${ext}`;
    const dirPath = path.join(config.uploadDir, 'moment-photos', userId);
    const filePath = path.join(dirPath, filename);

    fs.mkdirSync(dirPath, { recursive: true });
    fs.writeFileSync(filePath, file.buffer);

    const publicUrl = `/uploads/moment-photos/${userId}/${filename}`;
    res.json({ success: true, data: { url: publicUrl } });
  } catch (err) {
    console.error('[Timeline UploadPhoto Error]', err);
    res.status(500).json({ success: false, message: '上传照片失败' });
  }
});

/**
 * 旧时光提醒（F5）：查询"去年今天"的回忆
 * 前端时光页展示 + 后续订阅消息推送
 */
router.get('/last-year', authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = req.userId as string;
    const now = new Date();
    // 去年今天（月日相同，年份-1）
    const lastYear = now.getFullYear() - 1;
    const moments = await timelineRepository.findLastYearMoments(
      userId,
      lastYear,
      now.getMonth() + 1,
      now.getDate(),
    );

    res.json({
      success: true,
      data: {
        lastYear: `${lastYear}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`,
        count: moments.length,
        moments: moments.map((m) => ({
          id: m.id,
          pet_id: m.pet_id,
          content: m.content,
          photos: m.photos,
          created_at: m.created_at,
        })),
      },
    });
  } catch (err) {
    console.error('[Timeline LastYear Error]', err);
    res.status(500).json({ success: false, message: '查询去年今天失败' });
  }
});

export default router;
