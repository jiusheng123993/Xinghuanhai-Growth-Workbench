/**
 * 把首页预览的 Tabler Filled 图标整体换成 Phosphor Fill（语义更准、风格统一）
 * 语义修正：疫苗 -> syringe 注射器、症状 -> stethoscope 听诊器、食物 -> bowl-food 食碗、记忆 -> brain
 * 用法：node swap-phosphor.js
 */
const fs = require('fs');
const DIR = 'E:/星河宠记/02-UI设计/首页优化预览/';
const FILE = DIR + 'index.html';

let html = fs.readFileSync(FILE, 'utf8');

// 目标图标：按文档从上到下的出现顺序
const order = [
  { n: 'palette',        w: 20, desc: '页面背景' },
  { n: 'brain',          w: 20, desc: '记忆（原星星 -> 大脑）' },
  { n: 'caret-down',     w: 16, desc: '切换宠物下拉' },
  { n: 'calendar-check', w: 26, desc: '今日健康摘要' },
  { n: 'check',          w: 24, desc: '打卡对勾' },
  { n: 'arrow-right',    w: 20, cls: 'ck-arrow', desc: '打卡箭头' },
  { n: 'bowl-food',      w: 22, desc: '食物查询（原骨头 -> 食碗）' },
  { n: 'stethoscope',    w: 22, desc: '症状初筛（原爱心 -> 听诊器）' },
  { n: 'syringe',        w: 22, desc: '疫苗日历（原医疗十字 -> 注射器）' },
  { n: 'sparkle',        w: 22, desc: '回忆时间线' },
  { n: 'house',          w: 22, desc: '首页 Tab' },
  { n: 'clock',          w: 22, desc: '时间线 Tab' },
  { n: 'plus',           w: 24, desc: '中间添加' },
  { n: 'paw-print',      w: 22, desc: '家庭 Tab' },
  { n: 'user',           w: 22, desc: '我的 Tab' },
  { n: 'x',              w: 16, desc: '关闭' },
  { n: 'image',          w: 26, desc: '选择照片' },
];

// 只匹配 24x24 的图标；状态栏信号/电池是 16x12、20x12，天然跳过
const PATTERN = /<svg[^>]*viewBox="0 0 24 24"[^>]*>[\s\S]*?<\/svg>/;

let done = 0;
for (const item of order) {
  const m = html.match(PATTERN);
  if (!m) { console.log('MISS ' + item.n + ' (' + item.desc + ')'); continue; }

  let svg = fs.readFileSync(DIR + 'icons-fill-ph/' + item.n + '.svg', 'utf8');
  svg = svg.replace(/\s+/g, ' ').trim();                       // 压成单行
  svg = svg.replace('<svg ', '<svg width="' + item.w + '" height="' + item.w + '" '); // Phosphor 无尺寸，补上
  if (item.cls) svg = svg.replace('<svg ', '<svg class="' + item.cls + '" ');

  html = html.slice(0, m.index) + svg + html.slice(m.index + m[0].length);
  done++;
  console.log('OK   ' + item.n + '  <- ' + item.desc);
}
console.log('\n共替换 ' + done + ' / ' + order.length);

fs.writeFileSync(FILE, html, 'utf8');
console.log('已写回 index.html');
