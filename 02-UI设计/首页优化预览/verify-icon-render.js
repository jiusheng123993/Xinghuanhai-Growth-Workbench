/**
 * 验证 Icon.tsx 的 data URI 渲染链路：
 * 按组件的真实逻辑（fillDataUri）构造 data URI，生成可视页面，
 * 确认面性图标在小程序 <Image src="data:image/svg+xml,..."> 方式下能正常显示与换色。
 * 用法：node verify-icon-render.js
 */
const fs = require('fs');
const DIR = 'E:/星河宠记/02-UI设计/首页优化预览/';
const SRC = DIR + 'icons-fill-ph/';

// 与 Icon.tsx 中的 fillDataUri 完全一致
function fillDataUri(inner, size, color) {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${size}' height='${size}' viewBox='0 0 256 256' fill='${color}'>${inner}</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

// 与 Icon.tsx 中的 lineDataUri 一致（用于对比历史线性图标）
function lineDataUri(inner, size, color) {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${size}' height='${size}' viewBox='0 0 24 24' fill='none' stroke='${color}' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'>${inner}</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

const files = fs.readdirSync(SRC).filter((f) => f.endsWith('.svg')).sort();

// 首页实际用到的 17 个（按语义分组，便于肉眼检查是否"搭"）
const groups = [
  { title: '导航', names: ['house', 'clock', 'paw-print', 'user', 'plus'] },
  { title: '功能入口', names: ['bowl-food', 'stethoscope', 'syringe', 'sparkle', 'calendar-check'] },
  { title: '医疗健康', names: ['hospital', 'first-aid', 'pill', 'heartbeat', 'warning', 'check-circle'] },
  { title: '宠物与情感', names: ['cat', 'dog', 'bone', 'heart', 'baby', 'handshake'] },
  { title: '内容与工具', names: ['camera', 'image', 'palette', 'film-strip', 'book-open', 'chart-line', 'scales', 'dna', 'drop', 'lightbulb', 'bell', 'share-network', 'trophy', 'crown', 'gear', 'magnifying-glass', 'note-pencil', 'clipboard-text', 'chat-circle', 'users', 'lightning', 'arrows-clockwise'] },
  { title: '基础操作', names: ['x', 'check', 'caret-down', 'caret-right', 'dots-three', 'share', 'star', 'map-pin', 'sign-out'] },
];

function inner(name) {
  const svg = fs.readFileSync(SRC + name + '.svg', 'utf8');
  return svg.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '').replace(/\s+/g, ' ').trim();
}

const blocks = groups.map((g) => {
  const items = g.names
    .filter((n) => files.includes(n + '.svg'))
    .map((n) => `<div class='ico'><img src="${fillDataUri(inner(n), 40, '#FF6B3D')}" width="40" height="40"><span>${n}</span></div>`)
    .join('');
  return `<h2>${g.title}</h2><div class='grid'>${items}</div>`;
}).join('');

const html = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8"><title>Icon 组件渲染验证</title>
<style>
 *{box-sizing:border-box;margin:0;padding:0}
 body{font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;background:#F4EDE4;padding:36px;color:#40281C}
 h1{font-size:20px;margin-bottom:6px}
 .sub{font-size:13px;color:#8B6E58;margin-bottom:22px;line-height:1.7;max-width:960px}
 h2{font-size:14px;margin:22px 0 10px;color:#40281C}
 .grid{display:grid;grid-template-columns:repeat(11,1fr);gap:12px}
 .ico{display:flex;flex-direction:column;align-items:center;gap:6px;background:#fff;border-radius:14px;padding:14px 6px;box-shadow:0 4px 14px -8px rgba(61,33,18,.2);border:1px solid #f3e2d2}
 .ico span{font-size:9px;color:#8B6E58;text-align:center;word-break:break-all;line-height:1.2}
</style></head><body>
<h1>Icon 组件渲染验证（data URI 链路）</h1>
<div class="sub">下面每个图标都是按 <b>Icon.tsx 里 fillDataUri() 的真实逻辑</b>构造的 data URI，用 &lt;img&gt; 模拟小程序 &lt;Image src=&quot;data:image/svg+xml,...&quot;&gt; 的渲染方式。能正常显示 = 图标系统落地链路通。</div>
${blocks}
</body></html>`;

fs.writeFileSync(DIR + 'icon-render-check.html', html, 'utf8');
console.log('已生成验证页，图标数：' + files.length);
console.log('路径：' + DIR + 'icon-render-check.html');
