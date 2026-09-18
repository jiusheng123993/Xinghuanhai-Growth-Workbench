/**
 * AI 生图角标服务单元测试
 * mock jimp / fs / fetch，验证两条主链路：
 * 1. 成功：下载 → 等比缩放合成到右下角 → 落盘 → 返回本站 /uploads/ai-generated/xxx.png
 * 2. 失败：任一环节出错降级返回原图 URL（不抛错、不阻断生成主流程）
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------- hoisted mocks ----------
const { mockJimp, mockFs } = vi.hoisted(() => ({
  // jimp 默认导出只用到 read/AUTO/MIME_PNG 三个成员
  mockJimp: { read: vi.fn(), AUTO: -1, MIME_PNG: 'image/png' },
  // imageBadge 只用 fs.promises 的 mkdir/writeFile
  mockFs: { mkdir: vi.fn(), writeFile: vi.fn() },
}));

vi.mock('jimp', () => ({ default: mockJimp }));
vi.mock('fs', () => ({ promises: mockFs }));
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

import { addAiBadge } from './imageBadge.js';

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

describe('addAiBadge 成功链路', () => {
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

    const result = await addAiBadge('https://seedream.example.com/out.png');

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
 * 【2026-09-19 新增】中间产物路径：`{ visible: false }`
 * 背景：回忆录关键帧是**中间产物**（只作视频首帧、不直接给用户看）。
 * 可见角标会被 Seedance 动起来（可能扭曲成渲染缺陷），且等于给成片凭空加一个用户可见元素，
 * 故关键帧传 `visible:false` —— **只跳过合成，不跳过合规**：隐式 AIGC 元数据照旧写入。
 */
describe('addAiBadge { visible: false }（中间产物：不合成可见角标，但仍落盘）', () => {
  it('不读取角标素材、不 composite，但照旧落盘并返回本站 URL', async () => {
    const base = makeFakeImage(1000, 1000);
    mockJimp.read.mockResolvedValueOnce(base); // 只应有这一次 read（角标素材不该被读）
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => new ArrayBuffer(8),
    }));

    const result = await addAiBadge('https://seedream.example.com/out.png', { visible: false });

    // ① 只 read 了一次 —— 即只读了原图，没有读角标素材
    expect(mockJimp.read).toHaveBeenCalledTimes(1);
    // ② 没有做任何合成
    expect(base.composite).not.toHaveBeenCalled();
    // ③ 但落盘与返回 URL 一切照旧（合规元数据走 appendAigcPngMetadata，在落盘那步）
    expect(mockFs.writeFile).toHaveBeenCalledTimes(1);
    expect(result).toMatch(/^\/uploads\/ai-generated\/[0-9a-f-]{36}\.png$/);
  });

  it('默认（不传 options）仍然合成角标 —— 保证既有 4 处调用点行为不变', async () => {
    // ⚠️ 本用例**只断言 composite 被调用**，不再排队 mockResolvedValueOnce：
    //    `badgeCache` 是模块级缓存，跨用例存活；若在此排队"角标素材"的返回值而缓存已命中，
    //    那个排队值不会被消费，会**泄漏到下一个用例**（曾让"失败降级"用例误判）。
    //    默认路径的"缩放 + 右下角定位"细节已由本文件第一条用例覆盖，这里只守行为不变量。
    const base = makeFakeImage(1000, 1000);
    mockJimp.read.mockImplementation(async () => base);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => new ArrayBuffer(8),
    }));

    await addAiBadge('https://seedream.example.com/out.png');

    expect(base.composite).toHaveBeenCalledTimes(1);
  });
});

describe('addAiBadge 失败降级', () => {
  it('CDN 图片下载失败时返回原始 URL，不写盘不抛错', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }));
    const result = await addAiBadge('https://seedream.example.com/gone.png');
    expect(result).toBe('https://seedream.example.com/gone.png');
    expect(mockFs.writeFile).not.toHaveBeenCalled();
  });

  it('jimp 解码失败等异常同样降级返回原始 URL', async () => {
    mockJimp.read.mockRejectedValue(new Error('unsupported image'));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => new ArrayBuffer(8),
    }));
    const result = await addAiBadge('https://seedream.example.com/broken.png');
    expect(result).toBe('https://seedream.example.com/broken.png');
  });
});
