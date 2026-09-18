/**
 * 修复测试里的 components mock 缺失 Icon 导出
 *
 * 背景：页面改用 <Icon> 后，那些用 vi.mock('.../components') 把组件库整个替换掉的
 * 测试会报 `No "Icon" export is defined on the "...components" mock`。
 * 本脚本在这些 mock 的对象里补一条 Icon 定义（渲染成带 data-icon 的 span，便于断言）。
 *
 * 只处理「对应页面确实用了 <Icon」的测试，避免给无关测试塞无用 mock。
 * 用法：node fix-test-icon-mock.js [--apply]
 */
const fs = require('fs');
const path = require('path');

const SRC = 'E:/星河宠记/03-源代码/小程序/miniapp/src';
const ICON_MOCK = "  Icon: ({ name, className }: any) => <span className={className} data-icon={name} />,";

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === 'dist') continue;
      walk(p, out);
    } else if (e.name.endsWith('.test.tsx')) {
      out.push(p);
    }
  }
  return out;
}

const apply = process.argv.includes('--apply');
let fixed = 0;

for (const f of walk(SRC)) {
  const txt = fs.readFileSync(f, 'utf8');

  // 定位 components 的整体 mock（不是单独 mock 某个组件的那种）
  // 注意必须以 . 开头（相对路径）—— @tarojs/components 同样以 components 结尾，必须排除，
  // 否则会把 UI 框架的 mock 误判成组件库 mock
  const m = txt.match(/vi\.mock\(\s*['"](\.[^'"]*\/components)['"]\s*,\s*\(\)\s*=>\s*\(\{/);
  if (!m) continue;

  const blockStart = m.index + m[0].length;
  const blockEnd = txt.indexOf('\n}))', blockStart);
  if (blockEnd < 0) continue;

  const block = txt.slice(blockStart, blockEnd);
  if (/\bIcon\b/.test(block)) continue; // 已有 Icon mock

  // 对应页面是否真的用了 Icon
  const pageFile = path.join(path.dirname(path.dirname(f)), 'index.tsx');
  if (!fs.existsSync(pageFile)) continue;
  if (!/<Icon\b/.test(fs.readFileSync(pageFile, 'utf8'))) continue;

  console.log((apply ? '修复: ' : '待修复: ') + path.relative(SRC, f));
  if (apply) {
    fs.writeFileSync(f, txt.slice(0, blockStart) + '\n' + ICON_MOCK + txt.slice(blockStart), 'utf8');
    fixed++;
  }
}

console.log(apply ? '\n已修复 ' + fixed + ' 个测试文件' : '\n[dry-run] 加 --apply 执行');
