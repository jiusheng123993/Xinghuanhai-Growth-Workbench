/**
 * 度量：我做的 380 处 rgba 修复，有多少是「肉眼能看出来的」？
 *
 * 背景：用户反馈「除了今天之外其他界面一点变化没有」。先别急着解释，
 * 用数据判断这个说法是否成立 —— 按 alpha 值分桶，alpha 越低越接近不可见。
 */
const fs = require('fs')
const path = require('path')

const SRC = 'E:/星河宠记/03-源代码/小程序/miniapp/src'

function walk(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, acc)
    else if (e.name.endsWith('.scss')) acc.push(p)
  }
  return acc
}

/** 按 alpha 分档：越低越接近"看不见" */
const BUCKETS = [
  { max: 0.15, label: '淡到几乎不可见（≤0.15）', visible: false },
  { max: 0.3, label: '很轻微（0.15~0.3）', visible: false },
  { max: 0.6, label: '可感知（0.3~0.6）', visible: true },
  { max: 1.01, label: '明显（>0.6）', visible: true },
]

function main() {
  const files = walk(SRC)
  const all = []
  const byFile = {}

  for (const f of files) {
    const src = fs.readFileSync(f, 'utf8')
    const lines = src.split(/\r?\n/)
    lines.forEach((line, i) => {
      // 修复后的形态：rgba(var(--xxx-rgb, R,G,B), α)
      const re = /rgba\(\s*var\(--[a-z0-9-]+-rgb[^)]*\)\s*,\s*([\d.]+)\s*\)/g
      let m
      while ((m = re.exec(line))) {
        const a = parseFloat(m[1])
        const rel = path.relative(SRC, f)
        all.push({ file: rel, line: i + 1, alpha: a, prop: line.trim().split(':')[0] })
        byFile[rel] = (byFile[rel] || 0) + 1
      }
    })
  }

  console.log(`扫描 ${files.length} 个 scss，命中修复后的 rgba(var(--*-rgb)) 写法 ${all.length} 处\n`)

  console.log('==== 按 alpha 分档（判断"看不看得出来"）====')
  let invisible = 0
  for (const b of BUCKETS) {
    const lo = BUCKETS[BUCKETS.indexOf(b) - 1]?.max ?? 0
    const list = all.filter((x) => x.alpha > lo && x.alpha <= b.max)
    if (!b.visible) invisible += list.length
    const pct = ((list.length / all.length) * 100).toFixed(0)
    console.log(`  ${b.label.padEnd(26)} ${String(list.length).padStart(4)} 处  ${pct.padStart(3)}%  ${b.visible ? '← 肉眼可感知' : '← 基本看不出'}`)
  }

  console.log(
    `\n>>> ${invisible} / ${all.length} 处（${((invisible / all.length) * 100).toFixed(0)}%）的 alpha ≤ 0.3 —— 修好之后也只是"该有的淡色底回来了"，谈不上变好看。`,
  )

  console.log('\n==== 按属性看：修的是什么 ====')
  const byProp = {}
  for (const x of all) byProp[x.prop] = (byProp[x.prop] || 0) + 1
  Object.entries(byProp)
    .sort((a, b) => b[1] - a[1])
    .forEach(([p, n]) => console.log(`  ${p.padEnd(16)} ${String(n).padStart(4)} 处`))

  console.log('\n==== 受影响文件 Top 12 ====')
  Object.entries(byFile)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .forEach(([f, n]) => console.log(`  ${String(n).padStart(3)} 处  ${f}`))

  // 这些文件里有多少同时"有插画/大改动"
  console.log('\n==== 关键判断：哪些页面只有"淡色修复"、没有任何视觉增强 ====')
  const bigChange = new Set([
    'pages/index/index.scss',
    'pages/timeline/index.scss',
    'pages/creative/index.scss',
    'pagesPet/achievement/index.scss',
    'pagesPet/vaccine/index.scss',
  ])
  const onlyTint = Object.keys(byFile).filter((f) => !bigChange.has(f))
  console.log(`  只有淡色修复、没做过视觉增强的文件：${onlyTint.length} / ${Object.keys(byFile).length}`)
  onlyTint.slice(0, 20).forEach((f) => console.log(`    ${f}  (${byFile[f]} 处)`))
}

main()
