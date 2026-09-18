/**
 * 审计 SCSS 中「rgba($色板变量, alpha)」的失效写法
 *
 * 背景：项目色板变量定义为 `var(--primary, #FF6B3D)` 形式（为了支持主题切换）。
 * 一旦写进 rgba() 的逗号语法里，编译结果是 `rgba(var(--primary,#FF6B3D),.12)`，
 * 而 rgba() 逗号语法只接受数值通道 → 整条声明被浏览器丢弃 → 背景/边框/阴影全部消失。
 * 实测（Edge 无头 + getComputedStyle）：rgba(var(--primary),.12) → rgba(0,0,0,0)。
 */
const fs = require('fs')
const path = require('path')

const SRC = 'E:/星河宠记/03-源代码/小程序/miniapp/src'

/** 收集所有 scss 文件 */
function walk(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, acc)
    else if (e.name.endsWith('.scss')) acc.push(p)
  }
  return acc
}

const files = walk(SRC)

// 1. 先找出哪些色板变量是 var() 形式（这类变量一旦进 rgba 就会失效）
const varDefs = {}
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8')
  const re = /^\s*\$([a-z0-9-]+)\s*:\s*var\(\s*--([a-z0-9-]+)/gm
  let m
  while ((m = re.exec(src))) varDefs[m[1]] = { cssVar: m[2], file: path.relative(SRC, f) }
}

// 2. 扫描 rgba($变量, alpha) / rgba($变量,alpha)
const hits = []
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8')
  const lines = src.split(/\r?\n/)
  lines.forEach((line, i) => {
    const re = /rgba\(\s*\$([a-z0-9-]+)\s*,/g
    let m
    while ((m = re.exec(line))) {
      const name = m[1]
      if (varDefs[name]) {
        hits.push({
          file: path.relative(SRC, f),
          line: i + 1,
          varName: name,
          cssVar: varDefs[name].cssVar,
          text: line.trim(),
        })
      }
    }
  })
}

console.log(`扫描 ${files.length} 个 scss 文件\n`)
console.log(`==== 失效写法统计：${hits.length} 处 ====\n`)

// 按变量归组
const byVar = {}
for (const h of hits) (byVar[h.varName] ||= []).push(h)

for (const [name, list] of Object.entries(byVar).sort((a, b) => b[1].length - a[1].length)) {
  console.log(`  $${name}  (var --${varDefs[name].cssVar})  →  ${list.length} 处`)
}
console.log()

// 按文件归组（前 25）
const byFile = {}
for (const h of hits) (byFile[h.file] ||= []).push(h)
console.log(`==== 受影响文件 Top 25（共 ${Object.keys(byFile).length} 个文件）====`)
Object.entries(byFile)
  .sort((a, b) => b[1].length - a[1].length)
  .slice(0, 25)
  .forEach(([f, list]) => console.log(`  ${String(list.length).padStart(3)} 处  ${f}`))

// 3. 检查每个 cssVar 是否存在配套的 -rgb 变量
console.log(`\n==== 各 cssVar 是否有配套 -rgb 变量（修复依据）====`)
const allSrc = files.map((f) => fs.readFileSync(f, 'utf8')).join('\n')
for (const [name, def] of Object.entries(varDefs)) {
  if (!byVar[name]) continue
  const rgbVar = `${def.cssVar}-rgb`
  const has = new RegExp(`--${rgbVar}\\s*:`).test(allSrc)
  console.log(`  --${def.cssVar.padEnd(22)} ${has ? `✅ 已有 --${rgbVar}` : `❌ 缺 --${rgbVar}`}   定义于 ${def.file}`)
}

// 4. 输出可直接用于修复的变量清单（json）
const outPath = 'E:/星河宠记/02-UI设计/首页优化预览/rgba-var-audit.json'
fs.writeFileSync(
  outPath,
  JSON.stringify(
    {
      生成时间: new Date().toISOString(),
      失效处数: hits.length,
      受影响文件数: Object.keys(byFile).length,
      按变量: Object.fromEntries(Object.entries(byVar).map(([k, v]) => [k, { cssVar: varDefs[k].cssVar, count: v.length }])),
      明细: hits,
    },
    null,
    2,
  ),
  'utf8',
)
console.log(`\n明细已写入 ${outPath}`)
