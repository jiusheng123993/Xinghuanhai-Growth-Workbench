/**
 * /uploads 静态资源的跨域资源策略（CORP）中间件
 *
 * 背景（2026-09-10 修复「头像保存成功但不显示」的根因）：
 * `app.use(helmet())` 默认给所有响应打 `Cross-Origin-Resource-Policy: same-origin`，
 * 该头会阻止【跨域文档】以 <img>/<video>/<audio> 方式加载本站资源。而本站上传物的
 * 真实消费方几乎都是跨域来源：
 *   ① 微信小程序开发者工具 / 真机 webview（Chromium 内核，来源≠api.xinghuanhai.com）
 *   ② App（Capacitor webview）、官网与 H5 页面
 * 结果是：`wx.request` 走原生请求不受 CORP 约束（接口全正常），但所有 /uploads 图片
 * 一律加载失败——用户表现为「头像设置/保存完不显示」。
 *
 * 实测证据（同一 Chromium、同一测试页、唯一变量为 CORP 头）：
 *   https://api.xinghuanhai.com/uploads/.../cat-03-cow.png（经 Express，带 CORP）→ ERROR
 *   https://api.xinghuanhai.com/assets/hero-pet-grass.jpg（同域 nginx 直出，无 CORP）→ LOADED
 *
 * 安全性：上传物本就是面向用户公开的资源（URL 含随机 uuid，非鉴权凭据），
 * 放开 CORP 不泄露额外信息；本中间件只作用于 /uploads 挂载点，其余接口仍保留
 * helmet 的 same-origin 默认策略。
 */
import type { Request, Response, NextFunction } from 'express';

/**
 * 允许跨域文档嵌入 /uploads 下的资源
 * 必须在 helmet() 之后、express.static 之前挂载（setHeader 覆盖 helmet 写入的同名头）
 * @param _req - Express 请求（不参与判断）
 * @param res - Express 响应（写入 CORP 头）
 * @param next - 交给下一个中间件（静态文件服务）
 */
export function allowCrossOriginUploads(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  next();
}

export default allowCrossOriginUploads;
