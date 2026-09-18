/**
 * 修复 Icon 导入顺序
 *
 * 背景：批量替换脚本早期版本会把 `import { Icon } from '../../components'`
 * 插在第一个 import 之后，若该文件还有其他绝对导入（@tarojs / react / zustand），
 * 就会出现「相对导入排在绝对导入前面」→ eslint import/first 报错。
 *
 * 本脚本把这类插错位置的 Icon 导入统一挪到 import 区块末尾。
 *
 * 用法：node fix-icon-import-order.js [--apply]
 */
const fs = require('fs');
const path = require('path');

const SRC = 'E:/星河宠记/03-源代码/小程序/miniapp/src';
const ICON_IMPORT = "import { Icon } from '../../components'";

function collectFiles(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === '__tests__' || e.name === 'node_modules') continue;
      collectFiles(p, out);
    } else if (e.name === 'index.tsx') {
      out.push(p);
    }
  }
  return out;
}

/** 返回修好的内容；无需修复则返回 null */
function fix(txt) {
  const lines = txt.split('\n');
  const idx = lines.findIndex((l) => l.trim() === ICON_IMPORT);
  if (idx < 0) return null;

  // 该行之后是否还跟着 import 行？跟了说明它没在 import 块末尾
  const after = lines.slice(idx + 1);
  const nextImportIdx = after.findIndex((l) => /^import\s/.test(l));
  if (nextImportIdx < 0) return null; // 已在末尾，无需处理

  // 找到 import 区块的最后一行
  let lastImport = idx;
  for (let i = idx + 1; i < lines.length; i++) {
    if (/^import\s/.test(lines[i]) || /^\s+[^*/]/.test(lines[i])) {
      // import 的多行续行也计入
      if (/^import\s/.test(lines[i])) lastImport = i;
    } else if (lines[i].trim() === '') {
      continue;
    } else {
      break;
    }
  }
  if (lastImport === idx) return null;

  const removed = lines.filter((_, i) => i !== idx);
  // 删除后目标位置索引前移
  const target = lastImport > idx ? lastImport - 1 : lastImport;
  removed.splice(target + 1, 0, ICON_IMPORT);
  return removed.join('\n');
}

const apply = process.argv.includes('--apply');
const files = collectFiles(SRC);
let fixed = 0;

for (const f of files) {
  const txt = fs.readFileSync(f, 'utf8');
  if (!txt.includes(ICON_IMPORT)) continue;
  const out = fix(txt);
  if (!out) continue;
  console.log('需修复: ' + path.relative(SRC, f));
  if (apply) {
    fs.writeFileSync(f, out, 'utf8');
    fixed++;
  }
}

console.log(apply ? '\n已修复 ' + fixed + ' 个文件' : '\n[dry-run] 加 --apply 执行');
