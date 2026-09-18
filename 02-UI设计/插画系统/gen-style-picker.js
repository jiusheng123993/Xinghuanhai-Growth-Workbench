/**
 * 生成「插画风格选型」对比页
 *
 * 三块：
 *   1. 现状诊断：现有 7 张品牌插画的风格冲突
 *   2. 候选样图：3D 黏土 vs 柔和扁平（同角色同场景，只换画风）
 *   3. 放进真实空态里看效果（插画单看和放进界面是两回事）
 *
 * 图片用 JS 变量内联一次、多处复用，避免同一张图重复 base64 撑大 HTML。
 */
const fs = require('fs')
const path = require('path')
const os = require('os')
const { execFileSync } = require('child_process')

const ROOT = 'E:/星河宠记'
const SAMPLES = `${ROOT}/02-UI设计/插画系统/samples`
const WORK = `${ROOT}/02-UI设计/插画系统/preview`
const TMP = path.join(os.tmpdir(), 'xhh-illus-preview')
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'

const b64 = (p) => fs.readFileSync(p).toString('base64')

function main() {
  fs.mkdirSync(WORK, { recursive: true })
  fs.mkdirSync(TMP, { recursive: true })

  const imgA = `data:image/jpeg;base64,${b64(path.join(SAMPLES, 'A-3d-clay.jpg'))}`
  const imgB = `data:image/jpeg;base64,${b64(path.join(SAMPLES, 'B-soft-flat.jpg'))}`

  /** 时光线空态（几何取自真实 SCSS：padding 120rpx 60rpx → 60px 30px） */
  const emptyState = (imgVar, label) => `
    <div class="phone">
      <div class="navbar"><div class="nav-title">时光</div>
        <div class="capsule"><span>•••</span><span class="ring"></span></div></div>
      <div class="screen">
        <div class="hdr">
          <div><div class="hdr-t">可乐的时光线</div><div class="hdr-s">记录每一刻温暖时光</div></div>
          <div class="pill"><span>＋</span><span>记录</span></div>
        </div>
        <div class="ov">
          <div class="ov-i"><div class="ov-v">365</div><div class="ov-l">陪伴天数</div></div>
          <div class="ov-d"></div>
          <div class="ov-i"><div class="ov-v">0</div><div class="ov-l">时光记录</div></div>
          <div class="ov-d"></div>
          <div class="ov-i"><div class="ov-v">0</div><div class="ov-l">珍藏照片</div></div>
        </div>
        <div class="tl-title">时光足迹</div>
        <div class="empty">
          ${imgVar ? `<img class="empty-illus" data-src="${imgVar}" alt="">` : `<div class="empty-icon">✎</div>`}
          <div class="empty-t">还没有时光记录</div>
          <div class="empty-d">点右上角「记录」，写下可乐的第一个珍贵瞬间</div>
        </div>
        <div class="cta"><span>＋</span><span>添加时光记录</span></div>
      </div>
    </div>
    <div class="plabel">${label}</div>`

  const html = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>插画风格选型</title><style>*{box-sizing:border-box}
body{margin:0;padding:42px 34px 60px;background:#F7F4F0;color:#3D3833;
  font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;-webkit-font-smoothing:antialiased}
h1{font-size:23px;margin:0 0 8px}
.sub{font-size:13.5px;color:#8C8177;margin:0 0 30px;line-height:1.75}
h2{font-size:17px;margin:0 0 8px;display:flex;align-items:center;gap:9px}
h2 .n{display:inline-flex;align-items:center;justify-content:center;width:23px;height:23px;
  border-radius:50%;background:#FF6B3D;color:#fff;font-size:13px;font-weight:700;flex-shrink:0}
.card{background:#fff;border-radius:20px;padding:26px 28px;margin-bottom:24px;
  box-shadow:0 2px 16px rgba(120,100,80,.09)}
.lead{font-size:13px;color:#9A8F84;margin:0 0 20px;line-height:1.85}
.lead code{background:#F2EDE7;border-radius:4px;padding:1px 5px;font-size:12px}
.lead b{color:#C4472A}
table{width:100%;border-collapse:collapse;font-size:12.5px}
th,td{text-align:left;padding:9px 10px;border-bottom:1px solid #F0EAE3;vertical-align:top}
th{color:#9A8F84;font-weight:600;font-size:11.5px}

/* 两张样图并排 */
.samples{display:flex;gap:26px;justify-content:center;flex-wrap:wrap}
.samp{width:330px;display:flex;flex-direction:column;gap:10px;align-items:center}
.samp img{width:100%;border-radius:18px;display:block;box-shadow:0 4px 18px rgba(90,70,50,.12)}
.samp .name{font-size:14px;font-weight:600;color:#3D3833}
.samp .desc{font-size:12px;color:#9A8F84;text-align:center;line-height:1.7}
.tag{font-size:11px;padding:3px 11px;border-radius:20px;font-weight:600}
.tag.a{background:#FFF1E8;color:#C4472A}
.tag.b{background:#EAF3FF;color:#2B6CB0}

/* 手机屏 */
.phones{display:flex;gap:24px;justify-content:center;align-items:flex-start;flex-wrap:wrap}
.pwrap{display:flex;flex-direction:column;align-items:center;gap:10px}
.phone{width:300px;border-radius:34px;overflow:hidden;background:#fff;
  box-shadow:0 8px 30px rgba(90,70,50,.16);border:1px solid rgba(0,0,0,.05)}
.navbar{height:38px;display:flex;align-items:center;justify-content:center;position:relative;background:#FFF6EE}
.nav-title{font-size:14px;font-weight:600;color:#1a1a1a}
.capsule{position:absolute;right:10px;top:8px;width:70px;height:22px;border-radius:11px;
  border:1px solid rgba(0,0,0,.08);display:flex;align-items:center;justify-content:space-around;
  background:rgba(255,255,255,.6);font-size:9px;color:#333}
.ring{width:11px;height:11px;border-radius:50%;border:1.5px solid #333}
.screen{height:560px;padding-bottom:14px;overflow:hidden;
  background:linear-gradient(180deg,#FFFDF9 0%,#FFF6EE 40%,#FFEDE0 100%)}
.hdr{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:22px 16px 6px}
.hdr-t{font-size:20px;font-weight:700;color:#40281C;line-height:1.2}
.hdr-s{margin-top:5px;font-size:10.5px;color:#B69B83}
.pill{flex-shrink:0;display:flex;align-items:center;gap:3px;height:26px;padding:0 11px;border-radius:999px;
  background:linear-gradient(135deg,#FFA082,#FF6B3D);color:#fff;font-size:11px;font-weight:600;
  box-shadow:0 5px 14px -4px rgba(255,107,61,.35)}
.ov{display:flex;align-items:center;margin:4px 13px 12px;padding:10px 3px;border-radius:22px;background:#fff;
  box-shadow:0 3px 16px -5px rgba(61,33,18,.08),0 0 10px rgba(255,107,61,.14)}
.ov-i{flex:1;display:flex;flex-direction:column;align-items:center;gap:2px}
.ov-v{font-size:16px;font-weight:700;color:#40281C;line-height:1.1}
.ov-l{font-size:9px;color:#B69B83}
.ov-d{width:1px;height:22px;background:#F3E2D2}
.tl-title{font-size:15px;font-weight:700;color:#40281C;margin:0 16px 12px}
.empty{display:flex;flex-direction:column;align-items:center;text-align:center;padding:20px 30px}
.empty-icon{font-size:40px;margin-bottom:12px;color:#8B6E58;opacity:.55}
.empty-illus{width:150px;height:150px;object-fit:contain;border-radius:14px;margin-bottom:10px;
  mix-blend-mode:multiply}
.empty-t{font-size:15px;font-weight:600;color:#40281C;margin-bottom:6px}
.empty-d{font-size:11px;color:#B69B83;line-height:1.6}
.cta{display:flex;align-items:center;justify-content:center;gap:6px;height:46px;border-radius:999px;
  margin:14px 16px 0;background:linear-gradient(135deg,#FFA082,#FF6B3D);color:#fff;font-size:13px;font-weight:600;
  box-shadow:0 5px 14px -4px rgba(255,107,61,.35)}
.plabel{font-size:12px;font-weight:600;color:#5C5349}
.note{font-size:12px;color:#9A8F84;line-height:1.8;margin-top:18px}
.note b{color:#C4472A}
</style></head><body>

<h1>插画风格选型</h1>
<p class="sub">针对你的判断「我们没那么好看是因为图片不够多」——核查后的结论：<b>数量确实少，但更致命的是风格没成体系</b></p>

<div class="card">
  <h2><span class="n">1</span>现状：不是图少，是图在"打架"</h2>
  <p class="lead">
    全项目 47 个页面，真正的品牌插画<b>只有 7 张</b>（登录主图 2、logo 3、品牌 IP 1、角标 1），
    其余全是图标和 20 张宠物预选头像 —— 绝大多数页面和空态<b>一张插画都没有</b>，你说得对。<br><br>
    但更值得注意的是：现有这几张<b>自己就不统一</b>。品牌 IP（<code>logo-catdog-01.png</code>，首页在用）
    是 3D 黏土毛绒质感；而登录主视觉的生成提示词里写的是「柔和扁平质感」——
    两套画风在同一个 App 里并存。所以<b>不能盲目加图</b>，否则只会更乱。
  </p>
  <table>
    <tr><th>现有资产</th><th>实际画风</th><th>用在哪</th></tr>
    <tr><td><code>logo-catdog-01.png</code></td><td>3D 黏土毛绒</td><td>首页 Hero / 空态 IP</td></tr>
    <tr><td><code>auth-hero.png</code> / <code>login-hero.png</code></td><td>柔和扁平插画</td><td>登录页主视觉</td></tr>
    <tr><td><code>preset-home/cat·dog</code> 20 张</td><td>3D 黏土（与 IP 同源）</td><td>宠物默认头像</td></tr>
    <tr><td>其余 44 个页面</td><td colspan="2"><b>零插画</b></td></tr>
  </table>
  <p class="note">
    顺带修掉一个资产管线的坑：<code>auth-hero.png</code> / <code>login-hero.png</code> 实际是
    <b>JPEG 字节却命名为 .png</b>。根因是 Seedream 返回的就是 JPEG，而生成脚本直接按 .png 存盘。
  </p>
</div>

<div class="card">
  <h2><span class="n">2</span>候选样图：同角色 · 同场景 · 只换画风</h2>
  <p class="lead">
    已经用项目自己的 Seedream 出了一组对照样图（同一只橘猫 + 同一只奶油金毛、同样望着摊开的空白相册）。
    提示词按《pet-prompt-engine》技能公式组装，角色与数量都做了锁定。
  </p>
  <div class="samples">
    <div class="samp">
      <img data-src="A" alt="">
      <span class="tag a">方案 A</span>
      <div class="name">3D 黏土毛绒</div>
      <div class="desc">与现有品牌 IP、20 张预选头像<b>同源</b><br>质感高级、有体积感，像皮克斯短片</div>
    </div>
    <div class="samp">
      <img data-src="B" alt="">
      <span class="tag b">方案 B</span>
      <div class="name">柔和扁平插画</div>
      <div class="desc">与现有登录主视觉同源<br>绘本感、轻盈，小星点呼应「星河」品牌名</div>
    </div>
  </div>
</div>

<div class="card">
  <h2><span class="n">3</span>放进真实空态里看（这才是决定性的）</h2>
  <p class="lead">
    以刚优化过的「时光线」空态为例 —— 它现在只有一个小图标加两行字。
    插画单看好看不代表放进界面好看，所以这里按真实布局（几何取自实际 SCSS）排了三版。
  </p>
  <div class="phones">
    <div class="pwrap">${emptyState('', '现状：只有图标 + 文字')}</div>
    <div class="pwrap">${emptyState('A', '方案 A：3D 黏土')}</div>
    <div class="pwrap">${emptyState('B', '方案 B：柔和扁平')}</div>
  </div>
  <p class="note">
    注：预览里做了 <code>mix-blend-mode: multiply</code> 让插画奶油底融入页面暖色背景；
    真机上会改用<b>透明底 PNG</b>，效果更干净。
  </p>
</div>

<script>
var IMGS = { A: ${JSON.stringify(imgA)}, B: ${JSON.stringify(imgB)} };
document.querySelectorAll('img[data-src]').forEach(function (el) {
  var k = el.getAttribute('data-src');
  if (IMGS[k]) el.src = IMGS[k];
});
</script>
</body></html>`

  const outHtml = path.join(WORK, '插画风格选型.html')
  fs.writeFileSync(outHtml, html, 'utf8')
  const tmpHtml = path.join(TMP, 'preview.html')
  fs.writeFileSync(tmpHtml, html, 'utf8')
  const outPng = path.join(WORK, '插画风格选型.png')
  execFileSync(
    EDGE,
    ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=2',
     '--window-size=1180,2000', '--virtual-time-budget=8000',
     `--screenshot=${outPng}`, 'file:///' + tmpHtml.replace(/\\/g, '/')],
    { stdio: 'ignore', timeout: 180000 },
  )
  console.log(`✅ HTML: ${outHtml}`)
  console.log(`✅ PNG : ${outPng}`)
}

main()
