/**
 * 图标配色体检：语义色 vs 容器背景的对比度
 *
 * 背景：Hero 星星「看不见」有两个原因 —— 一是尺寸太小（已另修），
 * 二是 **主色图标压在同色系暖背景上**（珊瑚橙 on 珊瑚橙 tint），对比度极低。
 * 这个坑在批量替换的 175 处图标里同样可能存在。
 *
 * 检查规则（只看能静态判定的明显冲突）：
 *   tone='primary' + 容器背景含 primary/coral 系  → 同色系叠加，偏淡
 *   tone='white'   + 容器背景是浅色（非深色/tint 深） → 白压白
 *   tone='ink'     + 容器背景是深色                  → 深压深
 *
 * 用法：node audit-icon-color.js
 */
const fs = require('fs');
const path = require('path');

const SRC = 'E:/星河宠记/03-源代码/小程序/miniapp/src';
const DIRS = ['pages', 'pagesPet', 'pagesUser', 'pagesMemoir', 'components'];

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

/** 从 scss 里取某个 class 的背景声明（支持 BEM 后缀写法 &__xxx） */
function findBg(scss, className) {
  const first = className.split(/\s+/)[0];
  const suffix = first.includes('__') ? first.slice(first.indexOf('__')) : null;
  const needles = [suffix ? `&${suffix}` : null, `.${first}`].filter(Boolean);
  for (const needle of needles) {
    const idx = scss.indexOf(needle + ' {');
    if (idx < 0) continue;
    const end = scss.indexOf('\n}', idx);
    const block = scss.slice(idx, end < 0 ? idx + 600 : end);
    const m = block.match(/background(-color)?:\s*([^;]+);/);
    if (m) return m[2].trim();
  }
  return null;
}

/** 判断背景属于哪一类 */
function bgKind(bg) {
  if (!bg) return 'unknown';
  const b = bg.toLowerCase();
  // 同色系暖 tint（primary/coral/gold 的浅底）
  if (/\$color-primary|\$color-coral|255,\s*107,\s*61|#ff6b3d/.test(b)) return 'primaryTint';
  if (/\$color-gold|255,\s*176,\s*32|#ffb020|#e8920a/.test(b)) return 'goldTint';
  // 深色实底
  if (/#[0-3][0-9a-f]{5}|#1[0-9a-f]{5}|rgba\(0,\s*0,\s*0/.test(b)) return 'darkSolid';
  // 透明 / 无
  if (/transparent|none/.test(b)) return 'transparent';
  return 'other';
}

const RE_ICON = /<Icon\b([^>]*?)\/>/gs;
const problems = [];
let scanned = 0;

for (const d of DIRS) {
  for (const f of walk(path.join(SRC, d))) {
    const txt = fs.readFileSync(f, 'utf8');
    const dir = path.dirname(f);
    const scssFile = path.join(dir, 'index.scss');
    const scss = fs.existsSync(scssFile) ? fs.readFileSync(scssFile, 'utf8') : '';

    let m;
    RE_ICON.lastIndex = 0;
    while ((m = RE_ICON.exec(txt)) !== null) {
      const attrs = m[1];
      const tone = (attrs.match(/tone='(\w+)'/) || [])[1];
      const cls = (attrs.match(/className='([^']+)'/) || [])[1];
      if (!tone || !cls || !scss) continue;
      scanned++;

      const bg = findBg(scss, cls);
      const kind = bgKind(bg);
      const line = txt.slice(0, m.index).split('\n').length;

      let issue = null;
      if (tone === 'primary' && kind === 'primaryTint') issue = '主色图标 + 主色系浅底（同色叠加，偏淡）';
      else if (tone === 'white' && (kind === 'primaryTint' || kind === 'goldTint')) issue = '白图标 + 浅色底（实测通常尚可，复核）';
      else if (tone === 'ink' && kind === 'darkSolid') issue = '深色图标 + 深色底';

      if (issue) {
        problems.push({ file: path.relative(SRC, f), line, tone, cls, bg, kind, issue });
      }
    }
  }
}

console.log(`已扫描 ${scanned} 处「带 tone + className」的图标\n`);
console.log(`==== 疑似配色冲突 ${problems.length} 处 ====`);
for (const p of problems) {
  console.log(`  ${p.file}:${p.line}`);
  console.log(`     tone=${p.tone}  class="${p.cls}"`);
  console.log(`     背景: ${p.bg}  → ${p.issue}\n`);
}
