/**
 * 修复 PageBackground 错误写法：「default + 具名」混用
 *
 * components/index.ts 里 PageBackground 是【具名导出】
 * （export { default as PageBackground } from './PageBackground'），
 * 并没有 default export，所以下面这种写法会报 TS2613：
 *     import PageBackground, { Icon } from '../../components'     ← 错
 * 正确写法：
 *     import { PageBackground, Icon } from '../../components'
 *
 * 用法：node fix-pagebackground-named-import.js [--apply]
 */
const fs = require('fs');
const path = require('path');

const SRC = 'E:/星河宠记/03-源代码/小程序/miniapp/src';

// 匹配：import PageBackground, { ... } from '<相对路径>'
const BAD = /import PageBackground,\s*\{([^}]+)\}\s*from\s*'(\.[^']*)'/;

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === '__tests__' || e.name === 'node_modules') continue;
      walk(p, out);
    } else if (e.name.endsWith('.tsx') || e.name.endsWith('.ts')) {
      out.push(p);
    }
  }
  return out;
}

const apply = process.argv.includes('--apply');
let count = 0;

for (const f of walk(SRC)) {
  const txt = fs.readFileSync(f, 'utf8');
  if (!BAD.test(txt)) continue;

  const fixed = txt.replace(BAD, (_m, names, from) => `import { PageBackground,${names} } from '${from}'`);
  const label = path.relative(SRC, f);
  console.log((apply ? '修复: ' : '待修复: ') + label);
  if (apply) {
    fs.writeFileSync(f, fixed, 'utf8');
    count++;
  }
}

console.log(apply ? `\n已修复 ${count} 个文件` : '\n[dry-run] 加 --apply 执行');
