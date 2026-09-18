/**
 * 角色一致性复核（分组出图 · 3 列大图）
 *
 * 【为什么推倒重做】
 *   首轮用「24 张缩略图 → 问视觉模型」做质检，结论「24 张角色全一致」是错的：
 *   ① 缩略图每格仅约 380px，鼻子级细节根本不可辨；
 *   ② 提问方式带倾向性（"哪些明显不像同一组角色"）；
 *   ③ 复审时要求 VLM 逐格描述，它对 20 格给出了几乎逐字相同的模板化回答，
 *      证明它并未真的在看细节 —— **VLM 不适合作这类细粒度一致性判据**。
 *   改为：按组切分、每组 3 列、脸部放大 2.2×，由人（我）逐张肉眼比对。
 */
const fs = require('fs')
const path = require('path')
const os = require('os')
const { execFileSync } = require('child_process')

const ROOT = 'E:/星河宠记'
const FINAL = `${ROOT}/02-UI设计/插画系统/final`
const WORK = `${ROOT}/02-UI设计/插画系统/preview/facecheck`
const TMP = path.join(os.tmpdir(), 'xhh-facecheck')
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'

const GROUPS = {
  empty: ['empty-timeline', 'empty-checkin', 'empty-pet', 'empty-search', 'empty-photo', 'empty-chart', 'empty-vaccine', 'empty-family', 'empty-achievement', 'empty-message'],
  header: ['header-memoir', 'header-avatar-studio', 'header-health', 'header-family-photo', 'header-naming'],
  moment: ['moment-streak-7', 'moment-streak-30', 'moment-birthday', 'moment-anniversary', 'moment-achievement', 'moment-first-checkin'],
  share: ['share-card-warm', 'share-card-starry', 'share-card-soft'],
}

const uri = (k) => {
  const p = path.join(FINAL, `${k}.jpg`)
  return fs.existsSync(p) ? `data:image/jpeg;base64,${fs.readFileSync(p).toString('base64')}` : ''
}

function sheet(name, keys) {
  const cells = keys
    .map(
      (k) => `<div class="cell">
        <div class="crop"><img src="${uri(k)}"></div>
        <div class="cap">${k}</div>
      </div>`,
    )
    .join('')
  return `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>${name}</title><style>
body{margin:0;padding:16px;background:#F7F4F0;
  font-family:-apple-system,"PingFang SC",sans-serif}
.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}
.cell{display:flex;flex-direction:column;gap:5px}
.crop{width:100%;aspect-ratio:1;overflow:hidden;border-radius:12px;background:#FFF6EE;
  border:1px solid rgba(0,0,0,.06)}
.crop img{width:220%;margin-left:-60%;margin-top:-16%;display:block}
.cap{font-size:13px;color:#8C8177;font-family:Consolas,monospace;text-align:center}
</style></head><body><div class="grid">${cells}</div></body></html>`
}

function main() {
  fs.mkdirSync(WORK, { recursive: true })
  fs.mkdirSync(TMP, { recursive: true })

  for (const [name, keys] of Object.entries(GROUPS)) {
    const html = sheet(name, keys)
    const tmpHtml = path.join(TMP, `${name}.html`)
    fs.writeFileSync(tmpHtml, html, 'utf8')
    const outPng = path.join(WORK, `${name}.png`)
    // 高度必须按行数算：3 列布局下每格约 447px 宽 + 说明行，
    // 写死 900 只会截到前两行 —— 上一版就是这样漏看了 10 张里的后 4 张
    const cols = 3
    const rows = Math.ceil(keys.length / cols)
    const height = rows * 470 + 60
    execFileSync(
      EDGE,
      ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=2',
       `--window-size=1400,${height}`, '--virtual-time-budget=6000',
       `--screenshot=${outPng}`, 'file:///' + tmpHtml.replace(/\\/g, '/')],
      { stdio: 'ignore', timeout: 120000 },
    )
    console.log(`✅ ${name}（${keys.length} 张 · ${rows} 行 · 画布 1400x${height}）`)
  }
}

main()
