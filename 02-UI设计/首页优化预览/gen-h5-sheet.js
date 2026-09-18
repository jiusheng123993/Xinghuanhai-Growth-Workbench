/**
 * 把真实页面截图拼成总览，用于整体审阅
 */
const fs = require('fs')
const path = require('path')
const os = require('os')
const { execFileSync } = require('child_process')

const DIR = 'E:/星河宠记/02-UI设计/首页优化预览/h5-real'
const WORK = 'E:/星河宠记/02-UI设计/首页优化预览'
const TMP = path.join(os.tmpdir(), 'xhh-h5-sheet')
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'

const PAGES = [
  ['home', '今天（已改）'],
  ['creative', '创作（改中）'],
  ['timeline', '时光（已改）'],
  ['pet', '宠物档案'],
  ['mine', '我的'],
  ['family', '家庭'],
  ['checkin', '健康打卡'],
  ['vaccine', '疫苗日历'],
  ['trends', '健康趋势'],
  ['achievement', '成就'],
  ['chronic', '慢病追踪'],
  ['healthreport', '健康报告'],
  ['lineage', '家庭图谱'],
  ['memoir', '回忆录馆'],
  ['settings', '设置'],
]

const uri = (k) => {
  const p = path.join(DIR, `${k}.png`)
  return fs.existsSync(p) ? `data:image/png;base64,${fs.readFileSync(p).toString('base64')}` : ''
}

function main() {
  fs.mkdirSync(TMP, { recursive: true })
  const cells = PAGES.map(
    ([k, name]) => `<div class="pw">
      <div class="phone"><img src="${uri(k)}"></div>
      <div class="cap">${name}</div>
    </div>`,
  ).join('')

  const html = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>真实页面总览</title><style>
*{box-sizing:border-box}
body{margin:0;padding:26px 22px 36px;background:#EDEAE6;
  font-family:-apple-system,"PingFang SC",sans-serif}
h1{font-size:19px;margin:0 0 5px;color:#2E2A26}
.sub{font-size:12px;color:#7C736A;margin:0 0 20px;line-height:1.6}
.grid{display:grid;grid-template-columns:repeat(5,1fr);gap:18px}
.pw{display:flex;flex-direction:column;gap:7px}
.phone{border-radius:18px;overflow:hidden;background:#fff;
  box-shadow:0 4px 16px rgba(0,0,0,.13)}
.phone img{width:100%;display:block}
.cap{font-size:12px;font-weight:600;color:#4A423A;text-align:center}
</style></head><body>
<h1>真实页面总览（H5 构建实拍，非手搓模拟）</h1>
<p class="sub">15 个页面 · 375×812 @2x · 供判断「其他页面到底变了没有」</p>
<div class="grid">${cells}</div>
</body></html>`

  const outHtml = path.join(WORK, '真实页面总览.html')
  fs.writeFileSync(outHtml, html, 'utf8')
  const tmpHtml = path.join(TMP, 'p.html')
  fs.writeFileSync(tmpHtml, html, 'utf8')
  const outPng = path.join(WORK, '真实页面总览.png')
  execFileSync(
    EDGE,
    ['--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
     '--force-device-scale-factor=1', '--window-size=1820,1560',
     '--virtual-time-budget=15000', `--user-data-dir=${path.join(TMP, 'prof')}`,
     `--screenshot=${outPng}`, 'file:///' + tmpHtml.replace(/\\/g, '/')],
    { stdio: 'ignore', timeout: 180000 },
  )
  console.log(`✅ ${outHtml}`)
  console.log(`✅ ${outPng}`)
}

main()
