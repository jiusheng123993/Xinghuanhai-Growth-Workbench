/**
 * 插画落地效果预览：把真实插画放进真实页面布局里
 *
 * 目的：部署到生产 + 改 36 个文件之前，先让用户看到"插画真的用起来是什么样"。
 * 几何数值取自各页真实 SCSS（rpx ÷ 2 = px）。
 */
const fs = require('fs')
const path = require('path')
const os = require('os')
const { execFileSync } = require('child_process')

const ROOT = 'E:/星河宠记'
const FINAL = `${ROOT}/02-UI设计/插画系统/final`
const WORK = `${ROOT}/02-UI设计/插画系统/preview`
const TMP = path.join(os.tmpdir(), 'xhh-apply-preview')
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'

const b64 = (k) => {
  const p = path.join(FINAL, `${k}.jpg`)
  if (!fs.existsSync(p)) throw new Error(`缺图 ${k}`)
  return `data:image/jpeg;base64,${fs.readFileSync(p).toString('base64')}`
}

const navbar = (t) => `<div class="navbar"><div class="nav-t">${t}</div>
  <div class="capsule"><span>•••</span><span class="ring"></span></div></div>`

/** 屏1：时光线空态 */
const s1 = (img) => `${navbar('时光')}
  <div class="screen">
    <div class="hdr"><div><div class="hdr-t">可乐的时光线</div><div class="hdr-s">记录每一刻温暖时光</div></div>
      <div class="pill">＋ 记录</div></div>
    <div class="ov"><div class="ov-i"><div class="ov-v">365</div><div class="ov-l">陪伴天数</div></div>
      <div class="ov-d"></div><div class="ov-i"><div class="ov-v">0</div><div class="ov-l">时光记录</div></div>
      <div class="ov-d"></div><div class="ov-i"><div class="ov-v">0</div><div class="ov-l">珍藏照片</div></div></div>
    <div class="tl-t">时光足迹</div>
    <div class="empty"><img class="illus" src="${img}">
      <div class="empty-t">还没有时光记录</div>
      <div class="empty-d">点右上角「记录」，写下可乐的第一个珍贵瞬间</div></div>
    <div class="cta">＋ 添加时光记录</div>
  </div>`

/** 屏2：打卡空态 */
const s2 = (img) => `${navbar('健康打卡')}
  <div class="screen" style="background:linear-gradient(180deg,#FFFDF9,#FFF6EE 45%,#FFEDE0)">
    <div class="hdr"><div><div class="hdr-t">今日打卡</div><div class="hdr-s">每天一分钟，健康看得见</div></div></div>
    <div class="empty" style="padding-top:34px"><img class="illus" src="${img}">
      <div class="empty-t">还没有打卡记录</div>
      <div class="empty-d">记录可乐今天的状态，攒够 7 天能看到健康趋势</div></div>
    <div class="cta">开始今天的打卡</div>
  </div>`

/** 屏3：回忆录馆（功能头图） */
const s3 = (img) => `${navbar('回忆录馆')}
  <div class="screen" style="background:#FFFAF5">
    <div class="hero"><img class="hero-img" src="${img}">
      <div class="hero-txt"><div class="hero-t">回忆录馆</div><div class="hero-s">把和可乐的日子，讲成一部小电影</div></div></div>
    <div class="mh-banner">📸 素材盘点：可乐现有照片 28 张 · 时光线回忆 12 条</div>
    <div class="mh-sect">选择档位</div>
    <div class="mh-card"><div class="mh-em">🍃</div><div><div class="mh-tit">轻纪念</div>
      <div class="mh-desc">一段真实影像+空镜 · 约 20 秒</div><div class="mh-price">¥25.9 <span>会员 ¥18.9</span></div></div></div>
    <div class="mh-card"><div class="mh-em">📖</div><div><div class="mh-tit">标准回忆录</div>
      <div class="mh-desc">六个章节 · 空镜衔接 · 约 45 秒</div><div class="mh-price">¥59 <span>会员 ¥45</span></div></div></div>
  </div>`

/** 屏4：激励时刻 */
const s4 = (img) => `${navbar('打卡')}
  <div class="screen" style="background:linear-gradient(180deg,#FFFDF9,#FFF6EE 45%,#FFEDE0)">
    <div class="celebrate"><img class="celebrate-img" src="${img}">
      <div class="celebrate-t">连续打卡 7 天！</div>
      <div class="celebrate-d">可乐已经坚持一周啦，健康分 +15</div>
      <div class="celebrate-badge">🏅 解锁「一周不缺席」</div></div>
    <div class="cta" style="margin-top:20px">继续打卡</div>
  </div>`

/** 屏5：分享卡 */
const s5 = (img) => `${navbar('分享卡片')}
  <div class="screen" style="background:linear-gradient(180deg,#FFFDF9,#FFF6EE)">
    <div class="share-card">
      <img class="share-bg" src="${img}">
      <div class="share-inner">
        <div class="share-brand">星河宠记</div>
        <div class="share-score">92</div>
        <div class="share-lbl">可乐 · 本周健康分</div>
        <div class="share-stats">已打卡 7 天 · 疫苗按时 · 体重稳定</div>
      </div>
    </div>
    <div class="cta" style="margin-top:18px">保存到相册</div>
  </div>`

function main() {
  fs.mkdirSync(WORK, { recursive: true })
  fs.mkdirSync(TMP, { recursive: true })

  const screens = [
    ['时光线空态', 'empty-timeline', s1],
    ['打卡空态', 'empty-checkin', s2],
    ['回忆录馆（功能头图）', 'header-memoir', s3],
    ['连续打卡 7 天（激励时刻）', 'moment-streak-7', s4],
    ['分享卡片（背景插画）', 'share-card-starry', s5],
  ]

  const phones = screens
    .map(
      ([label, key, fn]) => `<div class="pw">
        <div class="phone">${fn(b64(key))}</div>
        <div class="plabel">${label}</div>
      </div>`,
    )
    .join('')

  const html = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>插画落地效果</title><style>
*{box-sizing:border-box}
body{margin:0;padding:40px 30px 56px;background:#F7F4F0;color:#3D3833;
  font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;-webkit-font-smoothing:antialiased}
h1{font-size:22px;margin:0 0 7px}
.sub{font-size:13px;color:#8C8177;margin:0 0 28px;line-height:1.7}
.sub b{color:#C4472A}
.phones{display:flex;gap:22px;justify-content:center;flex-wrap:wrap;align-items:flex-start}
.pw{display:flex;flex-direction:column;align-items:center;gap:10px}
.plabel{font-size:12px;font-weight:600;color:#5C5349;text-align:center;max-width:268px}
.phone{width:268px;border-radius:32px;overflow:hidden;background:#fff;
  box-shadow:0 8px 28px rgba(90,70,50,.15);border:1px solid rgba(0,0,0,.05)}
.navbar{height:36px;display:flex;align-items:center;justify-content:center;position:relative;background:#FFF6EE}
.nav-t{font-size:13px;font-weight:600;color:#1a1a1a}
.capsule{position:absolute;right:9px;top:7px;width:64px;height:21px;border-radius:11px;
  border:1px solid rgba(0,0,0,.08);display:flex;align-items:center;justify-content:space-around;
  background:rgba(255,255,255,.6);font-size:8px;color:#333}
.ring{width:10px;height:10px;border-radius:50%;border:1.4px solid #333}
.screen{height:496px;overflow:hidden;padding-bottom:12px;
  background:linear-gradient(180deg,#FFFDF9 0%,#FFF6EE 40%,#FFEDE0 100%)}
.hdr{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:20px 15px 6px}
.hdr-t{font-size:18px;font-weight:700;color:#40281C;line-height:1.2}
.hdr-s{margin-top:4px;font-size:10px;color:#B69B83}
.pill{flex-shrink:0;height:24px;padding:0 10px;border-radius:999px;display:flex;align-items:center;
  background:linear-gradient(135deg,#FFA082,#FF6B3D);color:#fff;font-size:10.5px;font-weight:600;
  box-shadow:0 4px 12px -4px rgba(255,107,61,.35)}
.ov{display:flex;align-items:center;margin:3px 12px 11px;padding:9px 3px;border-radius:20px;background:#fff;
  box-shadow:0 3px 14px -5px rgba(61,33,18,.08),0 0 9px rgba(255,107,61,.14)}
.ov-i{flex:1;display:flex;flex-direction:column;align-items:center;gap:2px}
.ov-v{font-size:15px;font-weight:700;color:#40281C;line-height:1.1}
.ov-l{font-size:8.5px;color:#B69B83}
.ov-d{width:1px;height:20px;background:#F3E2D2}
.tl-t{font-size:14px;font-weight:700;color:#40281C;margin:0 15px 10px}
.empty{display:flex;flex-direction:column;align-items:center;text-align:center;padding:12px 26px}
.illus{width:132px;height:132px;object-fit:contain;border-radius:14px;margin-bottom:8px}
.empty-t{font-size:14px;font-weight:600;color:#40281C;margin-bottom:5px}
.empty-d{font-size:10.5px;color:#B69B83;line-height:1.6}
.cta{display:flex;align-items:center;justify-content:center;gap:5px;height:42px;border-radius:999px;
  margin:14px 15px 0;background:linear-gradient(135deg,#FFA082,#FF6B3D);color:#fff;font-size:12.5px;font-weight:600;
  box-shadow:0 5px 13px -4px rgba(255,107,61,.35)}

/* 回忆录馆 */
.hero{position:relative;margin:12px 14px 0;border-radius:18px;overflow:hidden;height:118px}
.hero-img{width:100%;height:100%;object-fit:cover;display:block}
.hero-txt{position:absolute;left:14px;top:22px}
.hero-t{font-size:17px;font-weight:700;color:#3d2f24}
.hero-s{font-size:10px;color:#7a6455;margin-top:4px;max-width:130px;line-height:1.5}
.mh-banner{margin:12px 14px 0;padding:9px 12px;border-radius:12px;background:#FFF1E8;
  font-size:9.5px;color:#a06a3f;line-height:1.5}
.mh-sect{font-size:13px;font-weight:700;color:#3d2f24;margin:14px 14px 8px}
.mh-card{display:flex;gap:10px;align-items:center;background:#fff;border-radius:16px;
  padding:11px 13px;margin:0 14px 9px;box-shadow:0 4px 12px rgba(170,120,70,.1)}
.mh-em{font-size:22px;width:32px;text-align:center}
.mh-tit{font-size:12.5px;font-weight:600;color:#3d2f24}
.mh-desc{font-size:9.5px;color:#a08b76;margin:3px 0 4px}
.mh-price{font-size:13px;font-weight:700;color:#e2582f}
.mh-price span{font-size:9px;color:#b08b5e;font-weight:400;margin-left:6px}

/* 激励 */
.celebrate{display:flex;flex-direction:column;align-items:center;text-align:center;padding:14px 24px 0}
.celebrate-img{width:170px;height:170px;object-fit:contain;border-radius:16px}
.celebrate-t{font-size:17px;font-weight:700;color:#40281C;margin-top:8px}
.celebrate-d{font-size:10.5px;color:#B69B83;margin-top:5px;line-height:1.6}
.celebrate-badge{margin-top:10px;padding:6px 14px;border-radius:999px;background:#FFF3DC;
  border:1px solid #FFE0A8;font-size:10.5px;color:#A06F10;font-weight:600}

/* 分享卡 */
.share-card{position:relative;width:186px;height:300px;margin:14px auto 0;border-radius:18px;
  overflow:hidden;box-shadow:0 8px 24px rgba(90,70,50,.18)}
.share-bg{width:100%;height:100%;object-fit:cover;display:block}
.share-inner{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;
  justify-content:flex-end;padding-bottom:26px}
.share-brand{font-size:9.5px;color:rgba(255,255,255,.9);letter-spacing:1px;margin-bottom:4px}
.share-score{font-size:40px;font-weight:800;color:#fff;line-height:1;text-shadow:0 2px 10px rgba(0,0,0,.25)}
.share-lbl{font-size:10.5px;color:rgba(255,255,255,.95);margin-top:5px}
.share-stats{font-size:9px;color:rgba(255,255,255,.8);margin-top:6px}
</style></head><body>

<h1>插画落地效果</h1>
<p class="sub">24 张插画已生成并通过质检（<b>无烧字、角色 24 张一致</b>），这是放进真实页面布局的样子 —— 几何取自各页实际 SCSS</p>
<div class="phones">${phones}</div>

</body></html>`

  const outHtml = path.join(WORK, '插画落地效果.html')
  fs.writeFileSync(outHtml, html, 'utf8')
  const tmpHtml = path.join(TMP, 'p.html')
  fs.writeFileSync(tmpHtml, html, 'utf8')
  const outPng = path.join(WORK, '插画落地效果.png')
  execFileSync(
    EDGE,
    ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=2',
     '--window-size=1500,780', '--virtual-time-budget=8000',
     `--screenshot=${outPng}`, 'file:///' + tmpHtml.replace(/\\/g, '/')],
    { stdio: 'ignore', timeout: 180000 },
  )
  console.log(`✅ ${outHtml}`)
  console.log(`✅ ${outPng}`)
}

main()
