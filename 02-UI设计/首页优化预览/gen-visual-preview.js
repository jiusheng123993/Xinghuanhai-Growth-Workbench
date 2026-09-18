/**
 * 生成「本次优化效果对比」自包含预览页
 *
 * 内容分三块：
 *   A. 底部 tabBar —— 6 套主题下「改造前 vs 改造后」图标
 *   B. 快捷功能宫格 —— 改造前（图标不可见 + 圆圈透明）vs 改造后
 *   C. 380 处失效 CSS 声明的影响示意
 *
 * 图片全部内联成 base64，HTML 自包含、可脱离项目目录打开，不依赖相对路径。
 * 几何数值取自真实 SCSS/rpx（750rpx 设计稿 = 375px 屏，故 rpx ÷ 2 = px）。
 */
const fs = require('fs')
const path = require('path')
const os = require('os')
const { execFileSync } = require('child_process')

const ROOT = 'E:/星河宠记'
const ASSETS = `${ROOT}/03-源代码/小程序/miniapp/src/assets/icons`
const PREV = `${ROOT}/02-UI设计/首页优化预览/tabbar-icons`
const WORK = `${ROOT}/02-UI设计/首页优化预览/visual-preview`
const TMP = path.join(os.tmpdir(), 'xhh-visual-preview')

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'

/** 6 套主题的 tabBar 配色（与 themeStore.ThemeMeta 一致） */
const THEMES = [
  { key: 'autumn', name: '暖阳珊瑚橙', bg: '#FFFFFF', color: '#B69B83', sel: '#FF6B3D', dir: null },
  { key: 'spring', name: '嫩芽绿', bg: '#FFFFFF', color: '#9BB494', sel: '#54B460', dir: 'spring' },
  { key: 'summer', name: '海盐蓝', bg: '#FFFFFF', color: '#8FA6B8', sel: '#2FA8E8', dir: 'summer' },
  { key: 'winter', name: '冰晶紫', bg: '#FFFFFF', color: '#929CBA', sel: '#6C7CF0', dir: 'winter' },
  { key: 'starry', name: '星空银河', bg: '#232C57', color: 'rgba(255,255,255,0.55)', sel: '#FFD068', dir: 'starry' },
  { key: 'grid', name: '奶油格纹', bg: '#FFFFFF', color: '#B69B83', sel: '#FF6B3D', dir: null },
]

const TABS = [
  { assetKey: 'home', label: '今天' },
  { assetKey: 'creative', label: '创作' },
  { assetKey: 'timeline', label: '时光' },
  { assetKey: 'pet', label: '宠物' },
  { assetKey: 'mine', label: '我的' },
]

const uri = (p) => (fs.existsSync(p) ? `data:image/png;base64,${fs.readFileSync(p).toString('base64')}` : '')

/** 改造后的图标路径 */
function newIcon(theme, assetKey, active) {
  const dir = theme.dir ? path.join(ASSETS, 'tabbar', theme.dir) : ASSETS
  return uri(path.join(dir, `${assetKey}${active ? '-active' : ''}.png`))
}

/** 改造前的图标（6 套主题的旧图标是同一套固定色） */
function oldIcon(assetKey, active) {
  return uri(path.join(PREV, 'before', `${assetKey}${active ? '-active' : ''}.png`))
}

/** 宫格的 6 个卡片（与 pages/index/index.tsx 一致） */
const SHORTCUTS = [
  { icon: 'magnifying-glass', label: '食物查询', desc: '毛孩子能吃吗', tint: 'rgba(255,107,61,.12)', iconColor: '#FF6B3D' },
  { icon: 'stethoscope', label: '症状初筛', desc: '不舒服先问问我', tint: 'rgba(232,146,10,.14)', iconColor: '#E8920A' },
  { icon: 'syringe', label: '疫苗日历', desc: '接种提醒不遗漏', tint: 'rgba(47,201,142,.14)', iconColor: '#2FC98E' },
  { icon: 'chart-line', label: '健康趋势', desc: '看看成长变化', tint: 'rgba(79,163,227,.14)', iconColor: '#4FA3E3' },
  { icon: 'heartbeat', label: '慢性病追踪', desc: '自动扫描健康风险', tint: 'rgba(255,107,61,.12)', iconColor: '#FF6B3D' },
  { icon: 'users', label: '宠物家庭', desc: '一页看全家健康', tint: 'rgba(255,107,61,.12)', iconColor: '#FF6B3D' },
]

function tabBarRow(theme, useNew) {
  return TABS.map((t, i) => {
    const active = i === 0
    const src = useNew ? newIcon(theme, t.assetKey, active) : oldIcon(t.assetKey, active)
    return `<div class="tb-tab">
      <img src="${src}" alt="">
      <span style="color:${active ? theme.sel : theme.color}">${t.label}</span>
    </div>`
  }).join('')
}

function gridCards(mode) {
  return SHORTCUTS.map((s, i) => {
    const showIcon = mode === 'after'
    // 改造前：size='1em' 在 image 上失效 → 图标塌成 0；圆圈 rgba(var(--x),α) 非法 → 背景透明
    const circleStyle = showIcon ? `background:${s.tint}` : 'background:transparent'
    const iconHtml = showIcon ? `<img src="${iconUri(s.icon, s.iconColor)}" alt="">` : ''
    return `<div class="sc-card">
      <div class="sc-circle" style="${circleStyle}">${iconHtml}</div>
      <div class="sc-label">${s.label}</div>
      <div class="sc-desc">${s.desc}</div>
    </div>`
  }).join('')
}

/** 用项目里的真实图标路径渲染一张小 PNG，再内联成 data URI */
function iconUri(name, color) {
  const cache = path.join(TMP, 'icons', `${name}-${color.replace('#', '')}.png`)
  if (fs.existsSync(cache)) return uri(cache)
  return '' // 由 prepareIcons 预先生成
}

function main() {
  fs.mkdirSync(WORK, { recursive: true })
  fs.mkdirSync(path.join(TMP, 'icons'), { recursive: true })

  // 预渲染宫格用到的图标（复用 Icon.tsx 的取色逻辑：Phosphor Fill + 注入颜色）
  const fillSrc = fs.readFileSync(`${ROOT}/03-源代码/小程序/miniapp/src/components/icons-fill.ts`, 'utf8')
  for (const s of SHORTCUTS) {
    const re = new RegExp(`'${s.icon}':\\s*'([^']+)'`)
    const m = re.exec(fillSrc)
    if (!m) throw new Error(`icons-fill.ts 里找不到 ${s.icon}`)
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 256 256" fill="${s.iconColor}">${m[1]}</svg>`
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>html,body{margin:0;width:36px;height:36px;overflow:hidden;background:transparent}svg{display:block}</style></head><body>${svg}</body></html>`
    const hp = path.join(TMP, 'icons', `${s.icon}.html`)
    const pp = path.join(TMP, 'icons', `${s.icon}-${s.iconColor.replace('#', '')}.png`)
    fs.writeFileSync(hp, html, 'utf8')
    if (!fs.existsSync(pp)) {
      execFileSync(
        EDGE,
        ['--headless', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=2',
         '--default-background-color=00000000', '--window-size=36,36', '--virtual-time-budget=2000',
         `--screenshot=${pp}`, 'file:///' + hp.replace(/\\/g, '/')],
        { stdio: 'ignore', timeout: 60000 },
      )
    }
  }

  const themeBlocks = THEMES.map(
    (t) => `<div class="theme-block">
      <div class="theme-name">${t.name} <code>${t.key}</code>
        <span class="swatch" style="background:${t.color}"></span>
        <span class="swatch" style="background:${t.sel}"></span>
      </div>
      <div class="tb" style="background:${t.bg}">
        <div class="tb-tag bad">前</div>
        ${tabBarRow(t, false)}
      </div>
      <div class="tb" style="background:${t.bg}">
        <div class="tb-tag good">后</div>
        ${tabBarRow(t, true)}
      </div>
    </div>`,
  ).join('')

  const html = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>星河宠记 · 视觉优化效果对比</title><style>
*{box-sizing:border-box}
body{margin:0;padding:44px 36px 60px;background:#F7F4F0;color:#3D3833;
  font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;-webkit-font-smoothing:antialiased}
h1{font-size:24px;margin:0 0 8px;letter-spacing:.3px}
.sub{font-size:13.5px;color:#8C8177;margin:0 0 34px;line-height:1.7}
h2{font-size:17px;margin:0 0 6px;display:flex;align-items:center;gap:9px}
h2 .n{display:inline-flex;align-items:center;justify-content:center;width:23px;height:23px;
  border-radius:50%;background:#FF6B3D;color:#fff;font-size:13px;font-weight:700;flex-shrink:0}
.card{background:#fff;border-radius:20px;padding:26px 28px;margin-bottom:26px;
  box-shadow:0 2px 16px rgba(120,100,80,.09)}
.card .lead{font-size:13px;color:#9A8F84;margin:0 0 20px;line-height:1.75}
.card .lead code{background:#F2EDE7;border-radius:4px;padding:1px 5px;font-size:12px}
.issue{font-size:13.5px;line-height:2.05;color:#5C5349;margin:0 0 22px;padding-left:2px}
.issue b{color:#C4472A;font-weight:600}

/* ── tabBar ── */
.theme-block{margin-bottom:22px;padding-bottom:22px;border-bottom:1px dashed #EDE6DE}
.theme-block:last-child{border-bottom:none;margin-bottom:0;padding-bottom:0}
.theme-name{font-size:13px;font-weight:600;color:#5C5349;margin-bottom:10px;display:flex;align-items:center;gap:8px}
.theme-name code{font-weight:400;color:#A79C91;font-size:12px}
.swatch{width:13px;height:13px;border-radius:4px;border:1px solid rgba(0,0,0,.09);display:inline-block}
.tb{display:flex;align-items:center;border-radius:12px;padding:9px 0 10px;
  border:1px solid rgba(0,0,0,.055);margin-bottom:8px;overflow:hidden}
.tb-tag{font-size:10px;width:17px;text-align:center;flex-shrink:0;margin-left:9px;
  border-radius:5px;padding:2px 0;font-weight:700}
.tb-tag.bad{background:#FDEBE7;color:#C4472A}
.tb-tag.good{background:#E9F6EC;color:#2E7D46}
.tb-tab{flex:1;display:flex;flex-direction:column;align-items:center;gap:3px}
.tb-tab img{width:27px;height:27px;display:block}
.tb-tab span{font-size:10px;line-height:1}

/* ── 宫格 ── */
.sc-wrap{display:flex;gap:10px;padding:16px;border-radius:16px;background:#FFF6EE}
.sc-grid{display:flex;flex-wrap:wrap;gap:10px;width:100%}
.sc-card{width:calc((100% - 20px)/3);background:#fff;border-radius:28px;padding:12px;
  border:1px solid #F3E2D2;box-shadow:0 4px 20px -6px rgba(61,33,18,.08),0 0 13px rgba(255,107,61,.14)}
.sc-circle{width:38px;height:38px;border-radius:50%;display:flex;align-items:center;
  justify-content:center;margin-bottom:8px}
.sc-circle img{width:18px;height:18px;display:block}
.sc-label{font-size:14px;font-weight:600;color:#40281C;margin-bottom:2px;line-height:1.35}
.sc-desc{font-size:10px;color:#B69B83;line-height:1.5}
.badge-tag{display:inline-block;font-size:11px;padding:2px 9px;border-radius:20px;margin-bottom:10px}
.badge-tag.bad{background:#FDEBE7;color:#C4472A}
.badge-tag.good{background:#E9F6EC;color:#2E7D46}

/* ── code ── */
pre{background:#2B2622;color:#E8DFD4;border-radius:12px;padding:16px 18px;font-size:12px;
  line-height:1.75;overflow-x:auto;margin:0 0 14px;font-family:Consolas,Monaco,monospace}
pre .del{color:#FF9E8A}
pre .add{color:#8DE0A8}
pre .cmt{color:#8C8177}
table{width:100%;border-collapse:collapse;font-size:12.5px;margin-top:6px}
th,td{text-align:left;padding:9px 10px;border-bottom:1px solid #F0EAE3}
th{color:#9A8F84;font-weight:600;font-size:11.5px}
td code{background:#F7F3EF;border-radius:4px;padding:1px 5px;font-size:11.5px}
td.ok{color:#2E7D46;font-weight:600}
td.no{color:#C4472A;font-weight:600}
</style></head><body>

<h1>星河宠记 · 视觉优化效果对比</h1>
<p class="sub">本次针对「底部导航栏太丑」「快捷功能宫格太丑」两处反馈，挖到并修复了一个波及全 App 的 CSS 失效问题</p>

<div class="card">
  <h2><span class="n">A</span>底部导航栏 · 6 套主题逐一核对</h2>
  <p class="lead">
    原图标有 4 个问题：<b>①</b> 创作的图标颜色与其余 4 个都不同（未选中 <code>#8080A0</code> 偏紫，其余 <code>#8A99AA</code>）；
    <b>②</b> 所有图标颜色与 tabBar 文字颜色冷暖冲突（图标冷灰蓝 ↔ 文字暖棕褐）；
    <b>③</b> 宠物是面性实心、其余是线性，风格混搭；
    <b>④</b> 最关键——tabBar 文字色是<b>逐主题变化</b>的，而图标是 PNG、颜色烘焙在文件里，
    <code>setTabBarStyle</code> 改不到，所以固定一套图标必然只对默认主题正确。
  </p>
  <p class="lead">
    改造：换用 Phosphor 图标族（MIT），未选中 = 线性描边、选中 = 面性实心（线/面区分状态是 Apple HIG 做法）；
    颜色不再硬编码，而是从 <code>themeStore.ts</code> 的 <code>tabBarColor</code> 解析后成套生成，
    切主题时用 <code>setTabBarItem</code> 同步换掉。下面每套主题都能看到「图标与文字同色」。
  </p>
  ${themeBlocks}
</div>

<div class="card">
  <h2><span class="n">B</span>快捷功能宫格</h2>
  <p class="issue">
    改造前这里是<b>双重失效</b>，所以看起来「只剩干巴巴的文字」：<br>
    ① 图标 <code>size='1em'</code> 在小程序 <code>&lt;image&gt;</code> 上解析不出尺寸 → <b>塌成 0，完全不可见</b>；<br>
    ② 圆圈底色写成 <code>rgba($color-primary, 0.12)</code>，编译成 <code>rgba(var(--primary,#FF6B3D),.12)</code>
    —— 这是<b>非法 CSS</b>，整条声明被丢弃 → <b>圆圈也是透明的</b>。<br>
    顺带修掉：食物查询原本用放大镜（只表达"搜索"）、慢性病追踪与症状初筛<b>撞了同一个听诊器图标</b>。
  </p>
  <span class="badge-tag bad">改造前</span>
  <div class="sc-wrap"><div class="sc-grid">${gridCards('before')}</div></div>
  <div style="height:20px"></div>
  <span class="badge-tag good">改造后</span>
  <div class="sc-wrap"><div class="sc-grid">${gridCards('after')}</div></div>
  <p class="lead" style="margin-top:18px;margin-bottom:0">
    注：改造后演示图用的是静态色值；真机上图标走 <code>tone</code>，圆圈走 <code>rgba(var(--xxx-rgb),α)</code>，两者同源，切主题一起变。
  </p>
</div>

<div class="card">
  <h2><span class="n">C</span>根因：380 处 CSS 声明被浏览器静默丢弃</h2>
  <p class="lead">
    B 里那个非法写法不是孤例。全项目审计发现<b>同一个错误出现了 380 次、横跨 34 个 SCSS 文件</b>，
    意味着大量卡片的浅色底、边框、阴影、tint 圆圈<b>全都没渲染出来</b>。已全部修复。
  </p>

  <pre><span class="cmt">/* 色板变量为支持主题切换，定义成 var() 形式 */</span>
$color-primary: var(--primary, #FF6B3D);

<span class="cmt">/* ❌ 改造前：编译成 rgba(var(--primary,#FF6B3D),.12)</span>
<span class="cmt">   var() 展开后是 rgba(#FF6B3D,.12)，而 rgba() 逗号语法只接受数值通道</span>
<span class="cmt">   → 声明非法 → 实测 getComputedStyle 得到 rgba(0,0,0,0) 完全透明 */</span>
<span class="del">background: rgba($color-primary, 0.12);</span>

<span class="cmt">/* ✅ 改造后：改用配套的数值通道变量，带 fallback 三元组 */</span>
<span class="add">background: rgba(var(--primary-rgb, 255, 107, 61), 0.12);</span></pre>

  <table>
    <tr><th>写法</th><th>浏览器实测结果</th><th>结论</th></tr>
    <tr><td><code>rgba(var(--primary), .12)</code></td><td><code>rgba(0,0,0,0)</code></td><td class="no">失效</td></tr>
    <tr><td><code>rgba(var(--primary-rgb), .12)</code></td><td><code>rgba(255,107,61,0.12)</code></td><td class="ok">生效</td></tr>
    <tr><td><code>rgba(#FF6B3D, .12)</code></td><td><code>rgba(0,0,0,0)</code></td><td class="no">失效</td></tr>
    <tr><td><code>rgba(255,107,61,.12)</code></td><td><code>rgba(255,107,61,0.12)</code></td><td class="ok">生效</td></tr>
  </table>

  <p class="lead" style="margin-top:18px;margin-bottom:0">
    修复口径：为 18 个色板变量补齐配套的 <code>--xxx-rgb</code> 数值通道变量（含 6 套主题、深色主题的
    <code>rgba()</code> 形式变量也一并推导），再把 380 处调用点全部改写。
    改完编译产物的失效写法残留为 <b>0</b>。
  </p>
</div>

</body></html>`

  const outHtml = path.join(WORK, '效果对比.html')
  fs.writeFileSync(outHtml, html, 'utf8')

  const tmpHtml = path.join(TMP, 'preview.html')
  fs.writeFileSync(tmpHtml, html, 'utf8')
  const outPng = path.join(WORK, '效果对比.png')
  execFileSync(
    EDGE,
    ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=2',
     '--window-size=820,2600', '--virtual-time-budget=6000',
     `--screenshot=${outPng}`, 'file:///' + tmpHtml.replace(/\\/g, '/')],
    { stdio: 'ignore', timeout: 120000 },
  )
  console.log(`✅ HTML: ${outHtml}`)
  console.log(`✅ PNG : ${outPng}`)
}

main()
