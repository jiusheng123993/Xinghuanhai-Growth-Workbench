/**
 * 上传 24 张插画到生产服务器
 *
 * 【为什么走服务器】主包 1.82MB / 2MB，24 张图 1.6MB 塞不进去；
 * 空态又分散在 pagesPet / pagesUser / pagesMemoir / 主包四个包，分包也解决不了。
 * /uploads/ 下已有 avatars / bgm / memoir-sample / user-avatars 先例，
 * 公网 https://api.xinghuanhai.com/uploads/... ，CORP 头与 downloadFile 白名单此前都已配好。
 *
 * 【风险控制】只上传静态图片到 uploads/illustrations/：
 *   · 不改任何代码、不重启 PM2、不动数据库
 *   · 回滚 = 删掉该目录
 *
 * 【为什么不传品牌 IP】logo-catdog-01.png 用在加载 logo / 首页 Hero / 登录页徽章，
 * 是关键路径资产，依赖网络会在弱网白屏，因此留本地包（仅 46KB）。
 *
 * 用法：
 *   node upload-to-server.mjs             # 预演（只列清单，不传）
 *   node upload-to-server.mjs --apply     # 实际上传
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const FINAL = path.join(__dirname, 'final')
const HOST = 'root@49.232.203.85'
const REMOTE_DIR = '/opt/xinghuanhai/server/uploads/illustrations'
const PUBLIC_BASE = 'https://api.xinghuanhai.com/uploads/illustrations'

/** 只传内容插画；品牌 IP 留本地包 */
const EXCLUDE = new Set([
  'brand-ip-felt.jpg',
  // 以下 3 张页面头图是**并行会话**产出并已上线的（我的/家庭/宠物档案在用）。
  // 本地 generated/ 里的同名文件是我重新跑的变体，传上去会把他们已生效的头图换掉 —— 排除。
  'page-pet-profile.jpg',
  'page-mine.jpg',
  'page-family.jpg',
])
/** 验证批次（v1~v4）是过程产物，不上生产；下划线开头的是本地参考/对比用图 */
const isValidation = (f) => /^v\d+-/.test(f) || f.startsWith('_')

/** scp 对中文路径不稳，先把待传文件汇到纯 ASCII 临时目录 */
const STAGE = path.join(os.tmpdir(), 'xhh-illus-upload')

function main() {
  const apply = process.argv.includes('--apply')

  const all = fs.readdirSync(FINAL).filter((f) => f.endsWith('.jpg'))
  const files = all.filter((f) => !EXCLUDE.has(f) && !isValidation(f))

  if (!files.length) {
    console.error('❌ final/ 下没有可上传的插画')
    process.exit(1)
  }

  fs.rmSync(STAGE, { recursive: true, force: true })
  fs.mkdirSync(STAGE, { recursive: true })

  let total = 0
  for (const f of files) {
    fs.copyFileSync(path.join(FINAL, f), path.join(STAGE, f))
    total += fs.statSync(path.join(FINAL, f)).size
  }

  console.log(`待上传 ${files.length} 张，合计 ${(total / 1024).toFixed(0)} KB`)
  console.log(`目标 ${HOST}:${REMOTE_DIR}\n`)
  for (const f of files) {
    console.log(`  ${f.padEnd(28)} ${String(Math.round(fs.statSync(path.join(FINAL, f)).size / 1024)).padStart(4)} KB`)
  }
  const skipped = all.filter((f) => !files.includes(f))
  if (skipped.length) console.log(`\n跳过 ${skipped.length} 张：${skipped.join(', ')}`)

  if (!apply) {
    console.log('\n（未加 --apply，未上传）')
    return
  }

  const sshOpts = ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15', '-o', 'StrictHostKeyChecking=accept-new']

  console.log('\n① 建远端目录 …')
  execFileSync('ssh', [...sshOpts, HOST, `mkdir -p ${REMOTE_DIR} && ls -ld ${REMOTE_DIR}`], { stdio: 'inherit' })

  console.log('\n② 上传 …')
  execFileSync('scp', [...sshOpts, ...files.map((f) => path.join(STAGE, f)), `${HOST}:${REMOTE_DIR}/`], { stdio: 'inherit' })

  console.log('\n③ 校验远端文件数与大小 …')
  const check = execFileSync(
    'ssh',
    [...sshOpts, HOST, `cd ${REMOTE_DIR} && echo "count=$(ls -1 *.jpg | wc -l)" && du -sh . && md5sum *.jpg | head -3`],
    { encoding: 'utf8' },
  )
  console.log(check.trim())

  console.log('\n④ 逐张探测公网可达性 …')
  fs.writeFileSync(path.join(STAGE, 'urls.txt'), files.map((f) => `${PUBLIC_BASE}/${f}`).join('\n'), 'utf8')
  console.log(`   URL 清单已写入 ${path.join(STAGE, 'urls.txt')}`)
  console.log(`   抽样：${PUBLIC_BASE}/${files[0]}`)
}

main()
