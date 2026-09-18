/**
 * 抓取 H5 构建的真实页面截图
 *
 * 【为什么做这个】此前所有"优化效果"都是我手搓 HTML 模拟出来的（几何抄 SCSS），
 * 不是真实渲染。用户反馈「除了今天之外其他界面一点变化没有」时，
 * 我手上其实没有任何一张真实页面截图可以自证 —— 只能靠推断。
 * 这里改成从 dist-h5 真实渲染，先看见，再谈改。
 *
 * 用法：node shoot-h5.js [page1,page2,...]
 */
const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

const OUT = 'E:/星河宠记/02-UI设计/首页优化预览/h5-real'
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
const BASE = 'http://127.0.0.1:8899'
const PROFILE = path.join(process.env.TEMP || '/tmp', 'xhh-edge-profile')

/** 要抓的页面：key → [路由, 中文名] */
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
}

function shoot(key, route, height = 812) {
  const out = path.join(OUT, `${key}.png`)
  try {
    execFileSync(
      EDGE,
      [
        '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
        '--force-device-scale-factor=2', `--window-size=375,${height}`,
        '--virtual-time-budget=15000', `--user-data-dir=${PROFILE}`,
        `--screenshot=${out}`,
        `${BASE}/#${route}`,
      ],
      { stdio: 'ignore', timeout: 120000 },
    )
    const size = fs.existsSync(out) ? fs.statSync(out).size : 0
    return { key, route, out, size, ok: size > 5000 }
  } catch (e) {
    return { key, route, out, size: 0, ok: false, err: e.message }
  }
}

function main() {
  fs.mkdirSync(OUT, { recursive: true })
  const want = process.argv[2] ? process.argv[2].split(',') : Object.keys(PAGES)
  const results = []
  for (const k of want) {
    const p = PAGES[k]
    if (!p) {
      console.log(`  ⚠️ 未知页面 ${k}`)
      continue
    }
    const r = shoot(k, p[0])
    results.push({ ...r, name: p[1] })
    console.log(`  ${r.ok ? '✅' : '❌'} ${k.padEnd(14)} ${p[1].padEnd(6)} ${(r.size / 1024).toFixed(0).padStart(4)}KB`)
  }
  fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify(results, null, 2), 'utf8')
  console.log(`\n共 ${results.filter((r) => r.ok).length} / ${results.length} 张成功 → ${OUT}`)
}

main()
