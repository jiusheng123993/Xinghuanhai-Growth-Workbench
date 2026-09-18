/**
 * 从 Phosphor Fill 官方 SVG 生成项目的面性图标数据文件
 * 输出：src/components/icons-fill.ts（自动生成，勿手工编辑）
 * 用法：node gen-icons-fill.js
 */
const fs = require('fs');
const path = require('path');

const SRC_DIR = 'E:/星河宠记/02-UI设计/首页优化预览/icons-fill-ph/';
const OUT = 'E:/星河宠记/03-源代码/小程序/miniapp/src/components/icons-fill.ts';

const files = fs.readdirSync(SRC_DIR).filter((f) => f.endsWith('.svg')).sort();

const entries = [];
for (const f of files) {
  const name = f.replace(/\.svg$/, '');
  let svg = fs.readFileSync(SRC_DIR + f, 'utf8');
  // 只取 <svg> 内部内容（path 等），外层 svg 由组件统一生成
  const inner = svg
    .replace(/^[\s\S]*?<svg[^>]*>/, '')
    .replace(/<\/svg>\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!inner || !inner.includes('<path')) {
    console.log('SKIP(no path): ' + name);
    continue;
  }
  entries.push([name, inner]);
}

const body = entries
  .map(([n, p]) => "  '" + n + "': '" + p.replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "',")
  .join('\n');

const ts = `/**
 * 面性图标路径数据（Phosphor Icons Fill · MIT 开源）
 *
 * 【本文件由脚本自动生成，请勿手工编辑】
 * 生成脚本：02-UI设计/首页优化预览/gen-icons-fill.js
 * 来源：https://unpkg.com/@phosphor-icons/core@latest/assets/fill/<name>-fill.svg
 *
 * 与 Icon.tsx 的分工：
 *  - 本文件只存图标内部 path 数据，viewBox 固定 0 0 256 256，属实心填充（fill）风格
 *  - 颜色不做进数据，由 Icon.tsx 在生成 SVG data URI 时注入
 */
export const FILL_ICON_PATHS = {
${body}
} as const

/** 可用的面性图标名 */
export type FillIconName = keyof typeof FILL_ICON_PATHS
`;

fs.writeFileSync(OUT, ts, 'utf8');
console.log('共写入 ' + entries.length + ' 个面性图标');
console.log('输出：' + OUT);
console.log('文件大小：' + fs.statSync(OUT).size + ' bytes');
