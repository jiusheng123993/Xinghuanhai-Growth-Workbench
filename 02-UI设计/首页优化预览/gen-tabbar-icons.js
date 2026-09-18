/**
 * 底部 tabBar 图标生成脚本（按主题成套生成）
 *
 * 【背景】原 tabBar 图标存在 4 个问题（2026-09-10 实测取证）：
 *   1. creative（创作）图标颜色与其余 4 个都不同：未选中 #8080A0 偏紫（其余 #8A99AA）、
 *      选中 #E0A020 暗黄（其余 #E8A838）
 *   2. 所有图标颜色与 tabBar 文字颜色冷暖冲突：图标冷灰蓝 ↔ 文字暖棕褐
 *   3. 风格混搭：宠物是面性实心，其余 4 个是线性描边；创作画的是"圆+3点"，看不出创作
 *   4. 【关键】tabBar 文字色是逐主题变化的（themeStore.ThemeMeta.tabBarColor），
 *      而图标是 PNG、颜色烘焙在文件里，setTabBarStyle 改不到 →
 *      固定一套图标必然只对默认主题正确，其余主题图标与文字不同色
 *
 * 【本脚本做法】
 *   · 图标统一改用 Phosphor 图标族（MIT）：未选中 = regular 线性、选中 = fill 面性
 *     （线→面区分状态是 Apple HIG / 主流 App 的标准做法，比单纯换色更能表达"当前项"）
 *   · 颜色从 themeStore.ts 的 THEME_LIST 解析（单一事实源，不硬编码）
 *   · 为每个 tabBarIconDir 非空的主题各出一套图标，落在 src/<tabBarIconDir>/
 *   · 默认配色（autumn / grid，tabBarIconDir = null）写在 src/assets/icons/，
 *     与 app.config.ts 里声明的路径一致
 *
 * 用法：
 *   node gen-tabbar-icons.js            # 只渲染到预览目录，不碰项目资源
 *   node gen-tabbar-icons.js --apply    # 额外写回项目资源（自动备份原文件）
 */
const fs = require('fs')
const path = require('path')
const os = require('os')
const { execFileSync } = require('child_process')

const ROOT = 'E:/星河宠记'
const MINIAPP = `${ROOT}/03-源代码/小程序/miniapp`
const SRC = `${MINIAPP}/src`
const ASSETS = `${SRC}/assets/icons`
const THEME_STORE = `${SRC}/stores/themeStore.ts`
const CACHE = `${ROOT}/02-UI设计/首页优化预览/.svg-cache`
const WORK = `${ROOT}/02-UI设计/首页优化预览/tabbar-icons`
const NEW_DIR = `${WORK}/new`
const OLD_DIR = `${WORK}/before`

/** 临时 HTML 放纯 ASCII 路径：Edge 对含中文的 file:// 路径不稳定 */
const TMP = path.join(os.tmpdir(), 'xhh-tabbar-icons')

const SIZE = 81 // 微信官方推荐 tabBar 图标尺寸

const EDGE_CANDIDATES = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
]

/** tabBar 五个 tab：assetKey = 项目文件名，phosphor = Phosphor 图标名 */
const TABS = [
  { assetKey: 'home', phosphor: 'house', label: '今天' },
  { assetKey: 'creative', phosphor: 'palette', label: '创作' },
  { assetKey: 'timeline', phosphor: 'clock', label: '时光' },
  { assetKey: 'pet', phosphor: 'paw-print', label: '宠物' },
  { assetKey: 'mine', phosphor: 'user', label: '我的' },
]

/**
 * 从 themeStore.ts 解析各主题的 tabBar 配色与图标目录
 * 按 `key: 'xxx'` 切块，避免跨主题误匹配（tabBarIconDir 在 tabBarColor 之前出现）
 */
function parseThemes() {
  const src = fs.readFileSync(THEME_STORE, 'utf8')
  const marks = []
  const keyRe = /key:\s*'([a-z]+)'/g
  let m
  while ((m = keyRe.exec(src))) marks.push({ key: m[1], idx: m.index })

  return marks.map((mark, i) => {
    const chunk = src.slice(mark.idx, i + 1 < marks.length ? marks[i + 1].idx : src.length)
    const pick = (re) => {
      const r = re.exec(chunk)
      return r ? r[1] : null
    }
    const dirRaw = pick(/tabBarIconDir:\s*(null|'([^']+)')/)
    const dir = /tabBarIconDir:\s*null/.test(chunk) ? null : pick(/tabBarIconDir:\s*'([^']+)'/)
    return {
      key: mark.key,
      normal: pick(/tabBarColor:\s*'([^']+)'/),
      active: pick(/tabBarSelectedColor:\s*'([^']+)'/),
      dir,
      _raw: dirRaw,
    }
  })
}

/** #RGB / #RRGGBB / rgba(r,g,b,a) → { fill, opacity } */
function parseColor(value) {
  const v = String(value).trim()
  if (v.startsWith('#')) {
    let h = v.slice(1)
    if (h.length === 3) h = h.split('').map((c) => c + c).join('')
    return { fill: `#${h}`, opacity: 1 }
  }
  const m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/.exec(v)
  if (m) {
    const hex = [m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, '0')).join('')
    return { fill: `#${hex}`.toUpperCase(), opacity: m[4] !== undefined ? Number(m[4]) : 1 }
  }
  throw new Error(`无法解析颜色：${value}`)
}

/** 读取缓存好的 Phosphor SVG，剥离外层 <svg> 只留内部图形 */
function readSvgInner(weight, file) {
  const p = path.join(CACHE, `${weight}--${file}.svg`)
  if (!fs.existsSync(p)) throw new Error(`缺少 SVG 缓存：${p}`)
  const raw = fs.readFileSync(p, 'utf8')
  const m = /<svg[^>]*>([\s\S]*)<\/svg>/.exec(raw)
  if (!m) throw new Error(`SVG 结构异常：${p}`)
  return m[1].trim()
}

function buildSvg(inner, color) {
  const { fill, opacity } = parseColor(color)
  const op = opacity < 1 ? ` opacity="${opacity}"` : ''
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" ` +
    `viewBox="0 0 256 256" fill="${fill}"${op}>${inner}</svg>`
  )
}

function buildHtml(svg) {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
html,body{margin:0;padding:0;width:${SIZE}px;height:${SIZE}px;overflow:hidden;background:transparent}
svg{display:block}
</style></head><body>${svg}</body></html>`
}

function findEdge() {
  for (const p of EDGE_CANDIDATES) if (fs.existsSync(p)) return p
  throw new Error('未找到 msedge.exe')
}

function renderPng(edge, htmlPath, pngPath) {
  execFileSync(
    edge,
    [
      '--headless',
      '--disable-gpu',
      '--hide-scrollbars',
      '--force-device-scale-factor=1',
      '--default-background-color=00000000',
      `--window-size=${SIZE},${SIZE}`,
      '--virtual-time-budget=3000',
      `--screenshot=${pngPath}`,
      'file:///' + htmlPath.replace(/\\/g, '/'),
    ],
    { stdio: 'ignore', timeout: 60000 },
  )
  if (!fs.existsSync(pngPath)) throw new Error(`Edge 未产出 PNG：${pngPath}`)
  return fs.readFileSync(pngPath)
}

function main() {
  const apply = process.argv.includes('--apply')
  const themes = parseThemes()
  const edge = findEdge()
  for (const d of [WORK, NEW_DIR, OLD_DIR, TMP]) fs.mkdirSync(d, { recursive: true })

  console.log('==== 从 themeStore.ts 解析到的主题配色 ====\n')
  const sets = []
  for (const t of themes) {
    const dir = t.dir || 'assets/icons'
    console.log(
      `  ${t.key.padEnd(8)} 未选中 ${String(t.normal).padEnd(22)} 选中 ${String(t.active).padEnd(10)} → ${dir}`,
    )
    if (!t.dir) {
      // 默认配色：只在 base 目录出一套（autumn / grid 共用，避免重复资源）
      if (!sets.some((s) => s.dir === dir)) sets.push({ ...t, dir, label: '默认' })
    } else {
      sets.push({ ...t, label: t.key })
    }
  }

  console.log(`\n共需生成 ${sets.length} 套 × 10 张 = ${sets.length * 10} 张图标\n`)

  let total = 0
  for (const set of sets) {
    const outDir = path.join(SRC, set.dir)
    const previewDir = path.join(NEW_DIR, set.label)
    fs.mkdirSync(previewDir, { recursive: true })
    if (apply) fs.mkdirSync(outDir, { recursive: true })

    console.log(`—— ${set.label}（${set.normal} / ${set.active}）——`)
    for (const tab of TABS) {
      const variants = [
        { suffix: '', weight: 'regular', file: tab.phosphor, color: set.normal },
        { suffix: '-active', weight: 'fill', file: `${tab.phosphor}-fill`, color: set.active },
      ]
      for (const v of variants) {
        const name = `${tab.assetKey}${v.suffix}`
        const inner = readSvgInner(v.weight, v.file)
        const htmlPath = path.join(TMP, `${set.label}-${name}.html`)
        fs.writeFileSync(htmlPath, buildHtml(buildSvg(inner, v.color)), 'utf8')
        const tmpPng = path.join(TMP, `${set.label}-${name}.png`)
        const buf = renderPng(edge, htmlPath, tmpPng)
        fs.writeFileSync(path.join(previewDir, `${name}.png`), buf)

        const target = path.join(outDir, `${name}.png`)
        if (fs.existsSync(target) && apply) {
          const bak = path.join(OLD_DIR, set.label)
          fs.mkdirSync(bak, { recursive: true })
          fs.copyFileSync(target, path.join(bak, `${name}.png`))
        }
        if (apply) fs.copyFileSync(path.join(previewDir, `${name}.png`), target)

        const w = buf.readUInt32BE(16)
        const h = buf.readUInt32BE(20)
        if (w !== SIZE || h !== SIZE) throw new Error(`${name} 尺寸异常 ${w}x${h}`)
        total++
      }
    }
    console.log(`   ✅ 10 张（${set.dir}）`)
  }

  console.log(`\n==== 自检 ====`)
  console.log(`  ✅ 共 ${total} 张，尺寸统一 ${SIZE}x${SIZE}`)

  if (apply) console.log(`\n✅ 已写回项目资源（原文件备份在 ${OLD_DIR}）`)
  else console.log('\n（未加 --apply，仅渲染到预览目录，项目资源未改动）')
}

main()
