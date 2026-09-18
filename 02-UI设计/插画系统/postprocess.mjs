/**
 * 插画后处理：缩尺寸 + 压缩
 *
 * 【为什么要后处理】Seedream 直出 1024×1024 / 1280×720，单张 300~380KB。
 * 小程序里空态插画展示尺寸只有 150~180pt（@3x 约 540px），头图满宽约 343pt（@3x 约 1030px），
 * 原图分辨率严重过剩；而且毛毡质感的细密纤维在 JPEG 下很吃码率，
 * 不缩尺寸直接上线会让每张图拖到 350KB，弱网下就是一片空白。
 *
 * 【目标】空态/激励 600px、头图 960px 宽，q86 左右，单张控制在 100KB 内。
 *
 * 【jimp 从哪来】小程序侧没装图像库，用 server 的 node_modules（jimp 0.22.12，
 * 与 imageBadge.ts 同一套依赖），通过 createRequire 指过去解析。
 *
 * 用法：node postprocess.mjs
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

/** 每类插画的目标宽度（等比缩放） */
const TARGET = {
  empty: { width: 600, quality: 86 },
  moment: { width: 600, quality: 86 },
  header: { width: 960, quality: 86 },
  share: { width: 750, quality: 84 },
  brand: { width: 512, quality: 88 },
  validate: { width: 600, quality: 86 },
  // 页面头图（PageHero 整幅 aspectFit 展示，比横幅卡看得更"全"，给高一点分辨率）
  page: { width: 900, quality: 86 },
}

function targetFor(key) {
  if (key.startsWith('empty-')) return TARGET.empty
  if (key.startsWith('header-')) return TARGET.header
  if (key.startsWith('moment-')) return TARGET.moment
  if (key.startsWith('share-')) return TARGET.share
  if (key.startsWith('brand-')) return TARGET.brand
  if (key.startsWith('page-')) return TARGET.page
  return TARGET.validate
}

async function main() {
  if (!fs.existsSync(IN_DIR)) {
    console.error(`❌ 没有生成目录：${IN_DIR}`)
    process.exit(1)
  }
  fs.mkdirSync(OUT_DIR, { recursive: true })

  const files = fs.readdirSync(IN_DIR).filter((f) => /\.(jpe?g|png)$/i.test(f))
  if (!files.length) {
    console.error('❌ generated 目录里没有图片')
    process.exit(1)
  }

  console.log(`处理 ${files.length} 张\n`)
  console.log('  原尺寸      原大小   →   新尺寸      新大小   压缩率   文件')

  let totalIn = 0
  let totalOut = 0
  const rows = []

  for (const f of files) {
    const key = f.replace(/\.(jpe?g|png)$/i, '')
    const t = targetFor(key)
    const inPath = path.join(IN_DIR, f)
    const inBytes = fs.statSync(inPath).size
    totalIn += inBytes

    const img = await Jimp.read(inPath)
    const ow = img.getWidth()
    const oh = img.getHeight()

    if (ow > t.width) img.resize(t.width, Jimp.AUTO)

    const outName = `${key}.jpg`
    const outPath = path.join(OUT_DIR, outName)
    const buf = await img.quality(t.quality).getBufferAsync(Jimp.MIME_JPEG)
    fs.writeFileSync(outPath, buf)

    totalOut += buf.length
    rows.push({ key, outName, bytes: buf.length, w: img.getWidth(), h: img.getHeight() })

    const ratio = ((1 - buf.length / inBytes) * 100).toFixed(0)
    console.log(
      `  ${String(ow).padStart(4)}×${String(oh).padEnd(5)} ${String(Math.round(inBytes / 1024)).padStart(5)}KB  →  ` +
        `${String(img.getWidth()).padStart(4)}×${String(img.getHeight()).padEnd(5)} ${String(Math.round(buf.length / 1024)).padStart(5)}KB  ` +
        `${String(ratio).padStart(4)}%   ${outName}`,
    )
  }

  const over = rows.filter((r) => r.bytes > 100 * 1024)
  console.log(
    `\n合计 ${(totalIn / 1024 / 1024).toFixed(1)}MB → ${(totalOut / 1024 / 1024).toFixed(1)}MB` +
      `（省 ${((1 - totalOut / totalIn) * 100).toFixed(0)}%）`,
  )
  console.log(
    over.length
      ? `⚠️ 超过 100KB 的有 ${over.length} 张：${over.map((r) => `${r.key}(${Math.round(r.bytes / 1024)}KB)`).join(', ')}`
      : `✅ 全部 ≤100KB`,
  )

  fs.writeFileSync(
    path.join(OUT_DIR, 'inventory.json'),
    JSON.stringify(rows.sort((a, b) => a.key.localeCompare(b.key)), null, 2),
    'utf8',
  )
  console.log(`\n清单：${path.join(OUT_DIR, 'inventory.json')}`)
}

main().catch((e) => {
  console.error('❌', e.message)
  process.exit(1)
})
