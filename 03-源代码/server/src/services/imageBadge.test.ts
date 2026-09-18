/**
 * AI 生图转存服务（imageBadge）单元测试
 * mock jimp / fs / fetch，验证三条主链路：
 * 1. 默认（不传 options）：下载 → **不合成可见角标** → 落盘 → 返回本站 /uploads/ai-generated/xxx.png
 * 2. `{ withBadge: true }`：仍会合成可见角标（保留的一行开关）
 * 3. 失败：任一环节出错降级返回原图 URL（不抛错、不阻断生成主流程）
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------- hoisted mocks ----------
const { mockJimp, mockFs, mockAppendAigc } = vi.hoisted(() => ({
  // jimp 默认导出只用到 read/AUTO/MIME_PNG 三个成员
  mockJimp: { read: vi.fn(), AUTO: -1, MIME_PNG: 'image/png' },
  // imageBadge 只用 fs.promises 的 mkdir/writeFile
  mockFs: { mkdir: vi.fn(), writeFile: vi.fn() },
  // 隐式 AIGC 元数据：用「打标记」的替身，才能断言"写盘的那份确实盖过隐式标识"
  // （2026-09-19 独立复核指出：此前这条合规底线只靠注释守着，摘掉函数调用全量测试仍全绿）
  mockAppendAigc: vi.fn((buf: Buffer) => Buffer.concat([buf, Buffer.from('AIGC-STAMP')])),
}));

vi.mock('jimp', () => ({ default: mockJimp }));
vi.mock('fs', () => ({ promises: mockFs }));
vi.mock('./aigcMetadata.js', () => ({ appendAigcPngMetadata: mockAppendAigc }));
vi.mock('../config.js', () => ({
  config: {
    jwtSecret: 'test-jwt-secret',
    port: 3000,
    databaseUrl: 'postgresql://localhost/test',
    ai: { apiKey: '', baseUrl: '', model: '' },
    seedream: { apiKey: 'test-key' },
    meshy: { apiKey: '' },
    wechat: { appId: '', secret: '' },
    uploadDir: './uploads',
    publicBaseUrl: '',
  },
}));

import { hostAiImage } from './imageBadge.js';

/** Jimp 假图的类型声明（只声明被测代码/断言实际用到的成员） */
interface FakeJimpImage {
  /** 当前宽度/高度（resize 会改写） */
  _w: number;
  _h: number;
  getWidth(): number;
  getHeight(): number;
  clone(): FakeJimpImage;
  resize(w: number): FakeJimpImage;
  composite: ReturnType<typeof vi.fn>;
  getBufferAsync: ReturnType<typeof vi.fn>;
}

/** 构造带尺寸行为的 Jimp 假图对象：resize(w, AUTO) 按比例换算高度 */
function makeFakeImage(width: number, height: number): FakeJimpImage {
  const img: FakeJimpImage = {
    _w: width,
    _h: height,
    getWidth() { return this._w; },
    getHeight() { return this._h; },
    clone() { return makeFakeImage(width, height); },
    resize(w: number) {
      // 模拟 Jimp.resize(w, AUTO)：宽改写为 w，高按原比例换算
      const self = img;
      self._h = Math.round((self._h * w) / self._w);
      self._w = w;
      return img;
    },
    composite: vi.fn(),
    getBufferAsync: vi.fn(async () => Buffer.from('fake-png-bytes')),
  };
  return img;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockFs.mkdir.mockResolvedValue(undefined);
  mockFs.writeFile.mockResolvedValue(undefined);
});

describe('hostAiImage 成功链路（可见角标通道：{ withBadge: true }）', () => {
  it('下载原图与角标素材，等比缩放后贴右下角，落盘并返回本站 URL', async () => {
    const base = makeFakeImage(1000, 1000);   // Seedream 1024 图按 1000 便于口算
    const badgeAsset = makeFakeImage(451, 93); // 角标素材实际尺寸
    mockJimp.read
      .mockResolvedValueOnce(base)        // 第一次 read = 下载的原图
      .mockResolvedValueOnce(badgeAsset); // 第二次 read = 角标素材（进缓存）
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => new ArrayBuffer(8),
    });
    vi.stubGlobal('fetch', mockFetch);

    const result = await hostAiImage('https://seedream.example.com/out.png', { withBadge: true });

    // 1. fetch 了 CDN 原图（第二个参数是超时 signal 选项，只断言 URL 本身）
    expect(mockFetch.mock.calls[0][0]).toBe('https://seedream.example.com/out.png');
    // 2. 合成用的是"缩放后的克隆副本"：宽=原图 30%（300px），高度按素材比例换算（93→62）
    expect(base.composite).toHaveBeenCalledTimes(1);
    const usedBadge = base.composite.mock.calls[0][0] as { _w: number; _h: number };
    expect(usedBadge._w).toBe(300);
    expect(usedBadge._h).toBe(Math.round((93 * 300) / 451));
    // 3. 贴到右下角：留白 3% × 1000 = 30
    expect(base.composite).toHaveBeenCalledWith(usedBadge, 1000 - 300 - 30, 1000 - usedBadge._h - 30);
    // 4. 落盘到 uploads/ai-generated/{uuid}.png 并返回相对 URL
    expect(mockFs.mkdir).toHaveBeenCalledWith(expect.stringContaining('ai-generated'), { recursive: true });
    expect(mockFs.writeFile).toHaveBeenCalledTimes(1);
    expect(String(mockFs.writeFile.mock.calls[0][0])).toMatch(/ai-generated[\\/][0-9a-f-]{36}\.png$/);
    expect(result).toMatch(/^\/uploads\/ai-generated\/[0-9a-f-]{36}\.png$/);
  });
});

/**
 * 【2026-09-19 行为变更】默认**不合成**可见角标
 * 背景：用户按产品决策去掉所有可见 AI 角标，故默认值由「合成」翻转为「不合成」，
 * 函数也由旧名改名为 hostAiImage（如实描述它真正做的事：把 CDN 临时图转存到本站）。
 * 这里守住两条不变量：
 * ① 默认（不传 options）= 不合成可见角标，但仍照旧落盘并写入隐式 AIGC 元数据；
 * ② `{ withBadge: true }` = 仍能合成（保留那个一行开关，当前无任何调用点开它）。
 */
describe('hostAiImage 默认不合成可见角标（默认值翻转回归）', () => {
  it('默认（不传 options）：不读角标素材、不 composite，但照旧落盘并返回本站 URL', async () => {
    const base = makeFakeImage(1000, 1000);
    // 只排队一次 read（原图）：若默认值被改回「合成」，第二次 read 会拿到 undefined 并抛错降级，
    // 下面的 writeFile / URL 断言随即失败 —— 这条用例就是用来守住默认值的
    mockJimp.read.mockResolvedValueOnce(base);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => new ArrayBuffer(8),
    }));

    const result = await hostAiImage('https://seedream.example.com/out.png');

    // ① 只 read 了一次 —— 即只读了原图，没有读角标素材
    expect(mockJimp.read).toHaveBeenCalledTimes(1);
    // ② 没有做任何合成
    expect(base.composite).not.toHaveBeenCalled();
    // ③ 但落盘与返回 URL 一切照旧（隐式 AIGC 元数据走 appendAigcPngMetadata，在落盘那一步）
    expect(mockFs.writeFile).toHaveBeenCalledTimes(1);
    expect(String(mockFs.writeFile.mock.calls[0][0])).toMatch(/ai-generated[\\/][0-9a-f-]{36}\.png$/);
    expect(result).toMatch(/^\/uploads\/ai-generated\/[0-9a-f-]{36}\.png$/);
  });

  it('{ withBadge: true } 时仍会合成角标（保留的一行开关），落盘与 URL 照旧', async () => {
    // ⚠️ 本用例**只断言 composite 被调用**，不排队 mockResolvedValueOnce：
    //    `badgeCache` 是模块级缓存，跨用例存活；若在此排队「角标素材」的返回值而缓存已命中，
    //    那个排队值不会被消费，会**泄漏到下一个用例**（曾让「失败降级」用例误判）。
    //    角标通道的「缩放 + 右下角定位」细节已由本文件第一条用例覆盖，这里只守行为不变量。
    const base = makeFakeImage(1000, 1000);
    mockJimp.read.mockImplementation(async () => base);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => new ArrayBuffer(8),
    }));

    const result = await hostAiImage('https://seedream.example.com/out.png', { withBadge: true });

    // ① 开关打开时仍然合成
    expect(base.composite).toHaveBeenCalledTimes(1);
    // ② 落盘与返回 URL 与默认路径完全一致
    expect(mockFs.writeFile).toHaveBeenCalledTimes(1);
    expect(result).toMatch(/^\/uploads\/ai-generated\/[0-9a-f-]{36}\.png$/);
  });
});

describe('hostAiImage 失败降级', () => {
  it('CDN 图片下载失败时返回原始 URL，不写盘不抛错', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }));
    const result = await hostAiImage('https://seedream.example.com/gone.png');
    expect(result).toBe('https://seedream.example.com/gone.png');
    expect(mockFs.writeFile).not.toHaveBeenCalled();
  });
  it('jimp 解码失败等异常同样降级返回原始 URL', async () => {
    mockJimp.read.mockRejectedValue(new Error('unsupported image'));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => new ArrayBuffer(8),
    }));
    const result = await hostAiImage('https://seedream.example.com/broken.png');
    expect(result).toBe('https://seedream.example.com/broken.png');
  });
});

/**
 * 【2026-09-19 独立复核补】隐式 AIGC 标识的**回归断言**
 *
 * 为什么必须有这条：独立复核做了一次变异 —— 把 `appendAigcPngMetadata` 从落盘那一步**摘掉**，
 * 全量 **1353 条测试依然全绿**。也就是说：本轮去掉可见角标后，**唯一保留的合规底线（隐式标识）
 * 此前只靠一句注释守着，没有任何测试托底** —— 谁哪天顺手删掉它，CI 不会响。
 *
 * 这条把注释变成断言：**写进磁盘的那份，必须是「已盖上隐式标识」的那一份**。
 * （替身会给 buffer 追加标记，因此"摘掉调用"或"写错对象"都会让本用例变红。）
 */
describe('隐式 AIGC 元数据必须真的写进文件（独立复核补的合规回归）', () => {
  it('落盘内容 = appendAigcPngMetadata 的返回值，而不是未盖章的原 buffer', async () => {
    const base = makeFakeImage(1000, 1000);
    mockJimp.read.mockResolvedValueOnce(base);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => new ArrayBuffer(8),
    }));

    await hostAiImage('https://seedream.example.com/out.png');

    // ① 隐式标识函数必须被调用过（且只一次）
    expect(mockAppendAigc).toHaveBeenCalledTimes(1);
    // ② 写进磁盘的第二个参数必须就是它的返回值（带标记）—— 摘掉这一步、或改成写原 buffer，本用例即红
    const written = mockFs.writeFile.mock.calls[0][1] as Buffer;
    expect(Buffer.isBuffer(written)).toBe(true);
    expect(written.toString('binary')).toContain('AIGC-STAMP');
  });

  it('`{ withBadge: true }` 分支同样要写隐式标识（两条分支共用同一行，不得只保一条）', async () => {
    const base = makeFakeImage(1000, 1000);
    mockJimp.read.mockImplementation(async () => base);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => new ArrayBuffer(8),
    }));

    await hostAiImage('https://seedream.example.com/out.png', { withBadge: true });

    expect(mockAppendAigc).toHaveBeenCalledTimes(1);
    const written = mockFs.writeFile.mock.calls[0][1] as Buffer;
    expect(written.toString('binary')).toContain('AIGC-STAMP');
  });
});
