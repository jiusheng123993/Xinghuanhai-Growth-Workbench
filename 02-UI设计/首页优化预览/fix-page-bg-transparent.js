/**
 * 修复：页面根容器背景盖住了 PageBackground 组件
 *
 * 背景：第 11 轮把各页手写背景层换成了 <PageBackground />，但页面根容器自己也声明了
 * `background: $gradient-page`（不透明），它层叠在组件之上，导致组件的背景
 * （含星空星点 / 奶油格纹 / 宠物照片壁纸）根本透不出来 —— 背景自定义等于没生效。
 *
 * 做法：把根容器那一处 `background: $gradient-page;` 改为 transparent，
 * 背景统一交给组件渲染。每个页面的根容器只出现一次该声明，故只改第一处。
 *
 * 用法：node fix-page-bg-transparent.js [--apply]
 */
const fs = require('fs');
const path = require('path');

const SRC = 'E:/星河宠记/03-源代码/小程序/miniapp/src';

// 仅处理已接入 PageBackground 的页面目录
const PAGES = [
  'pages/index', 'pages/mine', 'pages/family', 'pages/pet-profile', 'pages/timeline',
  'pagesPet/checkin', 'pagesPet/diary', 'pagesPet/family-tree', 'pagesPet/food-query',
  'pagesPet/symptom-check', 'pagesPet/trends', 'pagesPet/vaccine',
  'pagesPet/weekly-report', 'pagesPet/yearly-review',
  'pagesUser/bind-wechat', 'pagesUser/login', 'pagesUser/member',
];

const apply = process.argv.includes('--apply');
let count = 0;

for (const p of PAGES) {
  const scss = path.join(SRC, p, 'index.scss');
  if (!fs.existsSync(scss)) continue;
  const txt = fs.readFileSync(scss, 'utf8');

  // 根容器背景：只替换第一次出现的 background: $gradient-page;
  const idx = txt.indexOf('background: $gradient-page;');
  if (idx < 0) {
    console.log('跳过（无该声明）: ' + p);
    continue;
  }

  const replacement =
    '/* 背景统一由 <PageBackground /> 组件渲染（含星空/格纹/照片壁纸），此处保持透明 */\n' +
    '  background: transparent;';

  console.log((apply ? '修复: ' : '待修复: ') + p);
  if (apply) {
    const next = txt.slice(0, idx) + replacement + txt.slice(idx + 'background: $gradient-page;'.length);
    fs.writeFileSync(scss, next, 'utf8');
    count++;
  }
}

console.log(apply ? `\n已修复 ${count} 个文件` : '\n[dry-run] 加 --apply 执行');
