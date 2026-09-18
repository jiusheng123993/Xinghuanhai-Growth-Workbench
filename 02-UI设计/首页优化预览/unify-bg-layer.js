/**
 * 把各页面手写的背景层（.xhh-bg-layer + 4 个 .xhh-blob）替换为统一的 <PageBackground /> 组件
 *
 * 背景：全站 17 个页面各自复制了同一段 5 行背景结构。用户切换「页面背景」时，
 * 这些手写结构不会响应（它们只认主题变量、不认星空/格纹/照片壁纸），
 * 导致背景自定义功能选了没效果。统一走组件后，6 套预设背景与宠物照片壁纸才会真正生效。
 *
 * 用法：node unify-bg-layer.js [--apply]
 */
const fs = require('fs');
const path = require('path');

const SRC = 'E:/星河宠记/03-源代码/小程序/miniapp/src';
const IMPORT_LINE = "import PageBackground from '../../components/PageBackground'";

// 匹配：<View className='xhh-bg-layer'> + 若干装饰层（blob / bg-glow）+ </View>
// 注：部分页面的背景层里多一层 <View className='xhh-bg-glow' />，故装饰层用 (blob|bg-glow) 兼容
const RE_BG_LAYER =
  /([ \t]*)<View className='xhh-bg-layer'>\s*\n(?:[ \t]*<View className='xhh-(?:blob[^']*|bg-glow)' \/>\s*\n)+[ \t]*<\/View>/;

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

/** 补 PageBackground 导入（优先并入已有的 components 具名导入，否则插到 import 区末尾） */
function ensureImport(txt) {
  if (/import\s+PageBackground\b/.test(txt)) return txt;
  const named = txt.match(/import\s*\{([^}]+)\}\s*from\s*'([^']*components)'/);
  if (named) {
    // 合并为 default + named 的合法写法：import PageBackground, { X, Y } from '../../components'
    return txt.replace(named[0], `import PageBackground, {${named[1]}} from '${named[2]}'`);
  }
  const importLines = [...txt.matchAll(/^import .*$/gm)];
  if (!importLines.length) return txt;
  const last = importLines[importLines.length - 1];
  const at = last.index + last[0].length;
  return txt.slice(0, at) + '\n' + IMPORT_LINE + txt.slice(at);
}

const apply = process.argv.includes('--apply');
let count = 0;

for (const f of walk(SRC)) {
  const txt = fs.readFileSync(f, 'utf8');
  if (!RE_BG_LAYER.test(txt)) continue;

  const indent = txt.match(RE_BG_LAYER)[1];
  let next = txt.replace(RE_BG_LAYER, `${indent}<PageBackground />`);
  next = ensureImport(next);

  console.log((apply ? '替换: ' : '待替换: ') + path.relative(SRC, f));
  if (apply) {
    fs.writeFileSync(f, next, 'utf8');
    count++;
  }
}

console.log(apply ? `\n已处理 ${count} 个文件` : '\n[dry-run] 加 --apply 执行');
