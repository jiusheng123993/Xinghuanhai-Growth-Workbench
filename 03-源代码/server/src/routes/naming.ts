/**
 * 取名参考照片上传路由
 * 为 AI 取名流程提供照片上传功能
 *
 * 2026-09-10 新增 /photo/appearance：上传后的照片真正"给 AI 看"——
 * 此前取名流程只把照片 URL 当文本写进提示词，而取名走的是纯文本模型，
 * AI 根本看不到图，只会编造外貌（流程文案却承诺"让我看看它的样子"）。
 * 现由视觉模型提取外貌描述，前端把**描述**拼进提示词。
 */
import { Router, type Request, type Response } from 'express';
import multer from 'multer';
import rateLimit from 'express-rate-limit';
import { authMiddleware } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { aiRecognizeLimiter } from '../middleware/rateLimit.js';
import { uploadPetPhoto } from '../services/photoUploadService.js';
import { extractPetAppearance } from '../services/avatarService.js';
import { namingAppearanceSchema } from '../schemas/index.js';
import { config } from '../config.js';
import { PetRepository } from '../repositories/petRepository.js';

const router = Router();

const petRepository = new PetRepository();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  // MIME 白名单（2026-09-10 补齐）：与 ai.ts 的上传配置同口径——此前任意类型负载
  // 都会先整份进内存（10MB）再到 uploadPetPhoto 里被拒，白名单可以更早拦掉。
  // cb(err) 必须带上 statusCode=400：否则走全局 errorHandler 会变成 500「服务器内部错误」，
  // 而改动前这一步是 400 + 友好文案（语义回退 + 生产 500 日志噪声，2026-09-10 审查 P2）
  fileFilter: (_req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/heic'];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      const err = new Error('不支持的图片格式，请上传 JPG/PNG/WebP 格式') as Error & { statusCode?: number };
      err.statusCode = 400;
      cb(err);
    }
  },
});

const photoUploadLimiter = rateLimit({
  windowMs: 60000,
  max: 10,
  message: { success: false, message: '上传请求过于频繁，请稍后再试' },
});

// 上传取名参考照片
router.post('/photo/upload', authMiddleware, photoUploadLimiter, upload.single('photo'), async (req: Request, res: Response) => {
  try {
    const userId = req.userId!;
    const { petId } = req.body;

    if (!req.file) {
      res.status(400).json({ success: false, message: '请上传照片' });
      return;
    }

    if (!petId || typeof petId !== 'string') {
      res.status(400).json({ success: false, message: 'petId 参数不能为空' });
      return;
    }

    // 归属校验（2026-09 审查 P0 修复：此前仅校验 string 非空，与 avatar.ts 同接口口径不一致；
    // petId 直拼磁盘路径 + 无归属校验 = 路径穿越 + 越权写双重风险）
    const owns = await petRepository.canAccess(petId, userId);
    if (!owns) {
      res.status(404).json({ success: false, message: '宠物不存在或无权操作' });
      return;
    }

    const result = await uploadPetPhoto({
      userId,
      petId,
      fileBuffer: req.file.buffer,
      fileName: req.file.originalname,
      mimeType: req.file.mimetype,
    });

    if (!result.success) {
      res.status(400).json({ success: false, message: result.error });
      return;
    }

    res.json({ success: true, data: { url: result.url } });
  } catch (error) {
    console.error('[Naming photo/upload] Error:', error);
    res.status(500).json({ success: false, message: '照片上传失败，请稍后重试' });
  }
});

/**
 * 取名参考照片外貌提取
 *
 * 视觉模型有成本 → 复用 aiRecognizeLimiter（5 次/分）；photoUrl 经 SSRF 白名单校验
 * （namingAppearanceSchema → memoirPhotoUrlSchema）。
 *
 * 归属校验（2026-09-10 审查 P1 补）：本接口是付费视觉调用，除"是本站图片"外还必须
 * 满足 ①petId 属于调用者 ②photoUrl 落在调用者自己的上传目录
 * （`/uploads/pet-photos/<userId>/...`，见 photoUploadService.ts:78 的路径规则）。
 * 否则任何登录用户都能拿已知站内图片路径循环刷模型（单账号 7200 次/天）。
 */
router.post('/photo/appearance', authMiddleware, aiRecognizeLimiter, validate({ body: namingAppearanceSchema }), async (req: Request, res: Response) => {
  try {
    const userId = req.userId!;
    const { photoUrl, petId } = req.body as { photoUrl: string; petId: string };

    const owns = await petRepository.canAccess(petId, userId);
    if (!owns) {
      res.status(404).json({ success: false, message: '宠物不存在或无权操作' });
      return;
    }

    // 取 path 部分（支持相对路径与本站绝对地址两种入参），只放行调用者自己的上传目录
    let pathOnly = photoUrl;
    if (!photoUrl.startsWith('/')) {
      try {
        pathOnly = new URL(photoUrl).pathname;
      } catch {
        res.status(400).json({ success: false, message: '照片地址格式无效' });
        return;
      }
    }
    if (pathOnly.startsWith('/uploads/') && !pathOnly.startsWith(`/uploads/pet-photos/${userId}/`)) {
      res.status(403).json({ success: false, message: '只能分析自己上传的照片' });
      return;
    }

    // 本站相对路径 → 拼公网地址（视觉模型需要可访问的 URL）；已是绝对地址则原样使用。
    // 去掉 baseUrl 尾斜杠，避免拼出 `//uploads/...`（2026-09-10 审查 P3）
    const base = (config.publicBaseUrl || '').replace(/\/$/, '');
    const absoluteUrl = photoUrl.startsWith('/uploads/') ? `${base}${photoUrl}` : photoUrl;

    if (!/^https?:\/\//.test(absoluteUrl)) {
      // publicBaseUrl 未配置时为站内相对路径，视觉模型无法访问 → 明确失败，让前端降级
      res.status(502).json({ success: false, message: '照片识别暂不可用，请稍后再试' });
      return;
    }

    const appearance = await extractPetAppearance(absoluteUrl);
    if (!appearance) {
      // 识别失败（无密钥/模型异常）：返回 502 让前端按"未识别"降级，不阻塞取名流程
      res.status(502).json({ success: false, message: '照片识别失败，请稍后再试' });
      return;
    }

    res.json({ success: true, data: { appearance } });
  } catch (error) {
    console.error('[Naming photo/appearance] Error:', error instanceof Error ? error.message.split('\n')[0]?.slice(0, 200) : String(error));
    res.status(500).json({ success: false, message: '照片识别异常，请稍后再试' });
  }
});

export default router;