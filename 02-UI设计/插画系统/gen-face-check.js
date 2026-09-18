/**
 * 角色一致性精细复核：把 24 张插画的头部区域放大并排，专门看鼻子/眼睛/脸型
 *
 * 【为什么要重做质检】首轮质检是把 24 张缩进一张总览图（每格约 380px）后问视觉模型，
 * 鼻子这种细节在那个尺寸下根本判断不了；且提问方式带倾向性。
 * 这里改成：每张按头部区域放大 2.5 倍、4 列铺开，只盯五官。
 */
const fs = require('fs')
const path = require('path')
const os = require('os')
const { execFileSync } = require('child_process')

const ROOT = 'E:/星河宠记'
const FINAL = `${ROOT}/02-UI设计/插画系统/final`
const WORK = `${ROOT}/02-UI设计/插画系统/preview`
const TMP = path.join(os.tmpdir(), 'xhh-nose-check')
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'

/** 按分组列出（与注册表一致） */
const GROUPS = [
  ['空态', ['empty-timeline', 'empty-checkin', 'empty-pet', 'empty-search', 'empty-photo', 'empty-chart', 'empty-vaccine', 'empty-family', 'empty-achievement', 'empty-message']],
  ['头图', ['header-memoir', 'header-avatar-studio', 'header-health', 'header-family-photo', 'header-naming']],
  ['激励', ['moment-streak-7', 'moment-streak-30', 'moment-birthday', 'moment-anniversary', 'moment-achievement', 'moment-first-checkin']],
  ['分享卡', ['share-card-warm', 'share-card-starry', 'share-card-soft']],
]

const uri = (k) => {
  const p = path.join(FINAL, `${k}.jpg`)
  return fs.existsSync(p) ? `data:image/jpeg;base64,${fs.readFileSync(p).toString('base64')}` : ''
}

function main() {
  fs.mkdirSync(WORK, { recursive: true })
  fs.mkdirSync(TMP, { recursive: true })

  const sections = GROUPS.map(([name, keys]) => {
    const cells = keys
      .map(
        (k) => `<div class="cell">
          <div class="crop"><img src="${uri(k)}"></div>
          <div class="cap">${k}</div>
        </div>`,
      )
      .join('')
    return `<div class="card"><h2>${name}（${keys.length} 张）</h2><div class="grid">${cells}</div></div>`
  }).join('')

  const html = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>角色一致性精细复核</title><style>
*{box-sizing:border-box}
body{margin:0;padding:34px 26px 46px;background:#F7F4F0;color:#3D3833;
  font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;-webkit-font-smoothing:antialiased}
h1{font-size:20px;margin:0 0 6px}
.sub{font-size:12.5px;color:#8C8177;margin:0 0 22px;line-height:1.7}
.card{background:#fff;border-radius:16px;padding:18px 20px;margin-bottom:18px;
  box-shadow:0 2px 12px rgba(120,100,80,.09)}
h2{font-size:14px;margin:0 0 12px}
.grid{display:grid;grid-template-columns:repeat(5,1fr);gap:12px}
.cell{display:flex;flex-direction:column;gap:4px}
/* 2.2 倍放大并对准脸部（头部大致在画面上三分之一处），专门看五官 */
.crop{width:100%;aspect-ratio:1;overflow:hidden;border-radius:10px;background:#FFF6EE}
.crop img{width:220%;margin-left:-60%;margin-top:-16%;display:block}
.cap{font-size:9.5px;color:#C4B8AC;font-family:Consolas,monospace;text-align:center}
</style></head><body>
<h1>角色一致性精细复核 · 头部放大 2.5×</h1>
<p class="sub">专门盯鼻子／眼睛／脸型／毛色。左猫右狗为常态，部分图左右位置会互换。</p>
${sections}
</body></html>`

  const outHtml = path.join(WORK, '角色一致性复核.html')
  fs.writeFileSync(outHtml, html, 'utf8')
  const tmpHtml = path.join(TMP, 'p.html')
  fs.writeFileSync(tmpHtml, html, 'utf8')
  const outPng = path.join(WORK, '角色一致性复核.png')
  execFileSync(
    EDGE,
    ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=2',
     '--window-size=1300,1500', '--virtual-time-budget=8000',
     `--screenshot=${outPng}`, 'file:///' + tmpHtml.replace(/\\/g, '/')],
    { stdio: 'ignore', timeout: 180000 },
  )
  console.log(`✅ ${outHtml}`)
  console.log(`✅ ${outPng}`)
}

main()
