/**
 * 统计全站 TSX 页面里被当作图标使用的 emoji 频次，
 * 用于确定新图标系统需要覆盖哪些语义。
 * 用法：node scan-emoji.js
 */
const fs = require('fs');
const path = require('path');

const SRC = 'E:/星河宠记/03-源代码/小程序/miniapp/src';
const DIRS = ['pages', 'pagesPet', 'pagesUser', 'components'];

// emoji（含变体选择符、ZWJ 组合、肤色修饰）
const EMOJI_RE = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}]/gu;

const counter = new Map();
const fileHits = new Map();
let fileCount = 0;

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
      walk(p);
    } else if (/\.(tsx|ts)$/.test(entry.name)) {
      const txt = fs.readFileSync(p, 'utf8');
      const hits = txt.match(EMOJI_RE);
      if (!hits) continue;
      fileCount++;
      const local = new Set();
      for (const h of hits) {
        if (h === '\uFE0F' || h === '\u200D') continue; // 跳过修饰符本身
        counter.set(h, (counter.get(h) || 0) + 1);
        local.add(h);
      }
      fileHits.set(path.relative(SRC, p), local.size);
    }
  }
}

for (const d of DIRS) {
  const full = path.join(SRC, d);
  if (fs.existsSync(full)) walk(full);
}

const sorted = [...counter.entries()].sort((a, b) => b[1] - a[1]);
console.log('含 emoji 的文件数: ' + fileCount);
console.log('不同 emoji 数: ' + sorted.length);
console.log('\n频次 Top 60:');
sorted.slice(0, 60).forEach(([e, n], i) => {
  console.log(String(i + 1).padStart(3) + '. ' + e + '  x' + n);
});

// 写出完整清单供后续映射
const out = sorted.map(([e, n]) => ({ emoji: e, count: n }));
fs.writeFileSync('E:/星河宠记/02-UI设计/首页优化预览/_emoji-inventory.json', JSON.stringify(out, null, 1), 'utf8');
console.log('\n完整清单已写入 _emoji-inventory.json');
