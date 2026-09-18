/**
 * 2D 形象包生成服务 - 调用 Seedream API 批量生成宠物多角度表情包
 * 包含表情、角度、动作三种维度，支持 429 重试和并发控制
 */
import { config } from '../config.js';
import { pool } from '../db.js';
import { updateTaskProgress, updateTaskStatus, updateTaskResult } from './taskQueue.js';
import { delay } from '../utils/delay.js';
// 宠物提示词公共模块：统一按提示词库 §0.6/§四 规范构造（角色锁定 + 主体锁定 + 品种兜底）
import { petSubjectText, PET_IDENTITY_KEEP, PET_ONLY_ONE } from './petPrompt.js';
// AI 生图转存（去 Seedream 平台水印后转存本站图床，见 imageBadge 模块注释）
import { hostAiImage } from './imageBadge.js';

const SEEDREAM_API = 'https://ark.cn-beijing.volces.com/api/v3/images/generations';

// [SYNC] 以下常量 key 必须与前端 constants/index.ts 中 AVATAR_EXPRESSIONS/AVATAR_ANGLES/AVATAR_ACTIONS 保持一致
// 修改时需同步更新前端，否则 2D 图片的 expression/angle 字段与前端选择器不匹配
const EXPRESSIONS = [
  { key: 'happy', label: '开心', emoji: '😊' },
  { key: 'sad', label: '难过', emoji: '😢' },
  { key: 'excited', label: '兴奋', emoji: '🤩' },
  { key: 'sleepy', label: '困倦', emoji: '😴' },
  { key: 'love', label: '爱心', emoji: '🥰' },
  { key: 'cool', label: '得意', emoji: '😎' },
  { key: 'angry', label: '生气', emoji: '😤' },
  { key: 'thinking', label: '思考', emoji: '🤔' },
  { key: 'surprised', label: '惊讶', emoji: '😱' },
  { key: 'crying', label: '哭泣', emoji: '😭' },
  { key: 'celebrate', label: '庆祝', emoji: '🥳' },
  { key: 'naughty', label: '调皮', emoji: '😜' },
];

const ANGLES = [
  { key: 'front', label: '正面' },
  { key: 'left', label: '左侧' },
  { key: 'right', label: '右侧' },
  { key: 'back', label: '背面' },
  { key: 'left45', label: '45°左' },
  { key: 'right45', label: '45°右' },
];

const ACTIONS = [
  { key: 'sit', label: '坐着', emoji: '🧘' },
  { key: 'stand', label: '站着', emoji: '🧍' },
  { key: 'lie', label: '趴着', emoji: '🛌' },
  { key: 'jump', label: '跳跃', emoji: '🦘' },
  { key: 'wave', label: '招手', emoji: '🐾' },
  { key: 'eat', label: '吃东西', emoji: '🍖' },
  { key: 'play', label: '玩球', emoji: '🎾' },
  { key: 'sleep', label: '睡觉', emoji: '💤' },
];

const ACTION_ANGLES = ANGLES.slice(0, 3);

interface Generate2DParams {
  taskId: string;
  species: string;
  breed: string;
  referencePhotoUrl: string;
  style: string;
}

export async function generate2DAvatarPack(params: Generate2DParams): Promise<void> {
  const { taskId, species, breed, referencePhotoUrl, style } = params;
  const apiKey = config.seedream.apiKey;

  if (!apiKey) {
    await updateTaskStatus(taskId, 'failed', 'AI 图像生成服务未配置');
    return;
  }

  await updateTaskStatus(taskId, 'processing');

  // 画风 key → 提示词风格短语：与前端 GEN_STYLES / 服务端 AVATAR_STYLE_OPTIONS 的 15 种画风对齐
  //（关键词取自提示词库《宠物回忆录-提示词库.md》§六，与 avatarService 各风格描述同一来源）；
  // legacy cartoon/realistic 及未知值兜底"可爱卡通风格"
  const STYLE_TEXT_2D: Record<string, string> = {
    cartoon: '可爱卡通风格',
    realistic: '写实风格，真实细腻',
    q: 'Q版萌系贴纸质感，柔和暖光，明亮干净背景',
    japanese: '日系治愈画风，奶油色柔和渐变，水彩晕染',
    american: '美式卡通，高饱和撞色，夸张生动',
    watercolor: '透明水彩手绘，纸张纹理，淡雅清新',
    clay: '黏土质感，软陶立体，柔和影棚光',
    ghibli: '吉卜力动画风，手绘水彩背景，温暖治愈光线',
    pixar: '皮克斯式 3D 渲染，大眼睛高光，次表面散射毛发',
    pixel: '16-bit 复古像素艺术，色彩分明',
    ink: '水墨国风，宣纸质感，留白意境',
    oil: '油画厚涂笔触，画布纹理，浓郁艺术感',
    cyberpunk: '赛博朋克，霓虹灯光，未来都市氛围',
    nordic: '极简北欧插画，低饱和莫兰迪色，宁静高级',
    lowpoly: '低多边形几何切面，扁平着色',
    lineart: '线稿素描，铅笔排线阴影',
    dark: '暗黑奇幻，哥特月光，戏剧性光影',
  };
  const styleText = STYLE_TEXT_2D[style] || '可爱卡通风格';

  try {
    // 第 1 批: 4 核心表情 × 6 角度 = 24 张
    const coreExpressions = EXPRESSIONS.slice(0, 4);
    await generateBatch(taskId, coreExpressions, ANGLES, species, breed, styleText, referencePhotoUrl, apiKey, 0, 25);

    // 第 2 批: 8 扩展表情 × 6 角度 = 48 张
    const extExpressions = EXPRESSIONS.slice(4);
    await generateBatch(taskId, extExpressions, ANGLES, species, breed, styleText, referencePhotoUrl, apiKey, 25, 75);

    // 第 3 批: 8 动作 × 3 角度 = 24 张
    await generateBatch(taskId, ACTIONS, ACTION_ANGLES, species, breed, styleText, referencePhotoUrl, apiKey, 75, 100, true);

    await updateTaskResult(taskId, {
      expressions: EXPRESSIONS,
      angles: ANGLES,
      actions: ACTIONS,
      totalCount: (EXPRESSIONS.length * ANGLES.length) + (ACTIONS.length * ACTION_ANGLES.length),
    });
    await updateTaskStatus(taskId, 'completed');
  } catch (error) {
    const message = error instanceof Error ? error.message : '2D 形象生成失败';
    await updateTaskStatus(taskId, 'failed', message);
  }
}

/** 并发批次大小（控制 API 并发数，避免触发限流） */
const CONCURRENCY = 5;

async function generateBatch(
  taskId: string,
  items: Array<{ key: string; label: string; emoji?: string }>,
  angleList: Array<{ key: string; label: string }>,
  species: string,
  breed: string,
  styleText: string,
  referencePhotoUrl: string,
  apiKey: string,
  progressStart: number,
  progressEnd: number,
  isAction: boolean = false,
): Promise<void> {
  const total = items.length * angleList.length;
  let completed = 0;
  let failed = 0;

  /** 构建所有生成任务 */
  const tasks: Array<{ itemKey: string; itemLabel: string; angleKey: string; angleLabel: string; sortOrder: number }> = [];
  let sortOrder = 0;
  for (const item of items) {
    for (const angle of angleList) {
      tasks.push({ itemKey: item.key, itemLabel: item.label, angleKey: angle.key, angleLabel: angle.label, sortOrder });
      sortOrder++;
    }
  }

  /** 分批并发执行 */
  for (let batchStart = 0; batchStart < tasks.length; batchStart += CONCURRENCY) {
    const batch = tasks.slice(batchStart, batchStart + CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map(task => {
        // 提示词规范：主体用公共模块（品种兜底 + 绝不写名字）+ 角色锁定 + 主体锁定
        // 对应提示词库 §0.6 数量敏感角色声明 与 §四 角色一致性模板
        const subject = petSubjectText(breed, species);
        const prompt = isAction
          ? `${subject}，正在${task.itemLabel}，${task.angleLabel}视角，${styleText}，高质量，干净背景，${PET_IDENTITY_KEEP}，${PET_ONLY_ONE}`
          : `${subject}，${task.itemLabel}的表情，${task.angleLabel}视角，${styleText}，高质量，干净背景，${PET_IDENTITY_KEEP}，${PET_ONLY_ONE}`;

        return callSeedream(prompt, referencePhotoUrl, apiKey).then(imageUrl => {
          if (imageUrl) {
            return pool.query(
              `INSERT INTO avatar_2d_images (task_id, angle, expression, image_url, sort_order)
               VALUES ($1, $2, $3, $4, $5)`,
              [taskId, task.angleKey, task.itemKey, imageUrl, task.sortOrder],
            ).then(() => true);
          }
          return false;
        }).catch(() => {
          console.warn(`[Image2D] Failed to generate: ${task.itemKey} ${task.angleKey}`);
          return false;
        });
      }),
    );

    for (const result of results) {
      if (result.status === 'fulfilled' && !result.value) {
        failed++;
      } else if (result.status === 'rejected') {
        failed++;
      }
      completed++;
      const progress = progressStart + Math.floor((completed / total) * (progressEnd - progressStart));
      await updateTaskProgress(taskId, progress);
    }

    // 批次间延迟，避免 API 限流
    await delay(isAction ? 300 : 200);
  }

  if (failed > 0) {
    console.warn(`[Image2D] Batch completed: ${total} total, ${failed} failed, ${total - failed} success`);
  }
}

const MAX_429_RETRIES = 2;

/**
 * 调用 Seedream 文生图/图生图接口（带 429 重试）
 * 供 2D 形象包、多风格候选头像等模块复用
 * @param prompt - 生成提示词
 * @param referenceImageUrl - 参考照片 URL（可空，空则走文生图）
 * @param apiKey - Seedream API Key
 * @param retryCount - 当前重试次数（内部递归使用）
 * @returns 生成图片 URL，失败返回 null
 */
export async function callSeedream(prompt: string, referenceImageUrl: string, apiKey: string, retryCount = 0): Promise<string | null> {
  const response = await fetch(SEEDREAM_API, {
    method: 'POST',
    signal: AbortSignal.timeout(60_000), // 2026-09 审查 P1：补超时防上游挂起拖死同步请求（生图较慢取 60s）
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'doubao-seedream-4-0-250828',
      prompt,
      size: '1024x1024',
      n: 1,
      // 仅当传了参考照片时带 image 字段，走图生图；否则为纯文生图
      ...(referenceImageUrl ? { image: referenceImageUrl } : {}),
      // 去掉 Seedream 平台水印（样式不可控），生成图随后由 hostAiImage 转存本站
      watermark: false,
    }),
  });

  if (!response.ok) {
    if (response.status === 429 && retryCount < MAX_429_RETRIES) {
      const backoff = 5000 * (retryCount + 1);
      await delay(backoff);
      return callSeedream(prompt, referenceImageUrl, apiKey, retryCount + 1);
    }
    return null;
  }

  const data = (await response.json()) as { data: Array<{ url: string }> };
  const url = data.data?.[0]?.url || null;
  if (!url) return null;
  // 转存本站 uploads（失败降级返回原图 URL，见 imageBadge 模块注释）
  return hostAiImage(url);
}

export { EXPRESSIONS, ANGLES, ACTIONS, ACTION_ANGLES };
