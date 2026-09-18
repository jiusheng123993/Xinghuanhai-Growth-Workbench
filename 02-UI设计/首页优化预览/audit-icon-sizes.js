/**
 * 图标尺寸体检
 *
 * 背景：用户反馈 Hero 的星星「看不见」——根因是我设了 size={12}（≈24rpx），
 * 在同色系暖背景上几乎分辨不出。这暴露一个系统性风险：我在看不到真实渲染的前提下
 * 设的「固定像素尺寸」可能普遍偏小。
 *
 * 本脚本统计所有 <Icon size={N}> 的取值分布，把偏小的挑出来供复核。
 * 注：size='1em' 的图标继承父容器字号，不在排查范围（那是安全的做法）。
 *
 * 用法：node audit-icon-sizes.js
 */
const fs = require('fs');
const path = require('path');

const SRC = 'E:/星河宠记/03-源代码/小程序/miniapp/src';
const DIRS = ['pages', 'pagesPet', 'pagesUser', 'pagesMemoir', 'components'];

/** 小于该值的固定尺寸视为「可能偏小」，需要人工复核 */
const SMALL_THRESHOLD = 14;

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === '__tests__') continue;
      walk(p, out);
    } else if (e.name.endsWith('.tsx')) {
      out.push(p);
    }
  }
  return out;
}

// 匹配 <Icon ... size={14} ... /> 或 size={14}
const RE_SIZE = /<Icon\b[^>]*?size=\{(\d+)\}[^>]*?\/>/g;

const dist = new Map();
const small = [];

for (const d of DIRS) {
  for (const f of walk(path.join(SRC, d))) {
    const txt = fs.readFileSync(f, 'utf8');
    let m;
    RE_SIZE.lastIndex = 0;
    while ((m = RE_SIZE.exec(txt)) !== null) {
      const n = Number(m[1]);
      dist.set(n, (dist.get(n) || 0) + 1);
      if (n < SMALL_THRESHOLD) {
        const line = txt.slice(0, m.index).split('\n').length;
        // 取该行内容做上下文提示
        const lineText = txt.split('\n')[line - 1].trim().slice(0, 80);
        small.push({ file: path.relative(SRC, f), line, size: n, text: lineText });
      }
    }
  }
}

console.log('==== 固定尺寸分布（size={N}）====');
for (const [n, c] of [...dist.entries()].sort((a, b) => a[0] - b[0])) {
  console.log(`  ${String(n).padStart(3)}px  ×${c}${n < SMALL_THRESHOLD ? '   ← 偏小' : ''}`);
}
const total = [...dist.values()].reduce((a, b) => a + b, 0);
console.log(`  合计 ${total} 处固定尺寸`);

console.log(`\n==== 疑似偏小（< ${SMALL_THRESHOLD}px）共 ${small.length} 处 ====`);
for (const s of small) {
  console.log(`  ${s.size}px  ${s.file}:${s.line}`);
  console.log(`        ${s.text}`);
}
