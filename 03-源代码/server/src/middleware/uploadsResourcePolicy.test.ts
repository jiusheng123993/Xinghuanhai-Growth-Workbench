/**
 * /uploads CORP 中间件测试
 *
 * 回归背景（2026-09-10）：helmet() 默认的 Cross-Origin-Resource-Policy: same-origin
 * 会让小程序（Chromium webview）等跨域来源无法加载 /uploads 图片，
 * 表现为「头像保存成功但不显示」——本中间件负责把该挂载点的策略改回 cross-origin。
 */
import { describe, it, expect, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { allowCrossOriginUploads } from './uploadsResourcePolicy.js';

/** 构造最小 Response 替身，只关心 setHeader */
function makeRes() {
  const headers: Record<string, string> = {};
  const res = {
    setHeader: (key: string, value: string) => {
      headers[key] = value;
    },
  } as unknown as Response;
  return { res, headers };
}

describe('allowCrossOriginUploads', () => {
  it('把 CORP 头覆盖为 cross-origin', () => {
    const { res, headers } = makeRes();
    const next = vi.fn() as unknown as NextFunction;

    allowCrossOriginUploads({} as Request, res, next);

    expect(headers['Cross-Origin-Resource-Policy']).toBe('cross-origin');
  });

  it('必须调用 next 让请求继续走到静态文件服务', () => {
    const { res } = makeRes();
    const next = vi.fn() as unknown as NextFunction;

    allowCrossOriginUploads({} as Request, res, next);

    expect(next).toHaveBeenCalledTimes(1);
  });
});
