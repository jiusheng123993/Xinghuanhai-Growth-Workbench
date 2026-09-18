/**
 * 检查 assets/icons 下所有 PNG 的真实尺寸与是否含彩色像素
 * 用途：定位底部 tabBar 图标"风格不统一/颜色不统一"的根因
 */
const fs = require('fs')
const path = require('path')
const zlib = require('zlib')

const DIR = 'E:/星河宠记/03-源代码/小程序/miniapp/src/assets/icons'

/** 解析 PNG 头，取宽高与位深/颜色类型 */
function readPngHeader(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) return null
  return {
    width: buf.readUInt32BE(16),
    height: buf.readUInt32BE(20),
    bitDepth: buf[24],
    colorType: buf[25], // 0=灰度 2=RGB 3=调色板 4=灰度+A 6=RGBA
  }
}

const COLOR_TYPE_NAME = { 0: '灰度', 2: 'RGB', 3: '调色板', 4: '灰度+A', 6: 'RGBA' }

const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.png')).sort()
console.log('文件'.padEnd(22), '尺寸'.padEnd(12), '色彩类型'.padEnd(10), '字节')
console.log('-'.repeat(58))
const rows = []
for (const f of files) {
  const p = path.join(DIR, f)
  const buf = fs.readFileSync(p)
  const h = readPngHeader(buf)
  if (!h) {
    console.log(f.padEnd(22), '❌ 不是有效 PNG')
    continue
  }
  rows.push({ file: f, ...h, bytes: buf.length })
  console.log(
    f.padEnd(22),
    `${h.width}x${h.height}`.padEnd(12),
    (COLOR_TYPE_NAME[h.colorType] || `?${h.colorType}`).padEnd(10),
    buf.length,
  )
}

// 找出异常项：尺寸不统一 / 过小（可能是空白图）
console.log('\n==== 异常检查 ====')
const sizes = new Set(rows.map((r) => `${r.width}x${r.height}`))
if (sizes.size > 1) {
  console.log(`⚠️ 尺寸不统一，共 ${sizes.size} 种：${[...sizes].join(' / ')}`)
} else {
  console.log(`✅ 尺寸统一：${[...sizes][0]}`)
}
const tiny = rows.filter((r) => r.bytes < 200)
if (tiny.length) {
  console.log(`⚠️ 疑似空白图（<200 字节）：${tiny.map((r) => r.file).join(', ')}`)
}
