/**
 * 修复 PageBackground 被错误合并进 @tarojs/components 的问题
 *
 * 起因：unify-bg-layer.js 的导入合并正则只要求路径含 "components"，
 * 结果匹配到了排在前面的 '@tarojs/components'，生成：
 *     import PageBackground, { View, Text } from '@tarojs/components'   ← 错误
 * 正确应为：
 *     import { View, Text } from '@tarojs/components'
 *     import PageBackground from '../../components/PageBackground'
 *
 * 用法：node fix-pagebackground-import.js [--apply]
 */
const fs = require('fs');
const path = require('path');

const SRC = 'E:/星河宠记/03-源代码/小程序/miniapp/src';
const CORRECT = "import PageBackground from '../../components/PageBackground'";

// 错误形态：import PageBackground, { ... } from '@tarojs/components'
const BAD =
  /import PageBackground,\s*\{([^}]+)\}\s*from\s*'@tarojs\/components'/;

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === '__tests__' || e.name === 'node_modules') continue;
      walk(p, out);
    } else if (e.name.endsWith('.tsx')) {
      out.push(p);
    }
  }
  return out;
}

const apply = process.argv.includes('--apply');
let count = 0;

for (const f of walk(SRC)) {
  let txt = fs.readFileSync(f, 'utf8');
  if (!BAD.test(txt)) continue;

  // 1) 还原 @tarojs/components 的导入
  txt = txt.replace(BAD, (_m, names) => `import {${names}} from '@tarojs/components'`);

  // 2) 补正确的 PageBackground 导入（若尚不存在）
  if (!/^import PageBackground from/m.test(txt)) {
    const importLines = [...txt.matchAll(/^import .*$/gm)];
    const last = importLines[importLines.length - 1];
    const at = last.index + last[0].length;
    txt = txt.slice(0, at) + '\n' + CORRECT + txt.slice(at);
  }

  console.log((apply ? '修复: ' : '待修复: ') + path.relative(SRC, f));
  if (apply) {
    fs.writeFileSync(f, txt, 'utf8');
    count++;
  }
}

console.log(apply ? `\n已修复 ${count} 个文件` : '\n[dry-run] 加 --apply 执行');
