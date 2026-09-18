/**
 * AI 生图转存服务（Seedream 临时图 → 本站图床）
 *
 * 职责：把 Seedream 返回的**有时效的临时 CDN 图**取回内容、可选合成品牌角标，
 * 落盘到本站 uploads/ai-generated/{uuid}.png，返回可长期访问的 {publicBaseUrl}/uploads/... URL。
 * 这个「取回 + 落盘」是本函数的主要职责：只存 URL 的话，CDN 链接一过期图片就失效。
 *
 * ⚠️ 函数原名 `addAiBadge`，默认在右下角合成品牌角标（server/assets/ai-badge.png，
 * 半透明胶囊「AI 绘制 · 星河宠记」）。该可见角标已按 2026-09-19 产品决策**关闭**，函数因此改名：
 * 一个叫 addAiBadge 却在大多数情况下不加角标的函数名不副实、会误导后来人；
 * `hostAiImage` 如实描述它真正做的事 —— 转存。
 * 可见角标通道**保留但默认关闭**（传 `{ withBadge: true }` 仍能合成），
 * 作为日后可能需要时的一行开关；**当前无任何调用点开它**。
 *
 * ⭐ 隐式 AIGC 元数据（PNG tEXt 块，appendAigcPngMetadata）**照旧写入，本轮未做任何削弱**：
 * 用户看不见它，它不是水印，是标识底线。
 *
 * 调用方：全家福（familyPhotoService）/ 表情包（image2DService）/ 形象（avatarService）/
 * 回忆录关键帧（memoirKeyframeService）四个生图服务共用本模块；
 * 任何环节失败都降级返回原图 URL（只记日志，不阻断生成主流程）。
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

/** 角标素材路径（仅 withBadge=true 时使用）：server/assets/ai-badge.png（451x93 透明胶囊，2x 分辨率设计） */
const BADGE_ASSET_PATH = path.resolve(__dirname, '../../assets/ai-badge.png');

/** 转存图落盘子目录（index.ts 已把 /uploads 映射到 uploadDir 静态托管） */
const SUB_DIR = 'ai-generated';

/** 角标宽度占原图宽度比例（仅 withBadge=true 时使用）：1024 宽图上约 307px，与预览效果稿一致 */
const BADGE_WIDTH_RATIO = 0.3;

/** 角标距图片右下角的留白占原图宽度比例（仅 withBadge=true 时使用） */
const MARGIN_RATIO = 0.03;

/** 角标素材缓存（仅 withBadge=true 时使用；模块级懒加载：解码一次反复使用，clone 出缩放副本避免污染原件） */
let badgeCache: Jimp | null = null;

/**
 * CDN 下载超时（毫秒）：Seedream 返回的是临时链接，挂起会拖住整个生成请求，
 * 用 AbortSignal 硬性限时，超时走降级路径返回原图
 */
const DOWNLOAD_TIMEOUT_MS = 15_000;

// 启动期软守卫：publicBaseUrl 未配置时 hostAiImage 只能返回 /uploads 相对路径，
// 该 URL 一旦被存入形象库（routes/avatar.ts 校验必须 http(s) 绝对地址）会静默 400。
// 本地/生产 .env 均已配置 PUBLIC_BASE_URL，这里只告警不抛错，避免测试环境启动失败。
if (!config.publicBaseUrl) {
  console.warn('[ImageBadge] 未配置 PUBLIC_BASE_URL：转存图将返回相对路径，存入形象库会被 http(s) 校验拒绝');
}

/**
 * 把 AI 生成的图转存到本站图床（可选合成可见品牌角标）
 * @param imageUrl - Seedream 返回的 CDN 图片 URL（有时效，须立刻取回内容再落盘）
 * @param options.withBadge - 是否合成**可见**品牌角标，默认 `false`。
 *   - `false`（默认）：只转存，图上不加任何可见元素。**当前 4 处调用点全部走默认值**，
 *     即线上不存在任何开着的可见角标调用点。
 *   - `true`：合成右下角品牌角标（assets/ai-badge.png）。通道保留，
 *     **当前无任何调用点开它**，仅作为日后可能需要时的一行开关。
 *   ⚠️ 不合成可见角标**不等于**去掉标识：隐式 AIGC 元数据（PNG tEXt 块）在落盘前照旧写入。
 * @returns 本站图片 URL（{publicBaseUrl}/uploads/ai-generated/{uuid}.png，
 *          与回忆录视频 share-cards 的 publicBaseUrl 口径一致）；
 *          任一环节失败降级返回原始 URL（优先保证图片可用，不阻断生成主流程）
 */
export async function hostAiImage(
  imageUrl: string,
  options: { withBadge?: boolean } = {},
): Promise<string> {
  try {
    // 1. 下载生成图内容（CDN 临时链接过期即失效，不能只存 URL；限时 15s 防挂起）
    const resp = await fetch(imageUrl, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
    if (!resp.ok) throw new Error(`下载生成图失败 HTTP ${resp.status}`);
    const base = await Jimp.read(Buffer.from(await resp.arrayBuffer()));

    // 2. 可见角标：默认**不合成**，只有显式传 { withBadge: true } 才贴到右下角
    //    （小图自动缩小、大图自动放大）；跳过合成不影响下面的隐式标识照写
    if (options.withBadge === true) {
      if (!badgeCache) badgeCache = await Jimp.read(BADGE_ASSET_PATH);
      const badge = badgeCache.clone();
      badge.resize(Math.round(base.getWidth() * BADGE_WIDTH_RATIO), Jimp.AUTO);
      const margin = Math.round(base.getWidth() * MARGIN_RATIO);
      const x = base.getWidth() - badge.getWidth() - margin;
      const y = base.getHeight() - badge.getHeight() - margin;
      base.composite(badge, x, y);
    }

    // 3. 落盘 uploads/ai-generated/{uuid}.png
    //    隐式标识（《标识办法》第十条）：落盘前在 PNG 元数据写入 AIGC tEXt 块，
    //    随文件元数据长期保留 —— 这是本模块唯一的标识动作，本轮未动
    const dir = path.join(config.uploadDir, SUB_DIR);
    await fs.mkdir(dir, { recursive: true });
    const filename = `${crypto.randomUUID()}.png`;
    const stamped = appendAigcPngMetadata(await base.getBufferAsync(Jimp.MIME_PNG));
    await fs.writeFile(path.join(dir, filename), stamped);

    // 4. 返回公网 URL（publicBaseUrl 未配置时为相对路径，与站内其他上传口径一致）
    return `${config.publicBaseUrl || ''}/uploads/${SUB_DIR}/${filename}`;
  } catch (err) {
    console.error('[ImageBadge] 图片转存失败，降级使用原图:', err instanceof Error ? err.message : err);
    return imageUrl;
  }
}
