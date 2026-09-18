/**
 * 修复「rgba($色板变量, alpha)」失效写法 → 「rgba(var(--变量-rgb, R,G,B), alpha)」
 *
 * 【失效原理】
 *   $color-primary 定义为 `var(--primary, #FF6B3D)`（为支持主题切换）。
 *   写进 rgba() 逗号语法后编译成 `rgba(var(--primary,#FF6B3D),.12)`；
 *   var() 在计算值阶段展开成 `rgba(#FF6B3D,.12)`，而 rgba() 逗号语法只接受数值通道
 *   → 整条声明非法被丢弃（实测 getComputedStyle 得到 rgba(0,0,0,0) 完全透明）。
 *
 * 【修复方式】
 *   改用配套的数值通道变量：rgba(var(--primary-rgb, 255, 107, 61), .12)
 *   带上 fallback 三元组，即使将来某主题漏定义 -rgb 也不会退回透明。
 *
 * 用法：
 *   node fix-rgba-vars.js                 # 预演（只报数 + 抽样展示）
 *   node fix-rgba-vars.js --file <路径>    # 只改单个文件（试点用）
 *   node fix-rgba-vars.js --apply          # 全量写入（逐文件自动备份 .bak-rgbafix）
 */
const fs = require('fs')
const path = require('path')

const SRC = 'E:/星河宠记/03-源代码/小程序/miniapp/src'
const THEME = `${SRC}/styles/_theme.scss`

/** 收集 scss 文件 */
function walk(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, acc)
    else if (e.name.endsWith('.scss') && !e.name.endsWith('.bak-rgbfix') && !e.name.endsWith('.bak-rgbafix'))
      acc.push(p)
  }
  return acc
}

/** #hex → "R, G, B" */
function hexToRgb(hex) {
  let h = hex.replace('#', '')
  if (h.length === 3) h = h.split('').map((c) => c + c).join('')
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return null
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)].join(', ')
}

/** 解析 $color-x: var(--y, #fallback); 建立 变量名 → {cssVar, rgb} 映射 */
function buildColorMap() {
  const src = fs.readFileSync(THEME, 'utf8')
  const map = {}
  const re = /^\s*\$([a-z0-9-]+)\s*:\s*var\(\s*(--[a-z0-9-]+)\s*(?:,\s*(#[0-9a-fA-F]{3,6}|rgba?\([^)]*\)))?\s*\)\s*;/gm
  let m
  while ((m = re.exec(src))) {
    const [, scssName, cssVar, fallback] = m
    let rgb = null
    if (fallback) {
      if (fallback.startsWith('#')) rgb = hexToRgb(fallback)
      else {
        const rm = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(fallback)
        if (rm) rgb = `${rm[1]}, ${rm[2]}, ${rm[3]}`
      }
    }
    map[scssName] = { cssVar, rgb }
  }
  return map
}

function main() {
  const args = process.argv.slice(2)
  const apply = args.includes('--apply')
  const fileIdx = args.indexOf('--file')
  const onlyFile = fileIdx >= 0 ? args[fileIdx + 1] : null

  const colorMap = buildColorMap()
  const files = onlyFile ? [path.resolve(onlyFile)] : walk(SRC)

  let totalReplacements = 0
  const perFile = []
  const samples = []

  for (const f of files) {
    const src = fs.readFileSync(f, 'utf8')
    let count = 0
    // 匹配 rgba( $color-x ,   或  rgb( $color-x ,   —— 只换颜色部分，alpha 原样保留
    const out = src.replace(/\brgba?\(\s*\$([a-z0-9-]+)\s*,/g, (full, name) => {
      const entry = colorMap[name]
      if (!entry) return full // 不是色板变量（可能是 $alpha 之类），原样保留
      count++
      const fallback = entry.rgb ? `, ${entry.rgb}` : ''
      const replacement = full.replace(/\$[a-z0-9-]+/, `var(${entry.cssVar}-rgb${fallback})`)
      if (samples.length < 8) samples.push({ file: path.relative(SRC, f), from: full.trim(), to: replacement.trim() })
      return replacement
    })

    if (count > 0) {
      totalReplacements += count
      perFile.push({ file: path.relative(SRC, f), count })
      if (apply) {
        fs.copyFileSync(f, `${f}.bak-rgbafix`)
        fs.writeFileSync(f, out, 'utf8')
      }
    }
  }

  console.log(`==== 共命中 ${totalReplacements} 处失效写法，涉及 ${perFile.length} 个文件 ====\n`)
  console.log('转换示例：')
  for (const s of samples) console.log(`  ${s.from}\n    → ${s.to}\n`)

  perFile.sort((a, b) => b.count - a.count)
  console.log('按文件：')
  for (const p of perFile.slice(0, 15)) console.log(`  ${String(p.count).padStart(3)} 处  ${p.file}`)
  if (perFile.length > 15) console.log(`  … 其余 ${perFile.length - 15} 个文件`)

  if (apply) console.log(`\n✅ 已写入（每个文件旁留 .bak-rgbafix 备份）`)
  else console.log(`\n（未加 --apply，文件未改动）`)
}

main()
