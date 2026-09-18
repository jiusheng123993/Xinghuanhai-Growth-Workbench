/**
 * 视频生成服务 - 分镜驱动新管线测试（M6）
 * 覆盖：
 *   1. script 存在 → 走分镜驱动管线（engine=seedance-scripted-vlog）
 *   2. 每镜 prompt 经 M2 组装且包含身份锚点
 *   3. script 不存在 → 走旧管线（兼容）
 *   4. 片段生成失败 → 抛错
 *   5. 模式 C 关键帧接入：关键帧成功 → 作 Seedance 首帧；失败/为 null → 回落原照片
 *   6. 每镜画幅固定 16:9（不再自适应跟随首帧）
 *   7. 关键帧入参：主体是外貌指代（不含宠物名字）、透传四视图设定图 URL
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// mock config（seedance 已配置 → 走真实模式）
vi.mock('../config.js', () => {
  const config = {
    seedance: { apiKey: 'seedance-key', model: 'doubao-seedance-1-5-pro-251215' },
    seedream: { apiKey: 'seedream-key' },
    uploadDir: './uploads',
    publicBaseUrl: 'https://api.example.com',
    doubaoSpeech: { apiKey: '', resourceId: 'seed-tts-2.0', voice: 'v', baseUrl: '' },
  };
  return { config };
});

// mock seedance adapter（片段生成成功）
vi.mock('../adapters/seedanceAdapter.js', () => ({
  createVideoGenerationTask: vi.fn(),
  queryVideoTask: vi.fn(),
  isSeedanceConfigured: vi.fn().mockReturnValue(true),
}));

// mock ffmpeg/ffprobe（execFile callback 成功；兼容 execFile(cmd,args,cb) 与 execFile(cmd,args,options,cb)）
vi.mock('node:child_process', () => ({
  execFile: vi.fn().mockImplementation(
    (
      _cmd: string,
      _args: unknown[],
      arg3: unknown,
      arg4?: unknown,
    ) => {
      const cb =
        typeof arg3 === 'function'
          ? (arg3 as (err: Error | null, r: unknown) => void)
          : (arg4 as (err: Error | null, r: unknown) => void);
      if (cb) cb(null, { stdout: '10\n', stderr: '' });
    },
  ),
}));

// mock fs
vi.mock('node:fs/promises', () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
  rm: vi.fn().mockResolvedValue(undefined),
}));

// mock delay
vi.mock('../utils/delay.js', () => ({
  delay: vi.fn().mockResolvedValue(undefined),
}));

// mock 数据库：关键帧需要宠物档案（四视图设定图 + 品种/物种），返回固定行避免真实连库
vi.mock('../db.js', () => ({
  pool: { query: vi.fn() },
}));

// mock 关键帧服务：本文件只验证"接入与回落"的编排；
// 关键帧自身的提示词与 Seedream 调用由 memoirKeyframeService.test.ts 覆盖
vi.mock('./memoirKeyframeService.js', () => ({
  generateMemoirKeyframe: vi.fn(),
}));

// mock TTS（旁白成功，非降级）
vi.mock('./ttsService.js', () => ({
  synthNarration: vi.fn().mockResolvedValue({ audioPath: '/tmp/nar.mp3', degraded: false, durationSec: 0 }),
}));

import {
  createVideoGenerationTask,
  queryVideoTask,
} from '../adapters/seedanceAdapter.js';
import { generateMemoirVideo } from './videoGenerationService.js';
import { generateMemoirKeyframe } from './memoirKeyframeService.js';
import { pool } from '../db.js';
import { synthNarration } from './ttsService.js';
import { execFile } from 'node:child_process';
import type { Mock } from 'vitest';
import type { MemoirScript } from '../schemas/memoirScript.js';

const mockedCreate = vi.mocked(createVideoGenerationTask);
const mockedQuery = vi.mocked(queryVideoTask);
const mockedExecFile = vi.mocked(execFile);
const mockedKeyframe = vi.mocked(generateMemoirKeyframe);
// pool.query 是重载函数，直接 as Mock 省去 pg 的 QueryResult 类型拼装（运行时本来就是 vi.fn）
const mockedPoolQuery = pool.query as unknown as Mock;

/** 宠物档案里的四视图设定图 URL（关键帧第二张参考图） */
const MULTIVIEW_URL = 'https://cdn.example.com/pet-multiview.png';

/** 构造一个合法的分镜脚本（8 镜） */
function makeScript(): MemoirScript {
  const segments = Array.from({ length: 8 }, (_, i) => ({
    photo_index: i,
    shot_type: 'push_in' as const,
    camera: 'close_up' as const,
    lighting: 'golden_hour' as const,
    transition: 'cut' as const,
    duration_sec: 5,
    seedance_prompt:
      'GLOBAL STYLE: 写实风格。SCENE: 橘猫在窗台。CHARACTERS: 参考图1。LOCATION: 窗台。FIRST FRAME: 居中。Shot 1: 推镜。OPTICS: 47度。PHYSICS: 毛发柔软。LIGHTING: 黄昏。AUDIO: 安静。',
    narration: `第${i}镜的旁白文案，有细节。`,
    subtitle: i === 0 ? '2014 年 · 黄昏' : '',
  }));
  return {
    title: '窗台上的第三块砖',
    theme: '陪伴',
    emotion_curve: ['calm', 'memory', 'relief'],
    narration_voice: '晓晓',
    music_mood: 'nostalgic' as const,
    identity_anchor: '橘色短毛猫，白色胸脯，右耳缺一角',
    segments,
  };
}

describe('videoGenerationService 分镜驱动管线', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // mock 全局 fetch：片段下载（downloadFile）返回假 mp4 数据
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, arrayBuffer: async () => new ArrayBuffer(100) }),
    );
    // 片段生成成功：create 返回 taskId，query 返回 succeeded + URL
    mockedCreate.mockResolvedValue({ taskId: 'seedance-task', error: null });
    mockedQuery.mockResolvedValue({
      status: 'succeeded',
      videoUrl: 'https://cdn.example.com/seg.mp4',
      error: null,
    });
    // 宠物档案（关键帧用）：带名字「烧鸡」+ 四视图设定图 —— 用于验证名字红线与设定图透传
    mockedPoolQuery.mockResolvedValue({
      rows: [{ name: '烧鸡', breed: '英短', species: 'cat', multiviewUrl: MULTIVIEW_URL }],
    });
    // 关键帧默认返回 null：既有用例走的正是"失败 → 回落原照片"分支（行为与改造前一致）
    mockedKeyframe.mockResolvedValue(null);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('script 存在 → 走分镜驱动管线（engine=seedance-scripted-vlog）', async () => {
    const result = await generateMemoirVideo({
      taskId: 'task-scripted',
      productLine: 'memorial',
      sourcePhotos: Array.from({ length: 8 }, (_, i) => `https://cdn/pet${i}.jpg`),
      script: makeScript(),
    });
    expect(result.engine).toBe('seedance-scripted-vlog');
    expect(result.videoUrl).toContain('final.mp4');
    // 8 镜 → 8 次片段创建
    expect(mockedCreate).toHaveBeenCalledTimes(8);
  });

  it('每镜 prompt 经 M2 组装且包含身份锚点', async () => {
    const script = makeScript();
    await generateMemoirVideo({
      taskId: 'task-spy',
      productLine: 'memorial',
      sourcePhotos: Array.from({ length: 8 }, (_, i) => `https://cdn/pet${i}.jpg`),
      script,
    });
    // 直接验证 seedance adapter 收到的 prompt 含身份锚点 + 时长来自分镜
    const createCalls = mockedCreate.mock.calls;
    expect(createCalls.length).toBeGreaterThan(0);
    for (const call of createCalls) {
      const params = call[0] as { prompt: string; duration?: number };
      expect(params.prompt).toContain('橘色短毛猫');
      expect(params.prompt).toContain('COUNT LOCK'); // M2 追加的连续性锁
      expect(params.duration).toBe(5);
    }
  });

  it('script 不存在 → 走旧管线（engine=seedance-memorial-narrative-vlog）', async () => {
    const result = await generateMemoirVideo({
      taskId: 'task-legacy',
      productLine: 'memorial',
      sourcePhotos: Array.from({ length: 8 }, (_, i) => `https://cdn/pet${i}.jpg`),
      duration: 60,
      script: null,
    });
    expect(result.engine).toBe('seedance-memorial-narrative-vlog');
  });

  it('片段生成失败 → 抛错', async () => {
    mockedCreate.mockResolvedValue({ taskId: 'task-fail', error: 'create failed' });
    await expect(
      generateMemoirVideo({
        taskId: 'task-fail',
        productLine: 'memorial',
        sourcePhotos: Array.from({ length: 8 }, (_, i) => `https://cdn/pet${i}.jpg`),
        script: makeScript(),
      }),
    ).rejects.toThrow();
  });

  it('旁白降级不影响视频生成（TTS degraded → 仍返回结果）', async () => {
    // TTS 返回降级（无旁白）
    vi.mocked(synthNarration).mockResolvedValueOnce({
      audioPath: '',
      degraded: true,
      durationSec: 0,
    });
    const result = await generateMemoirVideo({
      taskId: 'task-tts-degraded',
      productLine: 'memorial',
      sourcePhotos: Array.from({ length: 8 }, (_, i) => `https://cdn/pet${i}.jpg`),
      script: makeScript(),
    });
    expect(result.engine).toBe('seedance-scripted-vlog');
    expect(result.videoUrl).toContain('final.mp4');
  });

  it('static_photo 镜头（全家福）不调 Seedance，走 ffmpeg zoompan', async () => {
    const script = makeScript();
    // 最后一镜改为 static_photo（全家福合影）
    script.segments[script.segments.length - 1] = {
      ...script.segments[script.segments.length - 1],
      source: 'static_photo',
    };
    await generateMemoirVideo({
      taskId: 'task-family',
      productLine: 'memorial',
      sourcePhotos: Array.from({ length: 8 }, (_, i) => `https://cdn/pet${i}.jpg`),
      script,
    });
    // 8 镜中 7 镜走 Seedance，1 镜（全家福）走 ffmpeg
    expect(mockedCreate).toHaveBeenCalledTimes(7);
    // ffmpeg（execFile）被调用（zoompan 生成静态动效 + 最终拼接）
    expect(mockedExecFile).toHaveBeenCalled();
  });

  it('关键帧成功 → Seedance 收到的首帧是关键帧 URL（模式 C）', async () => {
    mockedKeyframe.mockResolvedValue('https://cdn.example.com/keyframe.png');
    await generateMemoirVideo({
      taskId: 'task-keyframe',
      productLine: 'memorial',
      sourcePhotos: Array.from({ length: 8 }, (_, i) => `https://cdn/pet${i}.jpg`),
      script: makeScript(),
    });
    // 8 镜各出一次关键帧，且每一镜的第一帧都换成关键帧图
    expect(mockedKeyframe).toHaveBeenCalledTimes(8);
    expect(mockedCreate).toHaveBeenCalledTimes(8);
    for (const call of mockedCreate.mock.calls) {
      expect((call[0] as { imageUrl: string }).imageUrl).toBe('https://cdn.example.com/keyframe.png');
    }
  });

  it('关键帧返回 null → Seedance 首帧回落为该镜的原照片（各镜各自对应）', async () => {
    mockedKeyframe.mockResolvedValue(null);
    await generateMemoirVideo({
      taskId: 'task-keyframe-fallback',
      productLine: 'memorial',
      sourcePhotos: Array.from({ length: 8 }, (_, i) => `https://cdn/pet${i}.jpg`),
      script: makeScript(),
    });
    // 逐镜核对：photo_index=i 的镜，首帧应是 photos[i]
    mockedCreate.mock.calls.forEach((call, i) => {
      expect((call[0] as { imageUrl: string }).imageUrl).toBe(`https://cdn/pet${i}.jpg`);
    });
  });

  it('每镜画幅固定 16:9（不再随首帧比例自适应）', async () => {
    await generateMemoirVideo({
      taskId: 'task-ratio',
      productLine: 'memorial',
      sourcePhotos: Array.from({ length: 8 }, (_, i) => `https://cdn/pet${i}.jpg`),
      script: makeScript(),
    });
    expect(mockedCreate.mock.calls.length).toBeGreaterThan(0);
    for (const call of mockedCreate.mock.calls) {
      expect((call[0] as { ratio?: string }).ratio).toBe('16:9');
    }
  });

  it('关键帧入参：主体是外貌指代（不含宠物名字），并透传四视图设定图 URL', async () => {
    await generateMemoirVideo({
      taskId: 'task-keyframe-args',
      productLine: 'memorial',
      sourcePhotos: Array.from({ length: 8 }, (_, i) => `https://cdn/pet${i}.jpg`),
      script: makeScript(),
    });
    const args = mockedKeyframe.mock.calls[0][0] as {
      photoUrl: string;
      multiviewUrl: string | null;
      segmentPrompt: string;
      petSubject: string;
      durationSec: number;
    };
    // 主体 = petSubjectText(品种, 物种)，名字「烧鸡」绝不出现
    expect(args.petSubject).toBe('一只英短猫咪');
    expect(args.petSubject).not.toContain('烧鸡');
    // 画面依据是 M2 组装后的十段 prompt（含身份锚点），同样不含名字
    expect(args.segmentPrompt).toContain('橘色短毛猫');
    expect(args.segmentPrompt).not.toContain('烧鸡');
    // 设定图透传 + 该镜真实照片作参考图1 + 时长来自分镜
    expect(args.multiviewUrl).toBe(MULTIVIEW_URL);
    expect(args.photoUrl).toBe('https://cdn/pet0.jpg');
    expect(args.durationSec).toBe(5);
  });

  it('宠物档案无设定图 → keyframe 入参 multiviewUrl 为 null（不阻断生成）', async () => {
    mockedPoolQuery.mockResolvedValue({
      rows: [{ name: '烧鸡', breed: '英短', species: 'cat', multiviewUrl: null }],
    });
    const result = await generateMemoirVideo({
      taskId: 'task-keyframe-nomultiview',
      productLine: 'memorial',
      sourcePhotos: Array.from({ length: 8 }, (_, i) => `https://cdn/pet${i}.jpg`),
      script: makeScript(),
    });
    expect(result.engine).toBe('seedance-scripted-vlog');
    expect((mockedKeyframe.mock.calls[0][0] as { multiviewUrl: string | null }).multiviewUrl).toBeNull();
  });

  it('宠物档案查询失败 → 关键帧仍照常尝试（退化为只有真实照片参考），整片不失败', async () => {
    mockedPoolQuery.mockRejectedValue(new Error('db down'));
    const result = await generateMemoirVideo({
      taskId: 'task-keyframe-dbdown',
      productLine: 'memorial',
      sourcePhotos: Array.from({ length: 8 }, (_, i) => `https://cdn/pet${i}.jpg`),
      script: makeScript(),
    });
    expect(result.engine).toBe('seedance-scripted-vlog');
    const args = mockedKeyframe.mock.calls[0][0] as { multiviewUrl: string | null; petSubject: string };
    expect(args.multiviewUrl).toBeNull();
    // 档案不可用时用中性指代兜底，不编造品种、也不出现名字
    expect(args.petSubject).toBe('照片中的这只宠物');
  });

  it('static_photo 镜头不生成关键帧（仍走 ffmpeg 静态动效，零 AI 成本）', async () => {
    const script = makeScript();
    script.segments[script.segments.length - 1] = {
      ...script.segments[script.segments.length - 1],
      source: 'static_photo',
    };
    await generateMemoirVideo({
      taskId: 'task-keyframe-static',
      productLine: 'memorial',
      sourcePhotos: Array.from({ length: 8 }, (_, i) => `https://cdn/pet${i}.jpg`),
      script,
    });
    // 8 镜里只有 7 镜是 ai_video → 关键帧也只生成 7 次
    expect(mockedKeyframe).toHaveBeenCalledTimes(7);
  });
});
