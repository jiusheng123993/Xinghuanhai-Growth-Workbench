/**
 * API 限流中间件配置
 * 按 TECH_DESIGN 6.0 节定义的 10 类接口限流规则
 * 使用 express-rate-limit，按 IP + 用户ID 维度限流
 */
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import type { Request } from 'express';

/** 限流 key 生成器：IP + 用户ID（已登录时），使用 ipKeyGenerator 确保 IPv6 兼容 */
function keyGenerator(req: Request): string {
  const userId = req.userId || 'anonymous';
  return `${ipKeyGenerator(req.ip || '')}:${userId}`;
}

/**
 * 测试环境跳过限流（2026-09 全项目审查修复引入）
 * 背景：为修复「限流器定义后从未挂载」（审查 P0/P1），本文件多个限流器新挂到业务端点；
 * 但既有单测会对同一端点高频调用（如 memoir.test.ts 创建回忆录 16 次 > 3次/分钟），
 * 挂载后必然误伤测试。故测试环境（vitest NODE_ENV=test）跳过，开发/生产照常生效。
 * 注意：globalLimiter 有独立测试断言 429 行为，绝不能加此豁免。
 */
function skipInTest(): boolean {
  return process.env.NODE_ENV === 'test';
}

/** 通用限流：120次/分钟（兜底防刷） */
export const globalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  keyGenerator,
  // 豁免埋点上报：analytics 路由自带 120 次/分钟专用防刷限流，
  // 全局限流会先拦截导致埋点 429（点换头像连续上报即触发），
  // 且埋点失败不应影响用户正常操作（如头像切换）
  // 注意：限流器挂在 /api/ 子路径下，req.path 不含 /api 前缀（是 /analytics/events），
  //       必须用 req.originalUrl（含完整路径）判断，否则豁免不生效
  skip: (req) => req.originalUrl.startsWith('/api/analytics/'),
  message: {
    success: false,
    code: '100003',
    message: '请求过于频繁，请稍后再试',
  },
  standardHeaders: true,
  legacyHeaders: false,
});

/** 照片上传：10次/分钟 */
export const uploadLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  keyGenerator,
  skip: skipInTest,
  message: {
    success: false,
    code: '100003',
    message: '上传过于频繁，请稍后再试',
  },
});

/** 拍照识别品种：5次/分钟（每次=1 次付费视觉 LLM 调用，且本功能已铺到添加宠物流程，必须有独立限流防滥用）
 *  skip: skipInTest（2026-09-10 审查 P2 补齐）：与其余限流器口径一致，
 *  否则补该接口的集成测试时会因连发请求必然 429 flake（现有视觉接口测试靠 vi.mock 整个模块绕过）。 */
export const aiRecognizeLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  keyGenerator,
  skip: skipInTest,
  message: {
    success: false,
    code: '100003',
    message: '识别请求过于频繁，请稍后再试',
  },
});

/** AI 算力类：5次/分钟（2D/3D形象生成/全家福） */
export const aiGenerateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  keyGenerator,
  skip: skipInTest, // vitest 全量回归会连发多个生成请求，测试环境豁免（同其他新挂载限流口径）
  message: {
    success: false,
    code: '100003',
    message: '生成请求过于频繁，请稍后再试',
  },
});

/** AI 对话：30次/分钟（2026-09 审查修复：此前定义后从未挂载，AI 烧钱口仅剩全局兜底） */
export const chatLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  keyGenerator,
  skip: skipInTest,
  message: {
    success: false,
    code: '100003',
    message: '对话请求过于频繁，请稍后再试',
  },
});

/** 回忆录生成：3次/分钟（2026-09 审查修复：最高成本接口，此前定义后从未挂载） */
export const memoirLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 3,
  keyGenerator,
  skip: skipInTest,
  message: {
    success: false,
    code: '100003',
    message: '视频生成请求过于频繁，请稍后再试',
  },
});

/** 提示词预览/改写限流：触发视觉描述 + DeepSeek 有成本，放宽到 5 次/分（2026-09-09 人机协同） */
export const promptLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  keyGenerator,
  skip: skipInTest,
  message: {
    success: false,
    code: '100013',
    message: '提示词预览过于频繁，请稍后再试',
  },
});

/** 取名引擎：10次/分钟（2026-09 审查修复：此前定义后从未挂载） */
export const namingLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  keyGenerator,
  skip: skipInTest,
  message: {
    success: false,
    code: '100003',
    message: '请求过于频繁，请稍后再试',
  },
});

/** 症状初筛：10次/分钟 */
export const symptomLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  keyGenerator,
  message: {
    success: false,
    code: '100003',
    message: '请求过于频繁，请稍后再试',
  },
});

/** 数据同步：10次/分钟 */
export const syncLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  keyGenerator,
  message: {
    success: false,
    code: '100003',
    message: '同步请求过于频繁，请稍后再试',
  },
});
