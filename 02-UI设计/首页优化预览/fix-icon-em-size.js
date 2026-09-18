/**
 * 修复 size='1em' 在小程序 <image> 上不显示的问题
 *
 * 【现象】用户截图实证：首页「快捷功能」六个宫格的图标整个不显示（左上角一片空白），
 *  而用固定 px 尺寸的图标（如 Hero 星星 size={20}）正常可见。
 *
 * 【根因】Icon 组件把 size='1em' 渲染成内联样式 width/height: 1em。
 *  微信小程序的 <image> 组件对内联样式里的 em 单位解析不可靠 → 尺寸失效、图标缩成 0。
 *  （H5 端 Chromium 支持 em，所以只在小程序端暴露。）
 *
 * 【修法】把 size='1em' 换成具体 px：优先取该 Icon 的 className 在对应 scss 里的
 *  font-size（rpx ÷ 2 得 px），取不到则用默认值。rpx→px 的 2:1 是 750rpx 设计稿在
 *  375pt 屏上的标准换算。
 *
 * 用法：node fix-icon-em-size.js [--apply]
 */
const fs = require('fs');
const path = require('path');

const SRC = 'E:/星河宠记/03-源代码/小程序/miniapp/src';
const DIRS = ['pages', 'pagesPet', 'pagesUser', 'pagesMemoir', 'components'];

/** 找不到字号时用的兜底尺寸（px） */
const FALLBACK_PX = 18;

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

/** 从 scss 取某 class 的 font-size（返回 rpx 数值） */
function findFontSizeRpx(scss, className) {
  const first = className.split(/\s+/)[0];
  const suffix = first.includes('__') ? first.slice(first.indexOf('__')) : null;
  const needles = [suffix ? `&${suffix}` : null, `.${first}`].filter(Boolean);
  for (const needle of needles) {
    const idx = scss.indexOf(needle + ' {');
    if (idx < 0) continue;
    const end = scss.indexOf('\n}', idx);
    const block = scss.slice(idx, end < 0 ? idx + 600 : end);
    const m = block.match(/font-size:\s*(\d+(?:\.\d+)?)rpx/);
    if (m) return Number(m[1]);
  }
  return null;
}

const apply = process.argv.includes('--apply');
const changes = [];
let scanned = 0;

for (const d of DIRS) {
  for (const f of walk(path.join(SRC, d))) {
    let txt = fs.readFileSync(f, 'utf8');
    if (!txt.includes("size='1em'")) continue;

    const dir = path.dirname(f);
    const scssFile = path.join(dir, 'index.scss');
    const scss = fs.existsSync(scssFile) ? fs.readFileSync(scssFile, 'utf8') : '';

    // 逐个匹配 <Icon ... size='1em' ... />
    const RE = /<Icon\b([^>]*?)\/>/gs;
    let m;
    let out = '';
    let last = 0;
    let fileChanged = 0;

    while ((m = RE.exec(txt)) !== null) {
      const attrs = m[1];
      if (!attrs.includes("size='1em'")) continue;

      const cls = (attrs.match(/className='([^']+)'/) || [])[1];
      let px = FALLBACK_PX;
      let src = 'fallback';
      if (cls && scss) {
        const rpx = findFontSizeRpx(scss, cls);
        if (rpx) {
          px = Math.round(rpx / 2);
          src = `${rpx}rpx`;
        }
      }

      const replaced = m[0].replace("size='1em'", `size={${px}}`);
      out += txt.slice(last, m.index) + replaced;
      last = m.index + m[0].length;
      fileChanged++;
      scanned++;
      changes.push({ file: path.relative(SRC, f), cls: cls || '(无 className)', px, src });
    }

    if (fileChanged > 0) {
      out += txt.slice(last);
      if (apply) fs.writeFileSync(f, out, 'utf8');
    }
  }
}

console.log(`共 ${scanned} 处 size='1em' 需要改为固定 px\n`);
const byFile = new Map();
for (const c of changes) {
  if (!byFile.has(c.file)) byFile.set(c.file, []);
  byFile.get(c.file).push(c);
}
for (const [file, list] of byFile) {
  console.log(`${file}  (${list.length} 处)`);
  for (const c of list) {
    console.log(`    ${String(c.px).padStart(3)}px  ← ${c.src}   [${c.cls}]`);
  }
}

console.log(apply ? '\n已写入' : '\n[dry-run] 加 --apply 执行');
