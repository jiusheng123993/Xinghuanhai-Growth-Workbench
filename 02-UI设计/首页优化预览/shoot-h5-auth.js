/**
 * 带登录态抓取 H5 真实页面
 *
 * 【踩坑】Edge 无头模式下 localStorage 不跨进程持久化：
 *   分两次运行（先 seed、再截图）共享 --user-data-dir 行不通，实测第二次 dump 得到 COUNT=0。
 *   解法：让 seed.html 写完存储后，在**同一次进程内** location.replace 到目标页，
 *   由 --virtual-time-budget 等应用渲染完再截图。
 *
 * 【为什么费这个劲】此前所有"效果对比图"都是手搓 HTML 模拟的，导致我误判
 *   「其他页面也优化了」——实际没有。有了这条链路才能真看见改造成果。
 *   可行性依据：utils/jwt.ts 的 isTokenFormatValid 只校验三段结构 + exp，不验签。
 *
 * ⚠️ 仅本地 H5 预览使用，不进小程序产物、不连生产接口。
 *
 * 用法：node shoot-h5-auth.js [page1,page2,...]
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

function shoot(key, route, height = 812) {
  const out = path.join(OUT, `auth-${key}.png`)
  const seedUrl = `${BASE}/seed.html?to=${encodeURIComponent(route)}`
  try {
    execFileSync(
      EDGE,
      [
        '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
        '--force-device-scale-factor=2', `--window-size=375,${height}`,
        // 种子页要跑 JS 再跳转、目标页要等接口 mock 返回，预算给足
        '--virtual-time-budget=25000',
        `--user-data-dir=${path.join(process.env.TEMP || '/tmp', 'xhh-edge-auth-' + key)}`,
        `--screenshot=${out}`,
        seedUrl,
      ],
      { stdio: 'ignore', timeout: 150000 },
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
  fs.writeFileSync(path.join(OUT, 'auth-index.json'), JSON.stringify(results, null, 2), 'utf8')
  console.log(`\n共 ${results.filter((r) => r.ok).length} / ${results.length} 张 → ${OUT}`)
}

main()
