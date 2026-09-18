/**
 * emoji 图标位批量替换（半自动，带 dry-run）
 *
 * 【只做最安全的一类替换】emoji 独占一个 <Text> 的明确图标位，例如：
 *     <Text className='pet-vaccine__empty-icon'>🐾</Text>
 *     →  <Icon name='paw-print' size='1em' tone='muted' className='pet-vaccine__empty-icon' />
 *
 * 【不碰的】：
 *   · 文案句子里的 emoji（如 `🔔 {date} · 提前7天提醒`）—— 属于语气，保留
 *   · emoji 后面还跟着文字的（如 `📋 待处理事项`）—— 需要拆 Icon + Text，涉及布局，交人工
 *   · 不在映射表里的 emoji（装饰/情绪类）
 *
 * 尺寸统一用 '1em'：原样式的 font-size 直接生效，不必逐处调尺寸。
 * 颜色从同名 scss 规则的 color 推断，映射到语义色 tone（或具体色值）。
 *
 * 用法：
 *   node migrate-emoji-icons.js <页面目录或文件>            # dry-run，只打印建议
 *   node migrate-emoji-icons.js <页面目录或文件> --apply    # 实际写入
 */
const fs = require('fs');
const path = require('path');

const MAP_TS = 'E:/星河宠记/03-源代码/小程序/miniapp/src/components/emojiIconMap.ts';

/**
 * 从 emojiIconMap.ts 解析出映射表
 * 直接读项目里那份唯一事实源，避免同一份数据两处维护、迟早不一致
 */
function loadEmojiMap() {
  const ts = fs.readFileSync(MAP_TS, 'utf8');
  const start = ts.indexOf('EMOJI_TO_ICON');
  const body = ts.slice(start, ts.indexOf('\n}', start));
  const map = {};
  const re = /'([^']+)':\s*'([^']+)'/g;
  let m;
  while ((m = re.exec(body)) !== null) map[m[1]] = m[2];
  return map;
}

const EMOJI_TO_ICON = loadEmojiMap();

// scss 颜色变量 → Icon 的语义色/具体色
const COLOR_TO_PROP = [
  [/\$color-primary\b/, "tone='primary'"],
  [/\$color-text-inverse\b/, "tone='white'"],
  [/\$color-text-primary\b/, "tone='ink'"],
  [/\$color-text-(secondary|tertiary|hint|placeholder)\b/, "tone='muted'"],
  [/\$color-gold-deep\b/, "color='#E8920A'"],
  [/\$color-gold\b/, "color='#E8A81C'"],
  [/\$color-success\b/, "color='#2FC98E'"],
  [/\$color-danger\b/, "color='#FF5A5F'"],
  [/\$color-teal\b/, "color='#4FA3E3'"],
];

/** 从 scss 文本里查某个 class 的 color（支持 BEM 后缀写法 &__xxx） */
function findColor(scss, className) {
  // 取类名最后一段作为 BEM 后缀（pet-vaccine__empty-icon → __empty-icon）
  const suffix = className.includes('__') ? className.slice(className.indexOf('__')) : null;
  const needles = [`&${suffix}`, `.${className}`].filter(Boolean);
  for (const needle of needles) {
    const idx = scss.indexOf(needle + ' {');
    if (idx < 0) continue;
    // 取该规则块（到下一个顶层 } 为止）
    const block = scss.slice(idx, scss.indexOf('\n}', idx) + 2);
    const m = block.match(/color:\s*([^;]+);/);
    if (m) return m[1].trim();
  }
  return null;
}

/** 把 scss color 值映射成 Icon 的颜色属性 */
function colorToProp(colorValue) {
  if (!colorValue) return "tone='primary'";
  for (const [re, prop] of COLOR_TO_PROP) {
    if (re.test(colorValue)) return prop;
  }
  // 写死的十六进制色值直接透传
  const hex = colorValue.match(/#[0-9a-fA-F]{3,8}/);
  if (hex) return `color='${hex[0]}'`;
  return "tone='primary'";
}

/**
 * 确保文件里导入了 Icon 组件
 * 优先并入已有的 `import { ... } from '../../components'`；
 * 没有该行时插到 **整个 import 区块的末尾** —— 不能插在第一个 import 之后，
 * 否则相对导入会排到 @tarojs / react 等绝对导入前面，触发 eslint import/first
 */
function ensureIconImport(txt) {
  const re = /import\s*\{([^}]+)\}\s*from\s*'\.\.\/\.\.\/components'/;
  const m = txt.match(re);
  if (m) {
    if (/\bIcon\b/.test(m[1])) return txt; // 已导入
    return txt.replace(re, (_full, names) => `import {${names.trimEnd()}, Icon } from '../../components'`);
  }
  const importLines = [...txt.matchAll(/^import .*$/gm)];
  if (!importLines.length) return txt;
  const last = importLines[importLines.length - 1];
  const insertAt = last.index + last[0].length;
  return txt.slice(0, insertAt) + "\nimport { Icon } from '../../components'" + txt.slice(insertAt);
}

// emoji 独占一个 Text：<Text className='X'>EMOJI</Text>（emoji 可带变体选择符）
const RE_SOLO = /<Text(\s+className='([^']+)')?\s*>\s*([\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}]\u{FE0F}?)\s*<\/Text>/gu;

function collectTargets(file) {
  const txt = fs.readFileSync(file, 'utf8');
  const dir = path.dirname(file);
  const scssFile = path.join(dir, 'index.scss');
  const scss = fs.existsSync(scssFile) ? fs.readFileSync(scssFile, 'utf8') : '';

  const hits = [];
  let m;
  RE_SOLO.lastIndex = 0;
  while ((m = RE_SOLO.exec(txt)) !== null) {
    const [raw, , className, emoji] = m;
    const icon = EMOJI_TO_ICON[emoji.replace(/\uFE0F/g, '')];
    if (!icon) continue; // 未收录（装饰类）→ 保留

    let colorProp = "tone='primary'";
    if (className) {
      const cv = findColor(scss, className);
      colorProp = colorToProp(cv);
    }

    const replacement = className
      ? `<Icon name='${icon}' size='1em' ${colorProp} className='${className}' />`
      : `<Icon name='${icon}' size='1em' ${colorProp} />`;

    hits.push({ raw, replacement, emoji, icon, className });
  }
  return { txt, hits, scssFile };
}

function migrate(target, apply) {
  const files = [];
  if (fs.statSync(target).isDirectory()) {
    const p = path.join(target, 'index.tsx');
    if (fs.existsSync(p)) files.push(p);
  } else {
    files.push(target);
  }

  let totalChanged = 0;
  for (const file of files) {
    const { txt, hits } = collectTargets(file);
    if (!hits.length) {
      console.log(path.basename(path.dirname(file)) + ': 无可自动替换项');
      continue;
    }
    console.log('\n=== ' + path.relative(process.cwd(), file) + ' (' + hits.length + ' 处) ===');
    let next = txt;
    for (const h of hits) {
      console.log('  ' + h.emoji + ' → ' + h.icon + '   [' + (h.className || '无 className') + ']');
      next = next.replace(h.raw, h.replacement);
    }
    if (apply) {
      next = ensureIconImport(next);
      fs.writeFileSync(file, next, 'utf8');
      console.log('  → 已写入（含 Icon 导入补齐）');
      totalChanged += hits.length;
    }
  }
  if (!apply) console.log('\n[dry-run] 未改动任何文件；加 --apply 执行写入');
  else console.log('\n共替换 ' + totalChanged + ' 处');
}

const target = process.argv[2];
if (!target) {
  console.error('用法: node migrate-emoji-icons.js <页面目录或文件> [--apply]');
  process.exit(1);
}
migrate(target, process.argv.includes('--apply'));
