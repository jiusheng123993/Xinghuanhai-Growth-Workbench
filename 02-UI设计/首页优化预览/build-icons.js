/**
 * 把首页预览里的手绘占位 SVG 图标替换为 Tabler Filled 面性图标，并更新 slogan 文案。
 * 用法：node build-icons.js
 */
const fs = require('fs');
const DIR = 'E:/星河宠记/02-UI设计/首页优化预览/';
const HTML = DIR + 'index.html';

let html = fs.readFileSync(HTML, 'utf8');

/** 读取 Tabler filled 图标，压成单行 SVG 片段 */
function icon(name, w, h, extraClass) {
  let c = fs.readFileSync(DIR + 'icons-fill/' + name + '.svg', 'utf8');
  c = c.replace(/\s+/g, ' ').replace(/ class="[^"]*"/, '').trim();
  if (w) c = c.replace('width="24"', 'width="' + w + '"').replace('height="24"', 'height="' + h + '"');
  if (extraClass) c = c.replace('<svg ', '<svg class="' + extraClass + '" ');
  return c;
}

// [手绘占位图标, 替换为的 Tabler filled 图标]
const pairs = [
  // 顶部导航
  ['<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21a9 9 0 1 1 9-9c0 2.5-1.5 4-3.5 4H15a2 2 0 0 0-1.5 3.2c.4.5.6 1 .6 1.6 0 .7-.3 1.2-.6 1.2z"/><circle cx="7.5" cy="11.5" r="1.3"/><circle cx="11" cy="8" r="1.3"/><circle cx="15.5" cy="8.5" r="1.3"/></svg>', icon('palette')],
  ['<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a4 4 0 0 0-4 4 3 3 0 0 0-3 3 3 3 0 0 0 0 6 3.5 3.5 0 0 0 3.5 3.5 3 3 0 0 0 2.5-1.2c.5.7 1.3 1.2 2.5 1.2a3.5 3.5 0 0 0 3.5-3.5 3 3 0 0 0 0-6 3 3 0 0 0-3-3 4 4 0 0 0-4-4z"/><path d="M9.5 13.5h5"/></svg>', icon('star')],
  // 宠物切换下拉
  ['<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color:var(--ink3);margin-left:2px"><path d="m6 9 6 6 6-6"/></svg>', icon('chevron-down', 16, 16).replace('<svg ', '<svg style="color:var(--ink3);margin-left:2px" ')],
  // 今日健康摘要卡
  ['<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="17" rx="3"/><path d="M8 2v4M16 2v4M3 9h18"/><path d="m9 16 2 2 4-4"/></svg>', icon('calendar')],
  // 打卡按钮 + 箭头
  ['<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>', icon('check')],
  ['<svg class="ck-arrow" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>', icon('chevron-right', 20, 20, 'ck-arrow')],
  // 快捷功能四宫格
  ['<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 11h16M4 11a8 8 0 0 1 16 0v3H4z"/><path d="M8 14v3M16 14v3"/></svg>', icon('bone')],
  ['<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a5 5 0 0 1 5 5c0 3-2 4.5-2 7h-6c0-2.5-2-4-2-7a5 5 0 0 1 5-5z"/><circle cx="12" cy="8" r="1.6"/></svg>', icon('heart')],
  ['<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a7 7 0 0 0-7 7v3l-1.5 4h17l-1.5-4v-3a7 7 0 0 0-7-7z"/><path d="M9 21h6"/></svg>', icon('medical-cross')],
  ['<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/></svg>', icon('sparkles')],
  // 底部导航
  ['<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/></svg>', icon('home')],
  ['<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/></svg>', icon('clock')],
  ['<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>', icon('plus')],
  ['<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3.2"/><circle cx="16.5" cy="9" r="2.4"/><path d="M3.5 19c.6-3 2.8-4.5 5.5-4.5s4.9 1.5 5.5 4.5"/><path d="M14.5 14.5c1.6-.5 3-.2 4.2 1 1 .9 1.5 2.2 1.6 3.5"/></svg>', icon('paw')],
  ['<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-6 8-6s8 2 8 6"/></svg>', icon('user')],
  // 背景选择弹层
  ['<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>', icon('x', 16, 16)],
  ['<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><rect x="3" y="5" width="18" height="14" rx="3"/><circle cx="8.5" cy="10" r="1.5"/><path d="m21 15-4.5-4.5L9 18"/></svg>', icon('photo', 26, 26)],
];

let hit = 0;
for (const [oldStr, newStr] of pairs) {
  if (!html.includes(oldStr)) {
    console.log('MISS: ' + oldStr.slice(0, 70));
    continue;
  }
  html = html.split(oldStr).join(newStr);
  hit++;
}
console.log('图标替换成功: ' + hit + '/' + pairs.length);

// 更新 slogan 文案（更自然、更软萌，不生硬）
const oldSlogans = `  const SLOGANS = [
    {t:"每一只毛孩子，都是一颗住在人间的星星", tag:"主推"},
    {t:"把它的每一天，都记成你们的故事", tag:"备选"},
    {t:"它的一生很短，值得被好好记住", tag:"备选"},
    {t:"陪伴会走远，爱会留下来", tag:"备选"},
    {t:"用回忆，把爱留住", tag:"备选"}
  ];`;
const newSlogans = `  const SLOGANS = [
    {t:"和它的每一天，都想好好记下来呀", tag:"主推"},
    {t:"它的可爱，要一颗一颗收进星河里", tag:"备选"},
    {t:"陪它走过的日子，都会闪闪发光", tag:"备选"},
    {t:"毛孩子的日常，也想被温柔记住", tag:"备选"},
    {t:"今天也要记住，它有多可爱呀", tag:"备选"}
  ];`;
if (html.includes(oldSlogans)) {
  html = html.replace(oldSlogans, newSlogans);
  console.log('slogan 已更新');
} else {
  console.log('MISS: slogan 数组');
}

// 关键词高亮正则同步（新文案里的重点词）
const oldRe = `slogEl.innerHTML = s.t.replace(/(星星|故事|记住|爱|回忆)/g, '<span class="accent">$1</span>');`;
const newRe = `slogEl.innerHTML = s.t.replace(/(星河|闪闪发光|记住|记下来|可爱)/g, '<span class="accent">$1</span>');`;
if (html.includes(oldRe)) { html = html.replace(oldRe, newRe); console.log('高亮正则已更新'); }
else console.log('MISS: 高亮正则');

// 说明栏第③点文案（图标说明改为面性）
const oldNote = `<b>③ 图标换 SVG</b>：把 emoji 图标统一换成手绘线性 SVG 图标，更精致。`;
const newNote = `<b>③ 图标换面性填充</b>：把 emoji 图标统一换成 Tabler Filled 实心图标，圆润更萌。`;
if (html.includes(oldNote)) { html = html.replace(oldNote, newNote); console.log('说明栏已更新'); }
else console.log('MISS: 说明栏');

fs.writeFileSync(HTML, html, 'utf8');
console.log('已写回 index.html');
