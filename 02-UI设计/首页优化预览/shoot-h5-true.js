/**
 * 截取「真实 375px 视口」下的 H5 页面
 *
 * 【为什么绕一圈用 iframe】
 *   直接用 --window-size=375 --force-device-scale-factor=2 截图时，页面实际按约 208px 视口布局，
 *   截图里所有元素看起来大 ~1.8 倍并横向溢出 —— 我据此误判「创作页横向溢出」，
 *   实测 measure.html 在固定 375px iframe 里量 body.scrollWidth=375，根本没有溢出。
 *   所以改成：measure.html 提供 375px 的 iframe 装应用，这里截那个 iframe。
 *
 * 用法：node shoot-h5-true.js pet,creative
 */
const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

const OUT = 'E:/星河宠记/02-UI设计/首页优化预览/h5-real'
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
const BASE = 'http://127.0.0.1:8899'

const PAGES = {
  home: ['/pages/index/index', '今天'],
  creative: ['/pages/creative/index', '创作'],
  timeline: ['/pages/timeline/index', '时光'],
  pet: ['/pages/pet-profile/index', '宠物档案'],
  mine: ['/pages/mine/index', '我的'],
  family: ['/pages/family/index', '家庭'],
  checkin: ['/pagesPet/checkin/index', '健康打卡'],
  vaccine: ['/pagesPet/vaccine/index', '疫苗日历'],
  trends: ['/pagesPet/trends/index', '健康趋势'],
  achievement: ['/pagesPet/achievement/index', '成就'],
  chronic: ['/pagesPet/chronic-tracking/index', '慢病追踪'],
  healthreport: ['/pagesPet/health-report/index', '健康报告'],
  lineage: ['/pagesPet/family/lineage/index', '家庭图谱'],
  memoir: ['/pagesMemoir/memoir-center/index', '回忆录馆'],
  settings: ['/pagesUser/settings/index', '设置'],
  add: ['/pagesPet/add/index', '添加宠物'],
  food: ['/pagesPet/food-query/index', '食物查询'],
}

/** 高度按页面内容给，避免截断；iframe 内可滚动，这里给足 */
const HEIGHT = { home: 1600, creative: 1500, timeline: 1500, pet: 1800, mine: 1500, trends: 1800, healthreport: 1800, chronic: 1600, memoir: 1500 }
const DEFAULT_H = 1200

function shoot(key, route) {
  const h = HEIGHT[key] || DEFAULT_H
  const out = path.join(OUT, `true-${key}.png`)
  const url = `${BASE}/measure.html?clean=1&h=${h}&to=${encodeURIComponent(route)}`
  try {
    execFileSync(
      EDGE,
      [
        '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
        // 视口只用来装 iframe：宽度略大于 375 即可，保持不变
        `--window-size=390,${h}`,
        '--virtual-time-budget=25000',
        `--user-data-dir=${path.join(process.env.TEMP || '/tmp', 'xhh-true-' + key)}`,
        `--screenshot=${out}`,
        url,
      ],
      { stdio: 'ignore', timeout: 150000 },
    )
    const size = fs.existsSync(out) ? fs.statSync(out).size : 0
    return { key, route, h, size, ok: size > 5000 }
  } catch (e) {
    return { key, route, h, size: 0, ok: false, err: e.message }
  }
}

function main() {
  fs.mkdirSync(OUT, { recursive: true })
  const want = process.argv[2] ? process.argv[2].split(',') : Object.keys(PAGES)
  const results = []
  for (const k of want) {
    const p = PAGES[k]
    if (!p) { console.log(`  ⚠️ 未知页面 ${k}`); continue }
    const r = shoot(k, p[0])
    results.push({ ...r, name: p[1] })
    console.log(`  ${r.ok ? '✅' : '❌'} ${k.padEnd(13)} ${p[1].padEnd(6)} h=${String(r.h).padStart(4)}  ${(r.size / 1024).toFixed(0).padStart(4)}KB`)
  }
  fs.writeFileSync(path.join(OUT, 'true-index.json'), JSON.stringify(results, null, 2), 'utf8')
  console.log(`\n共 ${results.filter((r) => r.ok).length} / ${results.length} 张 → ${OUT}`)
}

main()
