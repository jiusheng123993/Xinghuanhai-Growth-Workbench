/**
 * 生成「时光页优化 + 回忆录入口收口」效果对比图
 *
 * 一块内容：
 *   A. 时光页 改造前 vs 改造后（并排手机屏）
 *   B. 回忆录馆「年度回顾」从假占位变成真功能
 *
 * 几何数值全部取自真实 SCSS（rpx ÷ 2 = px，750rpx 设计稿 @ 375px 屏），
 * 图标用真实 icons-fill.ts 路径渲染，颜色注入与 Icon.tsx 一致。
 */
const fs = require('fs')
const path = require('path')
const os = require('os')
const { execFileSync } = require('child_process')

const ROOT = 'E:/星河宠记'
const ICONS_FILL = `${ROOT}/03-源代码/小程序/miniapp/src/components/icons-fill.ts`
const WORK = `${ROOT}/02-UI设计/首页优化预览/timeline-preview`
const TMP = path.join(os.tmpdir(), 'xhh-timeline-preview')
const ICON_DIR = path.join(TMP, 'icons')
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'

/** 渲染一个 Phosphor Fill 图标 → PNG 文件，返回路径 */
function renderIcon(name, color, size = 32) {
  const src = fs.readFileSync(ICONS_FILL, 'utf8')
  const m = new RegExp(`'${name}':\\s*'([^']+)'`).exec(src)
  if (!m) throw new Error(`icons-fill.ts 里找不到 ${name}`)
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 256 256" fill="${color}">${m[1]}</svg>`
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>html,body{margin:0;width:${size}px;height:${size}px;overflow:hidden;background:transparent}svg{display:block}</style></head><body>${svg}</body></html>`
  const hp = path.join(ICON_DIR, `${name}-${color.replace('#', '')}-${size}.html`)
  const pp = path.join(ICON_DIR, `${name}-${color.replace('#', '')}-${size}.png`)
  fs.writeFileSync(hp, html, 'utf8')
  if (!fs.existsSync(pp)) {
    execFileSync(
      EDGE,
      ['--headless', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=2',
       '--default-background-color=00000000', `--window-size=${size},${size}`,
       '--virtual-time-budget=2000', `--screenshot=${pp}`, 'file:///' + hp.replace(/\\/g, '/')],
      { stdio: 'ignore', timeout: 60000 },
    )
  }
  return pp
}

const uri = (p) => `data:image/png;base64,${fs.readFileSync(p).toString('base64')}`

/** 顶部原生导航栏（模拟微信） */
const navbar = (title) => `<div class="navbar">
  <div class="navbar-title">${title}</div>
  <div class="navbar-capsule"><span class="dots">•••</span><span class="circle"></span></div>
</div>`

/** 页头：改造前是悬空裸 + 圆圈；改造后是渐变胶囊 */
function header(mode) {
  const btn =
    mode === 'before'
      ? `<div class="add-round">＋</div>`
      : `<div class="add-pill"><img src="${uri(renderIcon('plus', '#FFFFFF', 32))}"><span>记录</span></div>`
  return `<div class="hdr">
    <div class="hdr-left">
      <div class="hdr-title">可乐的时光线</div>
      <div class="hdr-sub">记录每一刻温暖时光</div>
    </div>
    ${btn}
  </div>`
}

/** 改造前：回忆精选三张大卡（横向滚动，第二张被裁切） */
function featured() {
  const card = (grad, title, desc) =>
    `<div class="feat-card" style="background:${grad}">
      <div class="feat-glow"></div>
      <div class="feat-icon"></div>
      <div class="feat-text"><div class="feat-title">${title}</div><div class="feat-desc">${desc}</div></div>
    </div>`
  return `<div class="feat">
    <div class="feat-head"><span class="feat-head-title">回忆精选</span><span class="feat-head-hint">左右滑动查看</span></div>
    <div class="feat-scroll">
      ${card('linear-gradient(135deg,#FFA082,#FF6B3D)', '年度回忆', '一键生成年度图集')}
      ${card('linear-gradient(135deg,#FFD068,#FFB020)', '日常回忆录', '静图动效 · 温暖短片')}
    </div>
  </div>`
}

/** 改造后：时光速览（真实数据摘要） */
function overview() {
  const item = (icon, value, label) =>
    `<div class="ov-item">
      <img src="${uri(renderIcon(icon, '#FF6B3D', 36))}">
      <div class="ov-value">${value}</div>
      <div class="ov-label">${label}</div>
    </div>`
  return `<div class="ov">
    ${item('calendar-check', '365', '陪伴天数')}
    <div class="ov-div"></div>
    ${item('note-pencil', '12', '时光记录')}
    <div class="ov-div"></div>
    ${item('image', '28', '珍藏照片')}
  </div>`
}

/** 时间线卡片 */
function timelineCard(mode) {
  const photo =
    mode === 'before'
      ? `<div class="ph-dashed"><span class="ph-plus">＋</span><span class="ph-txt">添加照片</span></div>`
      : `<div class="ph-hint"><img src="${uri(renderIcon('camera', '#B69B83', 28))}"><span>这条记录还没有照片</span></div>`
  return `<div class="tl-list">
    <div class="tl-title">时光足迹</div>
    <div class="tl-item">
      <div class="tl-col">
        <div class="tl-dot">🎂</div>
        <div class="tl-line"></div>
      </div>
      <div class="tl-card">
        <div class="tl-date"><span class="tl-date-txt">2026-07-31</span><span class="tl-badge">里程碑</span></div>
        <div class="tl-card-title">可乐的生日</div>
        <div class="tl-card-desc">来到这个世界的第一天</div>
        ${photo}
      </div>
    </div>
  </div>`
}

const cta = () => `<div class="cta"><span class="cta-plus">＋</span><span>添加时光记录</span></div>`

function phone(mode) {
  return `<div class="phone">
    ${navbar('时光')}
    <div class="screen" style="background:linear-gradient(180deg,#FFFDF9 0%,#FFF6EE 40%,#FFEDE0 100%)">
      ${header(mode)}
      <div class="body">
        ${mode === 'after' ? overview() : ''}
        ${mode === 'before' ? featured() : ''}
        ${timelineCard(mode)}
        ${cta()}
      </div>
    </div>
    <div class="home-bar"></div>
  </div>`
}

function main() {
  fs.mkdirSync(WORK, { recursive: true })
  fs.mkdirSync(ICON_DIR, { recursive: true })

  const html = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>时光页优化 + 回忆录入口收口</title><style>
*{box-sizing:border-box}
body{margin:0;padding:42px 34px 56px;background:#F7F4F0;color:#3D3833;
  font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;-webkit-font-smoothing:antialiased}
h1{font-size:23px;margin:0 0 8px;letter-spacing:.3px}
.sub{font-size:13.5px;color:#8C8177;margin:0 0 32px;line-height:1.75}
h2{font-size:17px;margin:0 0 6px;display:flex;align-items:center;gap:9px}
h2 .n{display:inline-flex;align-items:center;justify-content:center;width:23px;height:23px;
  border-radius:50%;background:#FF6B3D;color:#fff;font-size:13px;font-weight:700;flex-shrink:0}
.card{background:#fff;border-radius:20px;padding:26px 28px;margin-bottom:26px;
  box-shadow:0 2px 16px rgba(120,100,80,.09)}
.lead{font-size:13px;color:#9A8F84;margin:0 0 22px;line-height:1.8}
.lead code{background:#F2EDE7;border-radius:4px;padding:1px 5px;font-size:12px}
.phones{display:flex;gap:30px;justify-content:center;align-items:flex-start;flex-wrap:wrap}
.pwrap{display:flex;flex-direction:column;align-items:center;gap:12px}
.ptag{font-size:12px;padding:4px 14px;border-radius:20px;font-weight:600}
.ptag.bad{background:#FDEBE7;color:#C4472A}
.ptag.good{background:#E9F6EC;color:#2E7D46}

/* ── 手机外框 ── */
.phone{width:375px;border-radius:40px;overflow:hidden;background:#fff;
  box-shadow:0 10px 40px rgba(90,70,50,.16);border:1px solid rgba(0,0,0,.05)}
.navbar{height:44px;display:flex;align-items:center;justify-content:center;position:relative;background:#FFF6EE}
.navbar-title{font-size:17px;font-weight:600;color:#1a1a1a}
.navbar-capsule{position:absolute;right:12px;top:9px;width:87px;height:26px;border-radius:13px;
  border:1px solid rgba(0,0,0,.08);display:flex;align-items:center;justify-content:space-around;background:rgba(255,255,255,.6)}
.dots{font-size:11px;color:#333;letter-spacing:.5px}
.circle{width:13px;height:13px;border-radius:50%;border:1.6px solid #333}
.screen{height:700px;overflow:hidden;display:flex;flex-direction:column}
.home-bar{height:4px;background:#fff;padding:0;position:relative}
.home-bar::after{content:"";position:absolute;left:50%;transform:translateX(-50%);bottom:6px;
  width:120px;height:4px;border-radius:3px;background:#1a1a1a}

/* ── 页头 ── */
.hdr{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:28px 20px 8px;flex-shrink:0}
.hdr-left{min-width:0}
.hdr-title{font-size:26px;font-weight:700;line-height:1.2;color:#40281C}
.hdr-sub{margin-top:6px;font-size:13px;color:#B69B83}
.add-round{width:44px;height:44px;border-radius:50%;flex-shrink:0;display:flex;align-items:center;
  justify-content:center;font-size:24px;color:#fff;font-weight:400;
  background:linear-gradient(135deg,#FFA082,#FF6B3D);
  box-shadow:0 6px 18px -4px rgba(255,107,61,.35),0 0 15px rgba(255,107,61,.38)}
.add-pill{flex-shrink:0;display:flex;align-items:center;gap:4px;height:32px;padding:0 13px;
  border-radius:999px;background:linear-gradient(135deg,#FFA082,#FF6B3D);
  box-shadow:0 6px 18px -4px rgba(255,107,61,.35),0 0 15px rgba(255,107,61,.38)}
.add-pill img{width:16px;height:16px;display:block}
.add-pill span{font-size:13px;font-weight:600;color:#fff;line-height:1}

.body{flex:1;overflow:hidden;padding-top:8px}

/* ── 回忆精选（改造前） ── */
.feat{margin-top:12px}
.feat-head{display:flex;align-items:center;justify-content:space-between;padding:0 20px;margin-bottom:12px}
.feat-head-title{font-size:18px;font-weight:700;color:#40281C}
.feat-head-hint{font-size:12px;color:#B69B83}
.feat-scroll{display:flex;padding:0 20px;overflow:hidden}
.feat-card{position:relative;overflow:hidden;width:256px;height:160px;border-radius:24px;
  padding:20px;margin-right:12px;flex-shrink:0;display:flex;flex-direction:column}
.feat-glow{position:absolute;right:-28px;top:-36px;width:112px;height:112px;border-radius:50%;background:rgba(255,255,255,.15)}
.feat-icon{width:40px;height:40px;border-radius:50%;background:rgba(255,255,255,.25)}
.feat-text{margin-top:auto}
.feat-title{font-size:18px;font-weight:700;color:#fff;line-height:1.3}
.feat-desc{margin-top:4px;font-size:12px;color:rgba(255,255,255,.85)}

/* ── 时光速览（改造后） ── */
.ov{display:flex;align-items:center;margin:4px 16px 14px;padding:12px 4px;border-radius:28px;
  background:#fff;box-shadow:0 4px 20px -6px rgba(61,33,18,.08),0 0 13px rgba(255,107,61,.14)}
.ov-item{flex:1;display:flex;flex-direction:column;align-items:center;gap:3px}
.ov-item img{width:18px;height:18px;display:block}
.ov-value{font-size:20px;font-weight:700;color:#40281C;line-height:1.1}
.ov-label{font-size:11px;color:#B69B83}
.ov-div{width:1px;height:28px;background:#F3E2D2}

/* ── 时间线 ── */
.tl-list{padding:0 16px}
.tl-title{font-size:18px;font-weight:700;color:#40281C;margin-bottom:16px}
.tl-item{display:flex;gap:10px}
.tl-col{display:flex;flex-direction:column;align-items:center;width:26px;flex-shrink:0}
.tl-dot{width:22px;height:22px;border-radius:50%;display:flex;align-items:center;justify-content:center;
  font-size:11px;flex-shrink:0;background:linear-gradient(135deg,#FF6B3D,#FFB020);
  border:1px solid #FFF6EE;box-shadow:0 0 10px rgba(255,107,61,.5)}
.tl-line{width:1.5px;flex:1;min-height:20px;background:linear-gradient(180deg,#FF6B3D,rgba(255,107,61,.1));opacity:.5}
.tl-card{flex:1;margin-bottom:16px;padding:12px;border-radius:20px;background:#fff;border:1px solid #F3E2D2}
.tl-date{display:flex;align-items:center;gap:6px;margin-bottom:6px}
.tl-date-txt{font-size:12px;color:#8B6E58}
.tl-badge{padding:2px 7px;border-radius:10px;background:rgba(255,107,61,.08);border:1px solid #F3E2D2;
  font-size:10px;color:#FF6B3D}
.tl-card-title{font-size:15px;font-weight:600;color:#40281C;margin-bottom:4px}
.tl-card-desc{font-size:12px;color:#8B6E58;line-height:1.6;margin-bottom:8px}
.ph-dashed{display:flex;align-items:center;justify-content:center;gap:4px;height:60px;border-radius:6px;
  background:#FFFDF9;border:1px solid rgba(243,226,210,.5)}
.ph-plus{font-size:16px;color:#B69B83}
.ph-txt{font-size:11px;color:#B69B83}
.ph-hint{display:flex;align-items:center;gap:4px;margin-top:6px;padding:8px 10px;border-radius:6px;background:#FFFDF9}
.ph-hint img{width:14px;height:14px;display:block}
.ph-hint span{font-size:11px;color:#B69B83}

/* ── CTA ── */
.cta{display:flex;align-items:center;justify-content:center;gap:8px;height:56px;border-radius:999px;
  margin:24px 20px 0;background:linear-gradient(135deg,#FFA082,#FF6B3D);
  box-shadow:0 6px 18px -4px rgba(255,107,61,.35),0 0 15px rgba(255,107,61,.38);color:#fff}
.cta-plus{font-size:20px;font-weight:400;line-height:1}
.cta span:last-child{font-size:15px;font-weight:600}

/* ── 回忆录馆卡片 ── */
.mhall-mini{width:250px;background:#fff;border-radius:18px;padding:12px;
  box-shadow:0 4px 14px rgba(170,120,70,.12)}
.mhall-mini .em{font-size:24px}
.mhall-mini .t{display:block;font-size:14px;color:#3d2f24;font-weight:600;margin:6px 0 3px}
.mhall-mini .d{display:block;font-size:10.5px;color:#a08b76;line-height:1.45}
.minirow{display:flex;gap:16px;align-items:center}
.toast{margin-top:12px;font-size:12px;color:#a08b76}
.toast .old{color:#C4472A}
.toast .new{color:#2E7D46;font-weight:600}
</style></head><body>

<h1>时光页优化 + 回忆录入口收口</h1>
<p class="sub">用户反馈：「这个界面也要优化」+「像回忆录这些都冲突了，和创作里面，都去除」</p>

<div class="card">
  <h2><span class="n">A</span>时光页 · 改造前后</h2>
  <p class="lead">
    <b>① 去掉与「创作」重复的回忆录入口</b>：原顶部「回忆精选」三张卡占掉半屏，其中「日常回忆录」「纪念Vlog」
    跳转的目标，正是创作页「回忆录馆」里轻纪念档与标准档的页面 —— 同一批功能两处入口。三张已整体移除。<br>
    <b>② 悬空裸「+」改成渐变胶囊</b>：原来那个橙色圆圈靠底对齐挂在标题右下留白里，像个没归属的浮标；
    换成「+ 记录」胶囊（渐变 + 投影 + 按压反馈 + 配图标），与底部主按钮同一视觉语言。<br>
    <b>③ 空出来的位置换「时光速览」</b>：不是拿装饰硬填，而是放对用户有信息量的真实数字（陪伴天数 / 时光记录 / 珍藏照片）。<br>
    <b>④ 顺手修掉一个假按钮</b>：卡片里「＋ 添加照片」是虚线按钮样式，但整张卡点击只打开详情、
    根本不支持给这条记录补照片 —— 点不出预期结果。已改成不带按钮感的纯提示。
  </p>
  <div class="phones">
    <div class="pwrap"><span class="ptag bad">改造前</span>${phone('before')}</div>
    <div class="pwrap"><span class="ptag good">改造后</span>${phone('after')}</div>
  </div>
</div>

<div class="card">
  <h2><span class="n">B</span>回忆录馆 · 「年度回顾」从假占位变成真功能</h2>
  <p class="lead">
    时光页三张卡里，只有「年度回忆」不与创作页重复 —— 它是全项目唯一能生成年度图集的功能，
    而创作页回忆录馆里的「年度回顾」当时还只是个<b>点了只弹 toast 的假占位</b>。
    按「回忆录入口统一收口到创作」的原则，把生成逻辑（含离屏 Canvas 与预览弹窗）整段迁到了回忆录馆。
  </p>
  <div class="minirow">
    <div class="mhall-mini">
      <div class="em">🎊</div>
      <div class="t">年度回顾</div>
      <div class="d">这一年 TA 的档案大片</div>
      <div class="toast"><span class="old">改造前：点击弹「年度回顾即将上线」</span></div>
    </div>
    <div class="mhall-mini">
      <div class="em">🎊</div>
      <div class="t">年度回顾</div>
      <div class="d">这一年 TA 的档案大片</div>
      <div class="toast"><span class="new">改造后：直接生成年度图集 → 可预览、可保存到相册</span></div>
    </div>
  </div>
</div>

</body></html>`

  const outHtml = path.join(WORK, '时光页优化对比.html')
  fs.writeFileSync(outHtml, html, 'utf8')
  const tmpHtml = path.join(TMP, 'preview.html')
  fs.writeFileSync(tmpHtml, html, 'utf8')
  const outPng = path.join(WORK, '时光页优化对比.png')
  execFileSync(
    EDGE,
    ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=2',
     // 宽度必须容下「两张 375px 手机屏 + 间距 + 两级内边距」，否则 .phones 会折行、
     // 第二块内容被挤出截图范围（上一版 880 宽就是这么漏掉「改造后」的）
     '--window-size=1000,1760', '--virtual-time-budget=6000',
     `--screenshot=${outPng}`, 'file:///' + tmpHtml.replace(/\\/g, '/')],
    { stdio: 'ignore', timeout: 120000 },
  )
  console.log(`✅ HTML: ${outHtml}`)
  console.log(`✅ PNG : ${outPng}`)
}

main()
