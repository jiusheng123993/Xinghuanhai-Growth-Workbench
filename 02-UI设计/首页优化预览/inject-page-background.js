/**
 * 给尚未接入统一背景层的页面注入 <PageBackground />
 *
 * 这批页面（add / creative / profile / avatar-customize …）原本没有 .xhh-bg-layer，
 * 背景只靠根容器的 `background: $gradient-page`，因此切背景时它们不会响应。
 *
 * 做法：
 *   1. 在根容器（return 后的第一个 JSX 开标签）内部插入 <PageBackground />
 *   2. 补 PageBackground 导入（只用相对路径，避免误匹配 @tarojs/components）
 *   3. 根容器 scss 的背景声明改为 transparent
 *
 * 用法：node inject-page-background.js [--apply]
 */
const fs = require('fs');
const path = require('path');

const SRC = 'E:/星河宠记/03-源代码/小程序/miniapp/src';
const PAGES = [
  // 第二批：回忆录分包（第一批 15 个页面已接入，见 git 历史）
  'pagesMemoir/memoir-center', 'pagesMemoir/memoir-daily',
  'pagesMemoir/memoir-full', 'pagesMemoir/memoir-vlog', 'pagesMemoir/studio',
];
const REL_COMPONENTS = '../../components';

/** 补 PageBackground 导入（只认相对路径的 components 具名导入，避免匹配 @tarojs/components） */
function ensureImport(txt) {
  if (/^import PageBackground from/m.test(txt)) return txt;
  if (/\bPageBackground\b/.test(txt) && /import\s*\{[^}]*\bPageBackground\b[^}]*\}/.test(txt)) return txt;

  // ⚠️ components/index.ts 里 PageBackground 是【具名导出】，没有 default export，
  //    所以必须并入具名导入写成 import { PageBackground, X }，不能写 import PageBackground, { X }（TS2613）
  const named = txt.match(/import\s*\{([^}]+)\}\s*from\s*'(\.[^']*\/components)'/);
  if (named) {
    if (/\bPageBackground\b/.test(named[1])) return txt;
    return txt.replace(named[0], `import { PageBackground,${named[1]} } from '${named[2]}'`);
  }
  const importLines = [...txt.matchAll(/^import .*$/gm)];
  if (!importLines.length) return txt;
  const last = importLines[importLines.length - 1];
  const at = last.index + last[0].length;
  return txt.slice(0, at) + `\nimport PageBackground from '${REL_COMPONENTS}/PageBackground'` + txt.slice(at);
}

/** 在根容器开标签之后插入 <PageBackground /> */
function injectBackground(txt) {
  if (/<PageBackground/.test(txt)) return txt;

  // 找 return ( 之后的第一个 JSX 开标签（根容器）
  const retIdx = txt.search(/return\s*\(/);
  if (retIdx < 0) return txt;

  const after = txt.slice(retIdx);
  // ⚠️ 属性部分必须用 [^>\n]*（不能 [^>]*）：
  //    [^>] 会匹配换行符，导致从某个 <View 一路吞到很远的 '>' 才收尾，
  //    结果把 <PageBackground /> 插进 <Text> 标签内部、破坏 JSX（2026-09-10 踩过）
  const m = after.match(/\n([ \t]*)<(View|ScrollView|PageContainer)\b[^>\n]*>/);
  if (!m) return txt;

  const indent = m[1];
  const insertAt = retIdx + m.index + m[0].length;
  return txt.slice(0, insertAt) + `\n${indent}  <PageBackground />` + txt.slice(insertAt);
}

/** 根容器 scss 背景改透明 */
function transparentRoot(scss) {
  const patterns = [
    'background: $gradient-page;',
    'background: $color-bg-page;',
  ];
  for (const p of patterns) {
    const i = scss.indexOf(p);
    if (i >= 0) {
      return (
        scss.slice(0, i) +
        '/* 背景由 <PageBackground /> 组件统一渲染，此处保持透明 */\n  background: transparent;' +
        scss.slice(i + p.length)
      );
    }
  }
  return null;
}

const apply = process.argv.includes('--apply');
let ok = 0;

for (const p of PAGES) {
  const tsx = path.join(SRC, p, 'index.tsx');
  const scss = path.join(SRC, p, 'index.scss');
  if (!fs.existsSync(tsx)) {
    console.log('跳过（无 tsx）: ' + p);
    continue;
  }

  let t = fs.readFileSync(tsx, 'utf8');
  const before = t;
  t = injectBackground(t);
  if (t === before) {
    console.log('跳过（未找到根容器或已接入）: ' + p);
    continue;
  }
  t = ensureImport(t);

  let s = null;
  if (fs.existsSync(scss)) {
    const raw = fs.readFileSync(scss, 'utf8');
    s = transparentRoot(raw);
  }

  console.log((apply ? '注入: ' : '待注入: ') + p + (s ? '  (+根容器透明)' : '  (scss 无匹配背景，跳过)'));
  if (apply) {
    fs.writeFileSync(tsx, t, 'utf8');
    if (s) fs.writeFileSync(scss, s, 'utf8');
    ok++;
  }
}

console.log(apply ? `\n已处理 ${ok} 个页面` : '\n[dry-run] 加 --apply 执行');
