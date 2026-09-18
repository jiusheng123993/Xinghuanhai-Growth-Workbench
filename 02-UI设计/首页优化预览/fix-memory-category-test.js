/**
 * 更新 memoryService 测试里的 getCategoryInfo 断言
 *
 * 背景：getCategoryInfo 的 icon 从 emoji 改成了面性图标名（统一到图标体系），
 * 测试断言需要同步，否则会误报失败。
 * 用法：node fix-memory-category-test.js [--apply]
 */
const fs = require('fs');

const FILE = 'E:/星河宠记/03-源代码/小程序/miniapp/src/services/__tests__/memoryService.test.ts';

const MAP = {
  '❤️': 'heart',
  '🐾': 'paw-print',
  '⏰': 'clock',
  '⭐': 'star',
  '🎉': 'sparkle',
  '🍽️': 'bowl-food',
  '💊': 'pill',
  '🔄': 'arrows-clockwise',
  '📝': 'note-pencil',
};

const apply = process.argv.includes('--apply');
let txt = fs.readFileSync(FILE, 'utf8');
let changed = 0;

for (const [emoji, icon] of Object.entries(MAP)) {
  const from = `icon: '${emoji}'`;
  const to = `icon: '${icon}'`;
  if (txt.includes(from)) {
    txt = txt.split(from).join(to);
    changed++;
    console.log(`  ${emoji} → ${icon}`);
  }
}

console.log(apply ? `\n替换 ${changed} 类断言` : '\n[dry-run] 加 --apply 执行');
if (apply) fs.writeFileSync(FILE, txt, 'utf8');
