/**
 * 修复 Icon 导入位置（v2）
 *
 * v1 的问题：用「跳过空行/注释行」的方式找 import 末尾，遇到**多行 import**
 * （import {\n  a,\n  b,\n} from '...'）时会把续行当成可跳过，导致 Icon 被插进
 * 语句中间，直接把文件写成语法错误。
 *
 * v2 改为按「语句」而不是「行」来识别 import 区块：
 * 逐行扫描并跟踪是否处于跨行 import 中，只有遇到 `from '...'` 才算该语句结束。
 *
 * 做法：先删掉所有独立的 Icon import 行，再统一插到 import 区块末尾。
 * 用法：node fix-icon-import-v2.js [--apply]
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

const RE_FROM_END = /from\s+['"][^'"]+['"]\s*;?\s*$/;
const RE_SIDE_EFFECT = /^import\s+['"][^'"]+['"]\s*;?\s*$/;

/** 返回 import 区块最后一行的下标；-1 表示没找到 */
function findImportBlockEnd(lines) {
  let lastEnd = -1;
  let inMulti = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (inMulti) {
      // 跨行 import 里，出现 from '...' 才算结束
      if (RE_FROM_END.test(line)) {
        inMulti = false;
        lastEnd = i;
      }
      continue;
    }

    if (/^import\b/.test(line)) {
      if (RE_FROM_END.test(line) || RE_SIDE_EFFECT.test(line)) {
        lastEnd = i;
      } else {
        inMulti = true; // import { ... 跨行，等 from
      }
      continue;
    }

    // 非 import 行：空行/注释可以继续，其余视为区块结束
    const t = line.trim();
    if (t === '' || t.startsWith('//') || t.startsWith('/*') || t.startsWith('*')) continue;
    break;
  }
  return lastEnd;
}

const apply = process.argv.includes('--apply');
let count = 0;

for (const f of collectFiles(SRC)) {
  const txt = fs.readFileSync(f, 'utf8');
  if (!txt.includes(ICON_IMPORT)) continue;

  const lines = txt.split('\n');
  const without = lines.filter((l) => l.trim() !== ICON_IMPORT);
  if (without.length === lines.length) continue;

  const end = findImportBlockEnd(without);
  if (end < 0) {
    console.log('跳过（找不到 import 区块）: ' + path.relative(SRC, f));
    continue;
  }

  const result = [...without.slice(0, end + 1), ICON_IMPORT, ...without.slice(end + 1)].join('\n');
  if (result === txt) {
    console.log('已正确: ' + path.relative(SRC, f));
    continue;
  }

  console.log('修复: ' + path.relative(SRC, f) + '  → Icon 导入置于第 ' + (end + 2) + ' 行');
  if (apply) {
    fs.writeFileSync(f, result, 'utf8');
    count++;
  }
}

console.log(apply ? '\n已处理 ' + count + ' 个文件' : '\n[dry-run] 加 --apply 执行');
