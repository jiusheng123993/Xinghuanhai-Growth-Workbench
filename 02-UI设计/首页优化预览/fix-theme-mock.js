/**
 * 修复测试里 useThemeClass 的 mock 缺少 useThemeKey / usePetWallpaper
 *
 * 起因：页面改用 <PageBackground /> 后，组件内部会调用 useThemeKey / usePetWallpaper，
 * 而测试把整个 hooks/useThemeClass 模块 mock 掉了却只提供 useThemeClass，
 * 于是报 `No "useThemeKey" export is defined on the ... mock`。
 *
 * 用法：node fix-theme-mock.js [--apply]
 */
const fs = require('fs');
const path = require('path');

const SRC = 'E:/星河宠记/03-源代码/小程序/miniapp/src';

// 匹配：vi.mock('...hooks/useThemeClass', () => ({ useThemeClass: vi.fn(() => '') }))
const RE = /vi\.mock\(\s*'([^']*hooks\/useThemeClass)'\s*,\s*\(\)\s*=>\s*\(\{\s*useThemeClass:\s*vi\.fn\(\(\)\s*=>\s*''\)\s*\}\s*\)\s*\)/;

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules') continue;
      walk(p, out);
    } else if (e.name.endsWith('.test.tsx') || e.name.endsWith('.test.ts')) {
      out.push(p);
    }
  }
  return out;
}

const apply = process.argv.includes('--apply');
let count = 0;

for (const f of walk(SRC)) {
  const txt = fs.readFileSync(f, 'utf8');
  const m = txt.match(RE);
  if (!m) continue;

  const replacement = [
    `vi.mock('${m[1]}', () => ({`,
    "  useThemeClass: vi.fn(() => ''),",
    "  useThemeKey: vi.fn(() => 'autumn'),",
    '  usePetWallpaper: vi.fn(() => null),',
    '}))',
  ].join('\n');

  console.log((apply ? '修复: ' : '待修复: ') + path.relative(SRC, f));
  if (apply) {
    fs.writeFileSync(f, txt.replace(RE, replacement), 'utf8');
    count++;
  }
}

console.log(apply ? `\n已修复 ${count} 个文件` : '\n[dry-run] 加 --apply 执行');
