/**
 * AI 生成内容隐式标识模块（立项 v0.2 P0-3）
 *
 * 依据《人工智能生成合成内容标识办法》（2025-09-01 施行）第十条：
 *   "提供生成合成内容下载服务的，应当在下载文件的元数据中添加生成合成属性信息"（隐式标识）。
 * 本模块补齐文件**元数据层**（隐式标识）：
 *   - PNG：插入 tEXt 文本块（keyword=AIGC，IHDR 之后、IDAT 之前，符合 PNG 规范对 tEXt 的排序建议）
 *   - MP4：在 moov box 末尾追加 udta box，内嵌自定义 'AIGC' box（QuickTime/ISOBMFF 自定义元数据惯例）
 *
 * ⚠️ **与本模块配对的那条"可见标识"已于 2026-09-19 关闭**（用户决定，图片/成片/关键帧全链路去掉可见角标）：
 *   - 此前 `imageBadge.addAiBadge` 会合成右下角品牌角标（显式标识），现已重命名为 `hostAiImage`
 *     并把角标改为**默认关闭**的 `{ withBadge: true }` 一行开关，**当前无任何调用点开启**。
 *   - **隐式标识（本模块）不受影响、照旧写入** —— 它在文件元数据里、用户不可见，**不是"水印"**，
 *     是本轮刻意保留的合规底线。分工因此变为：**只做隐式，不做显式**。
 *   - 决策依据与已知风险见 `项目记忆/progress.md`（2026-09-19「决策留痕」两条）。
 *
 * 约束（立项书 §十 安全合规）：
 *   - 零第三方依赖：PNG CRC32 查表法 + ISOBMFF box 手写拼装
 *   - 永不阻断主流程：输入非法/解析失败一律原样返回，只记日志
 *   - 元数据值统一 ASCII（PNG tEXt 规范仅保证 Latin-1，避免中文编码歧义）
 */
import { promises as fs } from 'fs';

/** PNG 文件签名（8 字节） */
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** PNG CRC32 多项式（IEEE 802.3，zlib.crc32 同款） */
const CRC32_POLYNOMIAL = 0xedb88320;

/** CRC32 查表（模块级懒初始化：256 项，首次调用构建） */
let crcTable: Uint32Array | null = null;

function getCrcTable(): Uint32Array {
  if (crcTable) return crcTable;
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? CRC32_POLYNOMIAL ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  crcTable = table;
  return table;
}

/** 计算 PNG chunk CRC32（类型 + 数据字节序列） */
export function pngCrc32(data: Buffer): number {
  const table = getCrcTable();
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc = table[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * 构造 PNG tEXt 文本块：4字节长度 + 'tEXt' + data(keyword \0 text) + 4字节CRC
 * keyword 与 text 均按 ASCII 处理（调用方保证），超长 keyword 截断到 79 字节（规范上限）
 */
export function buildPngTextChunk(keyword: string, text: string): Buffer {
  const kw = Buffer.from(keyword.slice(0, 79), 'latin1');
  const tx = Buffer.from(text, 'latin1');
  const data = Buffer.concat([kw, Buffer.from([0x00]), tx]);
  const head = Buffer.alloc(4);
  head.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(pngCrc32(Buffer.concat([Buffer.from('tEXt', 'latin1'), data])), 0);
  return Buffer.concat([head, Buffer.from('tEXt', 'latin1'), data, crcBuf]);
}

/**
 * 给 PNG 插入 AI 生成隐式标识 tEXt 块（keyword=AIGC）
 * 插入位置：IHDR 之后、第一个 IDAT 之前（遍历 chunk 定位，兼容签名后带其他辅助块的结构）
 * @returns 插入后的新 Buffer；输入非 PNG 或结构解析失败时原样返回
 */
export function appendAigcPngMetadata(png: Buffer): Buffer {
  try {
    if (png.length < 33 || !png.subarray(0, 8).equals(PNG_SIGNATURE)) {
      return png;
    }

    // 遍历顶层 chunk，找到第一个 IDAT 的偏移（tEXt 必须在图像数据前）
    let offset = 8;
    let insertAt = -1;
    while (offset + 8 <= png.length) {
      const len = png.readUInt32BE(offset);
      const type = png.subarray(offset + 4, offset + 8).toString('latin1');
      if (len === 0 || offset + 12 + len > png.length) {
        // 长度越界 = 结构非法，放弃注入（不阻断交付）
        console.warn('[AigcMetadata] PNG chunk 结构异常，跳过隐式标识注入');
        return png;
      }
      if (type === 'IDAT') {
        insertAt = offset;
        break;
      }
      offset += 12 + len; // 4长度 + 4类型 + 数据 + 4CRC
    }

    if (insertAt < 0) {
      console.warn('[AigcMetadata] PNG 未找到 IDAT 块，跳过隐式标识注入');
      return png;
    }

    const chunk = buildPngTextChunk(
      'AIGC',
      'xinghuanhai.com ai-generated service=xinghuanhai',
    );
    return Buffer.concat([png.subarray(0, insertAt), chunk, png.subarray(insertAt)]);
  } catch (err) {
    console.warn('[AigcMetadata] PNG 隐式标识注入失败，使用原图:', err instanceof Error ? err.message : err);
    return png;
  }
}

/**
 * 给 MP4（ISOBMFF）注入 AI 生成隐式标识：在 moov box 子盒子末尾追加 udta，
 * udta 内嵌自定义 'AIGC' box，内容为 ASCII 生成属性信息
 * @returns 注入后的新 Buffer；输入非 MP4 结构 / 遇到 64 位 largesize / moov 缺失时原样返回
 */
export function appendAigcMp4Metadata(mp4: Buffer): Buffer {
  try {
    // 顶层 box 遍历：size(4) + type(4)；size===1 表示 64 位 largesize（罕见，不处理防坏文件）
    let offset = 0;
    let moovStart = -1;
    let moovSize = 0;
    while (offset + 8 <= mp4.length) {
      const size = mp4.readUInt32BE(offset);
      const type = mp4.subarray(offset + 4, offset + 8).toString('latin1');
      if (size === 1) {
        console.warn('[AigcMetadata] MP4 含 64 位 largesize box，跳过隐式标识注入');
        return mp4;
      }
      if (size < 8 || offset + size > mp4.length) {
        console.warn('[AigcMetadata] MP4 box 结构异常，跳过隐式标识注入');
        return mp4;
      }
      if (type === 'moov') {
        moovStart = offset;
        moovSize = size;
        break;
      }
      offset += size;
    }

    if (moovStart < 0) {
      console.warn('[AigcMetadata] MP4 未找到 moov box，跳过隐式标识注入');
      return mp4;
    }

    // moov 内部：跳过 8 字节 header，遍历子盒子找到末尾插入点
    let childOffset = moovStart + 8;
    const moovEnd = moovStart + moovSize;
    while (childOffset + 8 <= moovEnd) {
      const childSize = mp4.readUInt32BE(childOffset);
      if (childSize === 1 || childSize < 8 || childOffset + childSize > moovEnd) {
        // 子盒子结构异常（如 meta 全 box 特例）——保险起见放弃注入
        console.warn('[AigcMetadata] moov 子盒子结构异常，跳过隐式标识注入');
        return mp4;
      }
      childOffset += childSize;
    }

    // 构造 udta > AIGC 两层盒子（内容 ASCII：服务方 + 生成属性）
    const aigcPayload = Buffer.from('xinghuanhai.com ai-generated service=xinghuanhai', 'latin1');
    const aigcHead = Buffer.alloc(8);
    aigcHead.writeUInt32BE(8 + aigcPayload.length, 0);
    aigcHead.write('AIGC', 4, 'latin1');
    const udtaHead = Buffer.alloc(8);
    udtaHead.writeUInt32BE(8 + 8 + aigcPayload.length, 0);
    udtaHead.write('udta', 4, 'latin1');
    const udtaBox = Buffer.concat([udtaHead, aigcHead, aigcPayload]);

    // 插入到 moov 子盒子末尾（moov 内），并回写 moov 总长度（moov 前后内容原样平移）
    const moovOld = mp4.subarray(moovStart + 8, childOffset);
    const newMoov = Buffer.alloc(8 + moovOld.length + udtaBox.length);
    newMoov.writeUInt32BE(moovSize + udtaBox.length, 0);
    newMoov.write('moov', 4, 'latin1');
    moovOld.copy(newMoov, 8);
    udtaBox.copy(newMoov, 8 + moovOld.length);

    return Buffer.concat([
      mp4.subarray(0, moovStart),
      newMoov,
      mp4.subarray(moovEnd),
    ]);
  } catch (err) {
    console.warn('[AigcMetadata] MP4 隐式标识注入失败，使用原文件:', err instanceof Error ? err.message : err);
    return mp4;
  }
}

/**
 * 文件级便捷入口：读取视频文件 → 注入 AIGC 元数据 → 回写同一文件
 * 回忆录处理器在成片落盘后、质检前调用；文件缺失/读写失败仅记日志，不阻断交付
 */
export async function stampAigcVideoMetadataOnFile(videoPath: string): Promise<void> {
  try {
    const buf = await fs.readFile(videoPath);
    const stamped = appendAigcMp4Metadata(buf);
    if (stamped !== buf) {
      await fs.writeFile(videoPath, stamped);
    }
  } catch (err) {
    console.warn('[AigcMetadata] 视频隐式标识写入失败（不阻断交付）:', err instanceof Error ? err.message : err);
  }
}
