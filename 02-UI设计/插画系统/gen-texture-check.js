/**
 * 品牌质感比对页：现有品牌 IP vs 新插画
 *
 * 目的：用户最初的抱怨就是「风格不统一」。若新插画与首页在用的品牌 IP
 * 质感对不上，就等于把老毛病又犯一遍。这里并排放大看，用肉眼判断。
 */
const fs = require('fs')
const path = require('path')
const os = require('os')
const { execFileSync } = require('child_process')

const ROOT = 'E:/星河宠记'
const IP = `${ROOT}/03-源代码/小程序/miniapp/src/assets/logo-catdog-01.png`
const NEW1 = `${ROOT}/02-UI设计/插画系统/generated/v1-empty-album.jpg`
const NEW4 = `${ROOT}/02-UI设计/插画系统/generated/v4-header-memoir.jpg`
const WORK = `${ROOT}/02-UI设计/插画系统/preview`
const TMP = path.join(os.tmpdir(), 'xhh-texture-check')
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'

const uri = (p, mime) => `data:${mime};base64,${fs.readFileSync(p).toString('base64')}`

function main() {
  fs.mkdirSync(WORK, { recursive: true })
  fs.mkdirSync(TMP, { recursive: true })

  const ip = uri(IP, 'image/png')
  const n1 = uri(NEW1, 'image/jpeg')

  const html = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>品牌质感比对</title><style>
*{box-sizing:border-box}
body{margin:0;padding:38px 32px 52px;background:#F7F4F0;color:#3D3833;
  font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;-webkit-font-smoothing:antialiased}
h1{font-size:21px;margin:0 0 6px}
.sub{font-size:13px;color:#8C8177;margin:0 0 26px;line-height:1.7}
.card{background:#fff;border-radius:18px;padding:24px 26px;margin-bottom:22px;
  box-shadow:0 2px 14px rgba(120,100,80,.09)}
h2{font-size:15px;margin:0 0 6px}
.lead{font-size:12.5px;color:#9A8F84;margin:0 0 18px;line-height:1.8}
.lead code{background:#F2EDE7;border-radius:4px;padding:1px 5px;font-size:11.5px}
.row{display:flex;gap:22px;align-items:flex-start}
.figure{flex:1;display:flex;flex-direction:column;gap:8px}
.figure img{width:100%;border-radius:14px;display:block;background:#FFF6EE}
.figure .cap{font-size:12px;color:#5C5349;font-weight:600}
.figure .meta{font-size:11px;color:#A79C91;line-height:1.6}
.zoom{display:flex;gap:18px;align-items:flex-start}
.crop{flex:1;border-radius:14px;overflow:hidden;border:1px solid #EDE6DE}
.crop img{display:block;width:100%}
.cap2{font-size:11px;color:#A79C91;text-align:center;margin-top:6px}
.verdict{font-size:13px;line-height:1.9;color:#5C5349;margin:0}
.verdict b{color:#C4472A}
.verdict .ok{color:#2E7D46;font-weight:600}
</style></head><body>

<h1>品牌质感比对：现有 IP vs 新插画</h1>
<p class="sub">确认新插画是否接得上首页正在用的品牌 IP。接不上就等于把「风格打架」的老毛病再犯一遍。</p>

<div class="card">
  <h2>整体并排</h2>
  <p class="lead">左边是首页 Hero 与空态在用的品牌 IP（<code>logo-catdog-01.png</code>），右边是新生成的插画。</p>
  <div class="row">
    <div class="figure">
      <img src="${ip}" alt="">
      <div class="cap">现有品牌 IP（logo-catdog-01.png）</div>
      <div class="meta">256×256 · 用在首页 Hero、对话空态</div>
    </div>
    <div class="figure">
      <img src="${n1}" alt="">
      <div class="cap">新插画（v1 空态）</div>
      <div class="meta">1024×1024 · 同角色、同配色</div>
    </div>
  </div>
</div>

<div class="card">
  <h2>放大看表面质感</h2>
  <p class="lead">这是决定性的细节。注意毛发的处理方式。</p>
  <div class="zoom">
    <div style="flex:1">
      <div class="crop" style="height:300px;display:flex;align-items:center;justify-content:center;background:#FFF6EE">
        <img src="${ip}" style="width:150%;margin-left:-5%" alt="">
      </div>
      <div class="cap2">现有 IP：光滑底 + 顺向短毛，偏「磨砂塑胶 / 高级树脂」</div>
    </div>
    <div style="flex:1">
      <div class="crop" style="height:300px">
        <img src="${n1}" style="width:230%;margin-left:-18%;margin-top:-14%" alt="">
      </div>
      <div class="cap2">新插画：可见羊毛毡纤维与圈绒，偏「手工毛毡玩偶」</div>
    </div>
  </div>
</div>

<div class="card">
  <h2>结论</h2>
  <p class="verdict">
    两个是<b>同一组角色</b>（橘虎斑猫 + 奶油卷毛狗）、<b>同一配色</b>、<b>同为 3D 软材质</b>，
    所以放在一起不会「打架」。<br>
    差别只在表面处理：IP 是<span class="ok">光滑磨砂</span>，新插画是<span class="ok">羊毛毡纤维</span>。
    这属于同风格的两种表现，肉眼在 150~250px 的展示尺寸下几乎分不出来。<br><br>
    可选做法：<br>
    ① <b>保持现状</b> —— IP 作 logo 略光滑、插画作内容带绒毛，属合理分工，零改动；<br>
    ② <b>把 IP 也重出一版毛毡质感</b> —— 全站质感 100% 统一，但首页 Hero 与对话空态的观感会变，
    且需重新确认品牌形象（1 张图，成本很低）。
  </p>
</div>

</body></html>`

  const outHtml = path.join(WORK, '质感比对.html')
  fs.writeFileSync(outHtml, html, 'utf8')
  const tmpHtml = path.join(TMP, 'p.html')
  fs.writeFileSync(tmpHtml, html, 'utf8')
  const outPng = path.join(WORK, '质感比对.png')
  execFileSync(
    EDGE,
    ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=2',
     '--window-size=900,1700', '--virtual-time-budget=6000',
     `--screenshot=${outPng}`, 'file:///' + tmpHtml.replace(/\\/g, '/')],
    { stdio: 'ignore', timeout: 120000 },
  )
  console.log(`✅ ${outHtml}`)
  console.log(`✅ ${outPng}`)
}

main()
