/**
 * 为色板变量补配套的 -rgb 三元组变量
 *
 * 【为什么需要】
 *   色板变量形如 `--primary: #FF6B3D;`，一旦写进 rgba() 的逗号语法
 *   —— rgba(var(--primary), .12) —— 浏览器解析为 rgba(#FF6B3D, .12)，非法，整条声明被丢弃。
 *   正确做法是另存一份数值通道 `--primary-rgb: 255, 107, 61;`，写成 rgba(var(--primary-rgb), .12)。
 *   实测（Edge getComputedStyle）：前者 rgba(0,0,0,0)，后者 rgba(255,107,61,0.12)。
 *
 * 【本脚本】两遍扫描 styles/_theme.scss：
 *   第 1 遍：切分主题块，收集每块已声明的全部变量名
 *   第 2 遍：凡目标变量在某块内以 #hex 定义、且该块缺同名 -rgb 时，就地插入一行
 *   （必须先收集后插入：像 `--primary` 紧跟 `--primary-rgb` 的情况，单遍扫描看不到下一行，会插重复）
 *
 * 用法：
 *   node add-rgb-vars.js            # 预演，只打印将要插入的内容
 *   node add-rgb-vars.js --apply    # 实际写入（先自动备份 .bak-rgbfix）
 */
const fs = require('fs')

const THEME = 'E:/星河宠记/03-源代码/小程序/miniapp/src/styles/_theme.scss'

/** 需要 -rgb 配套的变量（= 审计中出现在 rgba() 里的全部色板变量） */
const TARGETS = [
  'primary',
  'primary-light',
  'primary-dark',
  'success',
  'warning',
  'gold',
  'gold-deep',
  'danger',
  'teal',
  'coral',
  'sage',
  'text-primary',
  'text-secondary',
  'text-tertiary',
  'text-hint',
  'bg-page',
  'bg-card',
  'border',
]

/** #RGB / #RRGGBB → "R, G, B" */
function hexToRgb(hex) {
  let h = hex.replace('#', '')
  if (h.length === 3) h = h.split('').map((c) => c + c).join('')
  if (h.length !== 6 || !/^[0-9a-fA-F]{6}$/.test(h)) return null
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)].join(', ')
}

/** 第 1 遍：切出块（起止行 + 选择器 + 块内声明的变量名集合） */
function parseBlocks(lines) {
  const blocks = []
  let cur = null
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const trimmed = line.trim()
    const isComment = trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')
    // 块起始：选择器 + { （排除 SCSS 指令与注释）
    const openMatch = /^([.\w:#\s,&>+~-]+)\{\s*$/.exec(line)
    if (!cur && openMatch && !isComment) {
      cur = { start: i, selector: openMatch[1].trim(), vars: new Set(), end: -1 }
    }
    if (cur) {
      const vm = /^\s*--([a-z0-9-]+)\s*:/.exec(line)
      if (vm) cur.vars.add(vm[1])
      if (trimmed === '}') {
        cur.end = i
        blocks.push(cur)
        cur = null
      }
    }
  }
  return blocks
}

function main() {
  const apply = process.argv.includes('--apply')
  const src = fs.readFileSync(THEME, 'utf8')
  const lines = src.split('\n')
  const blocks = parseBlocks(lines)

  // 行号 → 所属块
  const lineBlock = new Array(lines.length).fill(null)
  for (const b of blocks) {
    for (let i = b.start; i <= b.end; i++) lineBlock[i] = b
  }

  const out = []
  const inserted = []
  const skippedExisting = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    out.push(line)

    const vm = /^(\s*)--([a-z0-9-]+)\s*:\s*(.+?)\s*;\s*$/.exec(line)
    if (!vm) continue
    const [, indent, name, value] = vm
    if (!TARGETS.includes(name)) continue

    const block = lineBlock[i]
    if (!block) continue

    // 关键：通过第 1 遍收集的完整变量集合判断，而不是"前面扫过的行"
    if (block.vars.has(`${name}-rgb`)) {
      skippedExisting.push({ block: block.selector, name })
      continue
    }

    // 两种取值形式都要支持：
    //   #hex               → 直接转通道
    //   rgba(R, G, B, a)   → 取通道丢掉 alpha（深色主题大量用这种写法，如 starry 的 --text-secondary）
    let rgb = null
    let hex = value
    if (/^#[0-9a-fA-F]{3,6}$/.test(value)) {
      rgb = hexToRgb(value)
    } else {
      const rgbaM = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*[\d.]+\s*)?\)$/.exec(value)
      if (rgbaM) {
        rgb = `${rgbaM[1]}, ${rgbaM[2]}, ${rgbaM[3]}`
        hex = `rgba(${rgbaM[1]}, ${rgbaM[2]}, ${rgbaM[3]}, …)`
      }
    }
    if (!rgb) continue

    out.push(`${indent}--${name}-rgb: ${rgb};`)
    block.vars.add(`${name}-rgb`) // 防止同一块内同变量重复插入
    inserted.push({ block: block.selector, name, hex, rgb })
  }

  console.log(`==== 将补入 ${inserted.length} 个 -rgb 变量（跳过已存在 ${skippedExisting.length} 个）====\n`)
  const byBlock = {}
  for (const it of inserted) (byBlock[it.block] ||= []).push(it)
  for (const [block, list] of Object.entries(byBlock)) {
    console.log(`  ${block}  (${list.length} 个)`)
    for (const it of list) console.log(`      --${it.name}-rgb: ${it.rgb};   (源色 ${it.hex})`)
  }

  if (apply) {
    fs.copyFileSync(THEME, `${THEME}.bak-rgbfix`)
    fs.writeFileSync(THEME, out.join('\n'), 'utf8')
    console.log(`\n✅ 已写入 ${THEME}`)
    console.log(`   备份：${THEME}.bak-rgbfix`)
  } else {
    console.log('\n（未加 --apply，文件未改动）')
  }
}

main()
