/**
 * AI 生图统一角标服务（水印合规 B 方案）
 *
 * 背景：依据《人工智能生成合成内容标识办法》（2025-09-01 施行），AI 生成的图片需要携带显式标识。
 * 此前 Seedream 默认在右下角加「AI生成」平台水印（样式不可控且带平台色彩）。
 * 本方案 = 调用方在 Seedream 请求体传 watermark:false 去掉平台水印，
 * 由本模块统一在生成图右下角合成自有品牌角标（server/assets/ai-badge.png，
 * 半透明胶囊「AI 绘制 · 星河宠记」），成果落盘到本站 uploads 目录再入库。
 *
 * 全家福（familyPhotoService）/ 表情包（image2DService）/ 形象（avatarService）
 * 三个生图服务共用本模块；任何环节失败都降级返回原图 URL（只记日志，不阻断生成主流程）。
 *
 * 中间产物例外（2026-09-19 新增）：回忆录**关键帧**是本模块第 4 个调用方，但它是"只作视频首帧、
 * 不直接给用户看"的中间产物，故传 `{ visible: false }` 只跳过**可见角标合成**，
 * 隐式 AIGC 元数据（PNG tEXt 块）照旧写入 —— 见 `addAiBadge` 的 options 注释。
 */
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Jimp from 'jimp';
import { config } from '../config.js';
import { appendAigcPngMetadata } from './aigcMetadata.js';

// ⚠️ 生产以 ESM 运行，不存在 __dirname（本地 vitest 走 CJS 转换测不出来，
// 上线曾因此崩溃循环）——统一用 import.meta.url 推导，与 breedRepository 同模式
const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** 角标素材路径：server/assets/ai-badge.png（451x93 透明胶囊，2x 分辨率设计） */
const BADGE_ASSET_PATH = path.resolve(__dirname, '../../assets/ai-badge.png');

/** 角标图落盘子目录（index.ts 已把 /uploads 映射到 uploadDir 静态托管） */
const SUB_DIR = 'ai-generated';

/** 角标宽度占原图宽度比例：1024 宽图上约 307px，与预览效果稿一致 */
const BADGE_WIDTH_RATIO = 0.3;

/** 角标距图片右下角的留白占原图宽度比例 */
const MARGIN_RATIO = 0.03;

/** 角标素材缓存（模块级懒加载：解码一次反复使用，clone 出缩放副本避免污染原件） */
let badgeCache: Jimp | null = null;

/**
 * CDN 下载超时（毫秒）：Seedream 返回的是临时链接，挂起会拖住整个生成请求，
 * 用 AbortSignal 硬性限时，超时走降级路径返回原图
 */
const DOWNLOAD_TIMEOUT_MS = 15_000;

// 启动期软守卫：publicBaseUrl 未配置时 addAiBadge 只能返回 /uploads 相对路径，
// 该 URL 一旦被存入形象库（routes/avatar.ts 校验必须 http(s) 绝对地址）会静默 400。
// 本地/生产 .env 均已配置 PUBLIC_BASE_URL，这里只告警不抛错，避免测试环境启动失败。
if (!config.publicBaseUrl) {
  console.warn('[ImageBadge] 未配置 PUBLIC_BASE_URL：角标图将返回相对路径，存入形象库会被 http(s) 校验拒绝');
}

/**
 * 给 AI 生成图合成品牌角标并落盘
 * @param imageUrl - Seedream 返回的 CDN 图片 URL（有时效，须立刻取回内容）
 * @param options.visible - 是否合成**可见**角标，默认 `true`。
 *   - `true`（默认）：既有 4 处调用点（全家福 / 表情包 / 形象 / 头像候选）都是**直接给用户看的成品图**，
 *     保持原行为不变。
 *   - `false`：用于**中间产物**（回忆录关键帧）。它只作为视频首帧、不直接给用户看，理由有二：
 *     ① 可见角标会被 Seedance **动起来**，可能扭曲成渲染缺陷；
 *     ② 烙进去等于给成片**凭空增加一个用户可见元素**，属未经确认的可见变化。
 *     ⚠️ 传 `false` **不等于放弃合规**：隐式标识（PNG AIGC tEXt 块）照旧写入（《标识办法》第十条），
 *     成片自身的标识口径与改造前完全一致。
 * @returns 加角标后的本站图片 URL（{publicBaseUrl}/uploads/ai-generated/{uuid}.png，
 *          与回忆录视频 share-cards 的 publicBaseUrl 口径一致）；
 *          任一环节失败降级返回原始 URL，保证"能出图"优先于"有角标"
 */
export async function addAiBadge(
  imageUrl: string,
  options: { visible?: boolean } = {},
): Promise<string> {
  try {
    // 1. 下载生成图内容（CDN 临时链接过期即失效，不能只存 URL；限时 15s 防挂起）
    const resp = await fetch(imageUrl, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
    if (!resp.ok) throw new Error(`下载生成图失败 HTTP ${resp.status}`);
    const base = await Jimp.read(Buffer.from(await resp.arrayBuffer()));

    // 2. 角标按原图宽度等比缩放后贴到右下角（小图自动缩小、大图自动放大）
    //    ⚠️ 只有 visible !== false 时才合成；中间产物（关键帧）跳过这一步，但下面的隐式标识照写
    if (options.visible !== false) {
      if (!badgeCache) badgeCache = await Jimp.read(BADGE_ASSET_PATH);
      const badge = badgeCache.clone();
      badge.resize(Math.round(base.getWidth() * BADGE_WIDTH_RATIO), Jimp.AUTO);
      const margin = Math.round(base.getWidth() * MARGIN_RATIO);
      const x = base.getWidth() - badge.getWidth() - margin;
      const y = base.getHeight() - badge.getHeight() - margin;
      base.composite(badge, x, y);
    }

    // 3. 落盘 uploads/ai-generated/{uuid}.png
    //    立项 v0.2 P0-3：《标识办法》第十条隐式标识——落盘前在 PNG 元数据写入 AIGC tEXt 块
    //    （与右下角显式角标双保险：显式标识可被裁剪，隐式标识随文件元数据保留）
    const dir = path.join(config.uploadDir, SUB_DIR);
    await fs.mkdir(dir, { recursive: true });
    const filename = `${crypto.randomUUID()}.png`;
    const stamped = appendAigcPngMetadata(await base.getBufferAsync(Jimp.MIME_PNG));
    await fs.writeFile(path.join(dir, filename), stamped);

    // 4. 返回公网 URL（publicBaseUrl 未配置时为相对路径，与站内其他上传口径一致）
    return `${config.publicBaseUrl || ''}/uploads/${SUB_DIR}/${filename}`;
  } catch (err) {
    console.error('[ImageBadge] 角标合成失败，降级使用原图:', err instanceof Error ? err.message : err);
    return imageUrl;
  }
}
