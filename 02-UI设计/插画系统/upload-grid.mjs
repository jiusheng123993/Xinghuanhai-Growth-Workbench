/**
 * 只上传本次新增的 6 张「宫格插画」到生产服务器
 *
 * 【为什么不直接跑 upload-to-server.mjs】那个脚本会把 final/ 下**全部** 30 张重传一遍。
 * 其中 page-* 三张是并行会话产出并已上线的，虽然它在 EXCLUDE 里，
 * 但整批重传对本任务没有必要，也可能踩到别人正在改的东西。
 * 这里只挑 grid-*.jpg，最小动作面。
 *
 * 【风险控制（与原脚本同一套口径）】
 *   · 只往 uploads/illustrations/ 加 6 个静态图片文件
 *   · 不改任何代码、不重启 PM2、不动数据库、不改 nginx
 *   · 回滚 = ssh 上去 rm 这 6 个文件
 *
 * 用法：
 *   node upload-grid.mjs            # 预演，只列清单
 *   node upload-grid.mjs --apply    # 实际执行
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

/** scp 对中文路径不稳，先汇到纯 ASCII 临时目录（与 upload-to-server.mjs 同做法） */
const STAGE = path.join(os.tmpdir(), 'xhh-grid-upload')
const SSH_OPTS = ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15', '-o', 'StrictHostKeyChecking=accept-new']

function main() {
  const apply = process.argv.includes('--apply')
  const files = fs.readdirSync(FINAL).filter((f) => /^grid-.*\.jpg$/.test(f)).sort()

  if (!files.length) {
    console.error('❌ final/ 下没有 grid-*.jpg，请先跑 postprocess-grid.mjs')
    process.exit(1)
  }

  fs.rmSync(STAGE, { recursive: true, force: true })
  fs.mkdirSync(STAGE, { recursive: true })

  let total = 0
  console.log(`待上传 ${files.length} 张：\n`)
  for (const f of files) {
    const src = path.join(FINAL, f)
    const bytes = fs.statSync(src).size
    total += bytes
    fs.copyFileSync(src, path.join(STAGE, f))
    console.log(`  ${f.padEnd(22)} ${String(Math.round(bytes / 1024)).padStart(4)} KB`)
  }
  console.log(`\n合计 ${(total / 1024).toFixed(0)} KB → ${HOST}:${REMOTE_DIR}`)

  if (!apply) {
    console.log('\n（未加 --apply，未上传。预演通过后再加 --apply 执行）')
    return
  }

  console.log('\n① 建远端目录并记录上传前文件数 …')
  console.log(
    execFileSync('ssh', [...SSH_OPTS, HOST, `mkdir -p ${REMOTE_DIR} && echo "before=$(ls -1 ${REMOTE_DIR}/*.jpg 2>/dev/null | wc -l)"`], {
      encoding: 'utf8',
    }).trim(),
  )

  console.log('\n② 上传 …')
  execFileSync('scp', [...SSH_OPTS, ...files.map((f) => path.join(STAGE, f)), `${HOST}:${REMOTE_DIR}/`], { stdio: 'inherit' })

  console.log('\n③ 校验远端 …')
  console.log(
    execFileSync(
      'ssh',
      [...SSH_OPTS, HOST, `cd ${REMOTE_DIR} && echo "after=$(ls -1 *.jpg | wc -l)" && ls -l grid-*.jpg | awk '{print $5, $9}'`],
      { encoding: 'utf8' },
    ).trim(),
  )

  console.log('\n④ 逐张探测公网 URL …')
  for (const f of files) {
    const url = `${PUBLIC_BASE}/${f}`
    let code = 'ERR'
    try {
      code = execFileSync('curl', ['-s', '-o', '/dev/null', '-w', '%{http_code} %{content_type} %{size_download}', '-I', url], {
        encoding: 'utf8',
        timeout: 20000,
      }).trim()
    } catch (e) {
      code = 'ERR ' + e.message
    }
    console.log(`  ${code}  ${url}`)
  }
  console.log('\n回滚：ssh ' + HOST + ` "rm ${files.map((f) => REMOTE_DIR + '/' + f).join(' ')}"`)
}

main()
