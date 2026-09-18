/**
 * 插画总览质检页（contact sheet）
 *
 * 24 张批量生成完必须整体过一遍：有没有角色跑偏、构图废掉、出现多余元素、
 * 或者和定位不符的（比如空态图里出现文字）。单张看容易漏，铺开看最直观。
 */
const fs = require('fs')
const path = require('path')
const os = require('os')
const { execFileSync } = require('child_process')

const ROOT = 'E:/星河宠记'
const FINAL = `${ROOT}/02-UI设计/插画系统/final`
const WORK = `${ROOT}/02-UI设计/插画系统/preview`
const TMP = path.join(os.tmpdir(), 'xhh-contact-sheet')
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'

/** 分组 + 中文用途说明 */
const GROUPS = [
  {
    title: '空态插画（74 处空态里最高频的 10 个场景）',
    note: '尺寸 600×600 · 单张 49~64KB · 要求角色居中、四周留白、无文字',
    ratio: '1',
    items: [
      ['empty-timeline', '时光线为空'],
      ['empty-checkin', '还没打卡'],
      ['empty-pet', '还没添加宠物'],
      ['empty-search', '搜索无结果'],
      ['empty-photo', '还没有照片'],
      ['empty-chart', '暂无健康数据'],
      ['empty-vaccine', '还没有疫苗记录'],
      ['empty-family', '还差一位家人'],
      ['empty-achievement', '还没有成就'],
      ['empty-message', '暂无对话'],
    ],
  },
  {
    title: '功能头图（横版 16:9，右侧留标题位）',
    note: '尺寸 960×540 · 单张 67~77KB',
    ratio: '16 / 9',
    items: [
      ['header-memoir', '回忆录馆'],
      ['header-avatar-studio', '形象工坊'],
      ['header-health', '健康报告'],
      ['header-family-photo', '全家福'],
      ['header-naming', 'AI 取名'],
    ],
  },
  {
    title: '激励时刻（情绪高光，上方留文字位）',
    note: '尺寸 600×600 · 单张 47~62KB',
    items: [
      ['moment-streak-7', '连续 7 天'],
      ['moment-streak-30', '连续 30 天'],
      ['moment-birthday', '生日快乐'],
      ['moment-anniversary', '周年纪念'],
      ['moment-achievement', '成就解锁'],
      ['moment-first-checkin', '首次打卡'],
    ],
  },
  {
    title: '分享卡背景（主体缩小靠边，中心留空放内容）',
    note: '尺寸 750×750 / 750×422 · 单张 25~68KB',
    items: [
      ['share-card-warm', '暖色横版'],
      ['share-card-starry', '星空竖版'],
      ['share-card-soft', '夕阳竖版'],
    ],
  },
]

const uri = (p) => (fs.existsSync(p) ? `data:image/jpeg;base64,${fs.readFileSync(p).toString('base64')}` : '')

function main() {
  fs.mkdirSync(WORK, { recursive: true })
  fs.mkdirSync(TMP, { recursive: true })

  let total = 0
  const sections = GROUPS.map((g) => {
    const cards = g.items
      .map(([key, label]) => {
        const p = path.join(FINAL, `${key}.jpg`)
        const size = fs.existsSync(p) ? Math.round(fs.statSync(p).size / 1024) : 0
        if (fs.existsSync(p)) total++
        return `<div class="cell">
          <img src="${uri(p)}" alt="">
          <div class="cap"><span class="k">${label}</span><span class="s">${size}KB</span></div>
          <div class="fn">${key}</div>
        </div>`
      })
      .join('')
    return `<div class="card" style="--r:${g.ratio || '1'}">
      <h2>${g.title}</h2>
      <p class="note">${g.note}</p>
      <div class="grid" style="grid-template-columns:repeat(${g.cols || 5},1fr)">${cards}</div>
    </div>`
  }).join('')

  const html = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>插画总览质检</title><style>
*{box-sizing:border-box}
body{margin:0;padding:38px 30px 52px;background:#F7F4F0;color:#3D3833;
  font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;-webkit-font-smoothing:antialiased}
h1{font-size:21px;margin:0 0 6px}
.sub{font-size:13px;color:#8C8177;margin:0 0 26px}
.card{background:#fff;border-radius:18px;padding:22px 24px;margin-bottom:22px;
  box-shadow:0 2px 14px rgba(120,100,80,.09)}
h2{font-size:15px;margin:0 0 4px}
.note{font-size:11.5px;color:#A79C91;margin:0 0 16px}
.grid{display:grid;grid-template-columns:repeat(5,1fr);gap:14px}
.cell{display:flex;flex-direction:column;gap:5px}
.cell img{width:100%;aspect-ratio:var(--r,1);object-fit:contain;border-radius:12px;display:block;background:#FFF6EE}
.cap{display:flex;align-items:baseline;justify-content:space-between;gap:6px}
.cap .k{font-size:11.5px;font-weight:600;color:#3D3833}
.cap .s{font-size:10px;color:#B69B83}
.fn{font-size:9.5px;color:#C4B8AC;font-family:Consolas,monospace}
</style></head><body>
<h1>插画总览质检</h1>
<p class="sub">共 ${total} 张 · 重点看：角色是否跑偏、构图是否可用、是否出现文字或多余元素</p>
${sections}
</body></html>`

  const outHtml = path.join(WORK, '插画总览.html')
  fs.writeFileSync(outHtml, html, 'utf8')
  const tmpHtml = path.join(TMP, 'p.html')
  fs.writeFileSync(tmpHtml, html, 'utf8')
  const outPng = path.join(WORK, '插画总览.png')
  execFileSync(
    EDGE,
    ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=2',
     '--window-size=1200,2100', '--virtual-time-budget=8000',
     `--screenshot=${outPng}`, 'file:///' + tmpHtml.replace(/\\/g, '/')],
    { stdio: 'ignore', timeout: 180000 },
  )
  console.log(`✅ ${outHtml}`)
  console.log(`✅ ${outPng}  （${total} 张）`)
}

main()
