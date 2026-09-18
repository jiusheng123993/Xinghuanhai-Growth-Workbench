/**
 * 只处理本次新增的 6 张「宫格插画」，产出到 插画系统/final/
 *
 * 【为什么不直接跑 postprocess.mjs】那个脚本会把 generated/ 下**全部** 30 张重新压一遍、
 * 并覆盖 final/ 里的同名文件 —— 其中 page-* 三张是**并行会话**产出且已上线的头图，
 * 本地 generated/ 里的同名文件是不同变体，覆盖过去会给他们制造麻烦。
 * 所以这里只挑 grid-*.jpg，一次只碰自己的 6 张。
 *
 * 【尺寸】沿用插画系统对正方形插画的规格：600px 宽、q86（与空态/激励一档）。
 *   卡片里展示约 106pt（@3x ≈ 318px），600px 有充足余量；单张目标 ≤100KB。
 *
 * 用法：node postprocess-grid.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const require = createRequire('E:/星河宠记/03-源代码/server/')
const Jimp = require('jimp')

const IN_DIR = path.join(__dirname, 'generated')
const OUT_DIR = path.join(__dirname, 'final')
const TARGET_WIDTH = 600
const QUALITY = 86

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true })
  const files = fs.readdirSync(IN_DIR).filter((f) => /^grid-.*\.(jpe?g|png)$/i.test(f))
  if (!files.length) {
    console.error('❌ generated/ 里没有 grid-*.jpg')
    process.exit(1)
  }

  console.log(`处理 ${files.length} 张\n`)
  let totalIn = 0
  let totalOut = 0

  for (const f of files) {
    const key = f.replace(/\.(jpe?g|png)$/i, '')
    const inPath = path.join(IN_DIR, f)
    const inBytes = fs.statSync(inPath).size
    totalIn += inBytes

    const img = await Jimp.read(inPath)
    const ow = img.getWidth()
    const oh = img.getHeight()
    if (ow > TARGET_WIDTH) img.resize(TARGET_WIDTH, Jimp.AUTO)

    const buf = await img.quality(QUALITY).getBufferAsync(Jimp.MIME_JPEG)
    fs.writeFileSync(path.join(OUT_DIR, `${key}.jpg`), buf)
    totalOut += buf.length

    console.log(
      `  ${String(ow).padStart(4)}×${String(oh).padEnd(5)} ${String(Math.round(inBytes / 1024)).padStart(4)}KB  →  ` +
        `${String(img.getWidth()).padStart(4)}×${String(img.getHeight()).padEnd(5)} ${String(Math.round(buf.length / 1024)).padStart(4)}KB  ${key}.jpg`,
    )
  }

  console.log(
    `\n合计 ${(totalIn / 1024 / 1024).toFixed(1)}MB → ${(totalOut / 1024).toFixed(0)}KB` +
      `（省 ${((1 - totalOut / totalIn) * 100).toFixed(0)}%）→ ${OUT_DIR}`,
  )
}

main().catch((e) => {
  console.error('❌', e.message)
  process.exit(1)
})
