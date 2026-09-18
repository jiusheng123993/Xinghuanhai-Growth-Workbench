/**
 * 删除时光页里年度回忆/回忆录跳转的处理函数（两份重复，一次删净）
 *
 * 背景：迁移年度回忆到回忆录馆后，本页这些 handler 全部作废；
 * 且上一轮 edit 误把删除写成了插入，导致代码重复了两份。这里按行边界精确删除并校验。
 *
 * 注意：本文件是 CRLF 换行，必须按 /\r?\n/ 切分、写回时保持 CRLF，
 * 否则正则里的 $ 会因为行尾残留 \r 匹配不上（上一版脚本就栽在这）。
 */
const fs = require('fs')

const FILE = 'E:/星河宠记/03-源代码/小程序/miniapp/src/pages/timeline/index.tsx'

const raw = fs.readFileSync(FILE, 'utf8')
const eol = raw.includes('\r\n') ? '\r\n' : '\n'
const lines = raw.split(/\r?\n/)

const START = 550 // 第一份 const handleYearlyReview
const SECOND = 609 // 第二份（误插的重复）
const END = 667 // 空行，668 是 const petName

const at = (n) => (lines[n - 1] === undefined ? '(越界)' : lines[n - 1])

const checks = [
  [START, /^\s*const handleYearlyReview = useCallback\(async \(\) => \{$/],
  [SECOND, /^\s*const handleYearlyReview = useCallback\(async \(\) => \{$/],
  [607, /^\s*\}$/],
  [666, /^\s*\}$/],
  [END, /^\s*$/],
  [END + 1, /^\s*const petName = currentPet\?\.name \|\| '你的宠物'$/],
]

let ok = true
for (const [n, re] of checks) {
  if (!re.test(at(n))) {
    console.error(`❌ 边界校验失败：第 ${n} 行`)
    console.error(`   期望匹配: ${re}`)
    console.error(`   实际内容: ${JSON.stringify(at(n))}`)
    ok = false
  }
}
if (!ok) {
  console.error('\n未写任何文件。')
  process.exit(1)
}

console.log(`✅ 边界校验通过（换行符 ${eol === '\r\n' ? 'CRLF' : 'LF'}）`)
console.log(`   删除范围：第 ${START} ~ ${END} 行，共 ${END - START + 1} 行`)
console.log('   删除内容概览：')
for (const n of [START, 575, 585, 592, 601, SECOND]) {
  console.log(`      第 ${n} 行  ${at(n).trim()}`)
}
console.log(`   删除后接上：第 ${END + 1} 行  ${at(END + 1).trim()}`)

const out = [...lines.slice(0, START - 1), ...lines.slice(END)]
fs.copyFileSync(FILE, `${FILE}.bak-timelineclean`)
fs.writeFileSync(FILE, out.join(eol), 'utf8')
console.log(`\n✅ 已写入：${lines.length} 行 → ${out.length} 行（删除 ${lines.length - out.length} 行）`)
console.log(`   备份：${FILE}.bak-timelineclean`)
