/** 为「注射器/疫苗/听诊器」等语义寻找真正对得上的面性图标 */
const fs = require('fs');
const https = require('https');

const DIR = 'E:/星河宠记/02-UI设计/首页优化预览/icons-fill/';

function get(url) {
  return new Promise((res) => {
    https.get(url, (r) => {
      if (r.statusCode !== 200) { r.resume(); return res(null); }
      let d = '';
      r.on('data', (c) => (d += c));
      r.on('end', () => res(d));
    }).on('error', () => res(null));
  });
}

// 候选：Tabler filled 与 Phosphor fill 两个源，挑真正对得上的图标
const cands = [
  // [语义, 源, 路径]
  ['疫苗-注射器', 'tabler', 'https://unpkg.com/@tabler/icons@latest/icons/filled/syringe.svg'],
  ['疫苗-注射器', 'phosphor', 'https://unpkg.com/@phosphor-icons/core@latest/assets/fill/syringe-fill.svg'],
  ['疫苗-急救', 'phosphor', 'https://unpkg.com/@phosphor-icons/core@latest/assets/fill/first-aid-fill.svg'],
  ['疫苗-急救', 'tabler', 'https://unpkg.com/@tabler/icons@latest/icons/filled/first-aid-kit.svg'],
  ['症状-听诊器', 'phosphor', 'https://unpkg.com/@phosphor-icons/core@latest/assets/fill/stethoscope-fill.svg'],
  ['症状-体温计', 'phosphor', 'https://unpkg.com/@phosphor-icons/core@latest/assets/fill/thermometer-fill.svg'],
  ['症状-体温计', 'tabler', 'https://unpkg.com/@tabler/icons@latest/icons/filled/thermometer.svg'],
  ['食物-碗', 'phosphor', 'https://unpkg.com/@phosphor-icons/core@latest/assets/fill/bowl-food-fill.svg'],
  ['食物-碗', 'tabler', 'https://unpkg.com/@tabler/icons@latest/icons/filled/bowl.svg'],
  ['记忆-大脑', 'phosphor', 'https://unpkg.com/@phosphor-icons/core@latest/assets/fill/brain-fill.svg'],
  ['记忆-相册', 'phosphor', 'https://unpkg.com/@phosphor-icons/core@latest/assets/fill/book-heart-fill.svg'],
  ['回忆-闪光', 'phosphor', 'https://unpkg.com/@phosphor-icons/core@latest/assets/fill/sparkle-fill.svg'],
  ['医疗-十字', 'phosphor', 'https://unpkg.com/@phosphor-icons/core@latest/assets/fill/first-aid-fill.svg'],
];

(async () => {
  const ok = [];
  for (const [sem, src, url] of cands) {
    const d = await get(url);
    const name = url.split('/').pop();
    if (d && d.includes('<svg')) {
      console.log('OK   [' + sem + '] ' + src + ' -> ' + name);
      ok.push([sem, src, name, d]);
    } else {
      console.log('NO   [' + sem + '] ' + src + ' -> ' + name);
    }
  }
  // 把可用的写出来，供挑选
  fs.writeFileSync(DIR + '_candidates.json', JSON.stringify(ok.map(([s, src, n]) => ({ sem: s, src, file: n })), null, 2), 'utf8');
  console.log('\n可用候选数: ' + ok.length);
})();
