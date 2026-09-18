/**
 * 全站页面视觉接入盘点
 *
 * 目的：确认 44+ 个页面里，哪些已经换装面性图标、哪些已接入统一背景层，
 * 哪些还没动过 —— 避免「以为全铺完了其实漏了几个页面」。
 *
 * 用法：node audit-page-coverage.js
 */
const fs = require('fs');
const path = require('path');

const SRC = 'E:/星河宠记/03-源代码/小程序/miniapp/src';
const DIRS = ['pages', 'pagesPet', 'pagesUser', 'pagesMemoir'];

const EMOJI_RE = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}]/gu;

function count(re, txt) {
  const m = txt.match(re);
  return m ? m.length : 0;
}

const rows = [];
for (const d of DIRS) {
  const dir = path.join(SRC, d);
  if (!fs.existsSync(dir)) continue;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    const tsx = path.join(dir, e.name, 'index.tsx');
    if (!fs.existsSync(tsx)) continue;
    const t = fs.readFileSync(tsx, 'utf8');
    rows.push({
      page: `${d}/${e.name}`,
      icon: count(/<Icon\s/g, t),
      bg: count(/<PageBackground/g, t),
      emoji: count(EMOJI_RE, t),
    });
  }
}

rows.sort((a, b) => b.icon - a.icon);

console.log('==== 已接入面性图标（' + rows.filter((r) => r.icon > 0).length + ' 个页面）====');
console.log('page'.padEnd(30) + 'Icon  Bg  Emoji');
for (const r of rows.filter((r) => r.icon > 0)) {
  console.log(r.page.padEnd(30) + String(r.icon).padEnd(6) + String(r.bg).padEnd(4) + r.emoji);
}

console.log('\n==== 未接入图标 或 未接背景（待办）====');
console.log('page'.padEnd(30) + 'Icon  Bg  Emoji');
for (const r of rows.filter((x) => x.icon === 0 || x.bg === 0)) {
  console.log(r.page.padEnd(30) + String(r.icon).padEnd(6) + String(r.bg).padEnd(4) + r.emoji);
}

console.log('\n总页面数: ' + rows.length);
console.log('已换图标: ' + rows.filter((r) => r.icon > 0).length);
console.log('已接背景: ' + rows.filter((r) => r.bg > 0).length);
console.log('仍有 emoji: ' + rows.filter((r) => r.emoji > 0).length);
