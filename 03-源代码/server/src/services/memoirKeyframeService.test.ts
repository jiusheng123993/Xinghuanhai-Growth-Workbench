/**
 * 回忆录关键帧服务单元测试（模式 C：先专用关键帧再视频）
 * 覆盖：
 *   1. 提示词组装：显式声明 16:9 画幅、整段复用该镜十段 prompt、静帧约束、排除项、设定图职责
 *   2. 名字红线：宠物名字绝不进提示词（用带名字的档案跑一遍，断言提示词与请求体都不含该名字）
 *   3. 参考图分支：有设定图 → 两张参考图（且显式禁止照抄四宫格版式）；无设定图 → 只有真实照片
 *   4. 失败降级：上游非 2xx / 网络异常 / 未配置 Key → 一律返回 null（绝不抛异常给主链路）
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// 可变 config mock：便于逐条用例切换「Seedream Key 有无」
vi.mock('../config.js', () => ({
  config: {
    seedream: { apiKey: 'test-seedream-key' },
    uploadDir: './uploads',
    publicBaseUrl: 'https://api.example.com',
  },
}));

// 转存走真实 jimp 太重；本文件只关心拿到生成图后是否落盘返回，故 mock 成透传
vi.mock('./imageBadge.js', () => ({ hostAiImage: vi.fn(async (url: string) => url) }));

import { config } from '../config.js';
import { hostAiImage } from './imageBadge.js';
import {
  buildMemoirKeyframePrompt,
  generateMemoirKeyframe,
  KEYFRAME_ASPECT_RATIO,
} from './memoirKeyframeService.js';
// 主体外貌指代走真实实现（品种 → "一只英短猫咪"），保证"名字不进提示词"是在真实组装链上验的
import { petSubjectText } from './petPrompt.js';

/** 带名字的宠物档案（名字「烧鸡」是历史线上事故的原型：绝不进任何提示词） */
const PET_NAME = '烧鸡';
const PET_BREED = '英短';
const PET_SPECIES = 'cat';
/** 真实组装链得到的貌指代（不自己拼字符串，避免测试与实现两套口径） */
const SUBJECT = petSubjectText(PET_BREED, PET_SPECIES);

const PHOTO_URL = 'https://cdn.example.com/pet-real.jpg';
const MULTIVIEW_URL = 'https://cdn.example.com/pet-multiview.png';

/** 该镜的十段 prompt 片段（真实值来自 M2 组装，这里取代表性片段即可） */
const SEGMENT_PROMPT =
  'GLOBAL STYLE: 写实风格。\nSCENE: 窗台上的黄昏光影。\nCHARACTERS: 宠物=参考图（英短，白胸脯）。\nShot 1: 缓慢推镜。\nLIGHTING: 黄昏暖光。';

/** 构造一个成功的 Seedream 响应（返回临时 CDN 图 URL） */
function okResponse(url = 'https://cdn.example.com/keyframe.png') {
  return { ok: true, status: 200, json: async () => ({ data: [{ url }] }) };
}

/** 取 fetch 第一次调用的请求体（JSON.parse 后的对象） */
function firstRequestBody(): { prompt: string; images?: string[]; size?: string } {
  const fetchMock = globalThis.fetch as unknown as { mock: { calls: Array<[string, { body: string }]> } };
  const [, init] = fetchMock.mock.calls[0];
  return JSON.parse(init.body);
}

describe('memoirKeyframeService 提示词组装', () => {
  it('显式声明 16:9 画幅，并整段保留该镜十段 prompt 作为画面依据', () => {
    const prompt = buildMemoirKeyframePrompt({
      segmentPrompt: SEGMENT_PROMPT,
      petSubject: SUBJECT,
      hasMultiviewReference: false,
      durationSec: 5,
    });
    // 画幅声明（提示词与 Seedance ratio 必须一致，否则会出现裁切/黑边）
    expect(prompt).toContain(KEYFRAME_ASPECT_RATIO);
    expect(KEYFRAME_ASPECT_RATIO).toBe('16:9');
    // 十段 prompt 未被丢弃重写：原样保留为画面依据
    expect(prompt).toContain(SEGMENT_PROMPT);
    // 交代了这张首帧将来要撑起多长的镜头
    expect(prompt).toContain('5 秒');
  });

  it('静帧约束到位：排除运动模糊/拖影，且明确不奔跑跳跃', () => {
    const prompt = buildMemoirKeyframePrompt({
      segmentPrompt: SEGMENT_PROMPT,
      petSubject: SUBJECT,
      hasMultiviewReference: false,
      durationSec: 5,
    });
    expect(prompt).toContain('静止关键帧');
    expect(prompt).toContain('运动模糊');
    expect(prompt).toContain('不奔跑、不跳跃、不腾空');
    // 有参考图才写"以参考照片为准"（无参考图时写它是说谎，见提示词技能金科玉律 #4）
    expect(prompt).toContain('以参考照片为准');
    // 主体锁定：只出现这一只宠物
    expect(prompt).toContain('只出现这一只宠物');
  });

  it('宠物名字绝不进提示词（带名字的档案跑一遍，产物里查不到名字）', () => {
    const prompt = buildMemoirKeyframePrompt({
      segmentPrompt: SEGMENT_PROMPT,
      petSubject: SUBJECT,
      hasMultiviewReference: true,
      durationSec: 8,
    });
    expect(prompt).not.toContain(PET_NAME);
    expect(prompt).not.toContain('名叫');
    expect(prompt).not.toContain('named');
    // 名字被外貌指代替换：主体写的是品种
    expect(prompt).toContain(PET_BREED);
  });

  it('有设定图 → 写清参考图2 的职责并禁止照抄四宫格版式', () => {
    const prompt = buildMemoirKeyframePrompt({
      segmentPrompt: SEGMENT_PROMPT,
      petSubject: SUBJECT,
      hasMultiviewReference: true,
      durationSec: 5,
    });
    expect(prompt).toContain('参考图2');
    expect(prompt).toContain('分格');
  });

  it('无设定图 → 只讲参考图1，不出现"参考图2"', () => {
    const prompt = buildMemoirKeyframePrompt({
      segmentPrompt: SEGMENT_PROMPT,
      petSubject: SUBJECT,
      hasMultiviewReference: false,
      durationSec: 5,
    });
    expect(prompt).toContain('参考图1');
    expect(prompt).not.toContain('参考图2');
  });
});

describe('memoirKeyframeService 生成与降级', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    config.seedream.apiKey = 'test-seedream-key';
    // restoreAllMocks 会清掉 vi.fn 的实现，这里每例重建透传实现
    vi.mocked(hostAiImage).mockImplementation(async (url: string) => url);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('有设定图 → 两张参考图（顺序：真实照片、设定图），尺寸 16:9，落盘后返回本站 URL', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okResponse()));
    const url = await generateMemoirKeyframe({
      photoUrl: PHOTO_URL,
      multiviewUrl: MULTIVIEW_URL,
      segmentPrompt: SEGMENT_PROMPT,
      petSubject: SUBJECT,
      durationSec: 5,
    });
    expect(url).toBe('https://cdn.example.com/keyframe.png');
    const body = firstRequestBody();
    expect(body.images).toEqual([PHOTO_URL, MULTIVIEW_URL]);
    expect(body.size).toBe('1920x1080');
    // 请求体里的提示词同样不含宠物名字（红线在真正的出网请求上也成立）
    expect(body.prompt).not.toContain(PET_NAME);
    expect(body.prompt).toContain('16:9');
    // 走既有转存路径（imageBadge.hostAiImage）。
    // 关键帧是中间产物：不传 options 即走默认（不合成可见角标）；隐式 AIGC 元数据仍照写。
    expect(vi.mocked(hostAiImage)).toHaveBeenCalledWith('https://cdn.example.com/keyframe.png');
  });

  it('无设定图 → 只有一张参考图（真实照片）', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okResponse()));
    await generateMemoirKeyframe({
      photoUrl: PHOTO_URL,
      multiviewUrl: null,
      segmentPrompt: SEGMENT_PROMPT,
      petSubject: SUBJECT,
      durationSec: 5,
    });
    expect(firstRequestBody().images).toEqual([PHOTO_URL]);
  });

  it('上游非 2xx → 返回 null（不抛异常，由调用方回落原照片）', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 400, json: async () => ({}) }));
    const url = await generateMemoirKeyframe({
      photoUrl: PHOTO_URL,
      segmentPrompt: SEGMENT_PROMPT,
      petSubject: SUBJECT,
      durationSec: 5,
    });
    expect(url).toBeNull();
    expect(vi.mocked(hostAiImage)).not.toHaveBeenCalled();
  });

  it('网络异常（fetch reject）→ 返回 null 而不是抛错', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNRESET')));
    await expect(
      generateMemoirKeyframe({
        photoUrl: PHOTO_URL,
        segmentPrompt: SEGMENT_PROMPT,
        petSubject: SUBJECT,
        durationSec: 5,
      }),
    ).resolves.toBeNull();
  });

  it('未配置 Seedream Key → 返回 null 且不发请求', async () => {
    config.seedream.apiKey = '';
    const fetchMock = vi.fn().mockResolvedValue(okResponse());
    vi.stubGlobal('fetch', fetchMock);
    const url = await generateMemoirKeyframe({
      photoUrl: PHOTO_URL,
      segmentPrompt: SEGMENT_PROMPT,
      petSubject: SUBJECT,
      durationSec: 5,
    });
    expect(url).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('没有真实照片 → 返回 null（不做凭想象的文生图）', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse());
    vi.stubGlobal('fetch', fetchMock);
    const url = await generateMemoirKeyframe({
      photoUrl: '',
      segmentPrompt: SEGMENT_PROMPT,
      petSubject: SUBJECT,
      durationSec: 5,
    });
    expect(url).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
