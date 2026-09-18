/**
 * AGENTS.md 瘦身：把「项目记忆」节（占全文 86%）迁到独立文件，只留规则 + 指针
 *
 * 【为什么】AGENTS.md 114KB，但工作区指令注入预算只有 64KB → 末尾 50KB（后 155 行）AI 看不到。
 * 规则都在前 60 行是安全的，但「项目记忆」按时间追加、最新的在最末，恰好全被截断。
 *
 * 【安全策略】
 *   ① 先把记忆整段**复制**到 项目记忆/AGENTS-历史记忆.md（不删原文件任何内容）
 *   ② 再备份 AGENTS.md 为 AGENTS.md.bak-slim
 *   ③ 最后才把 AGENTS.md 里的记忆节替换成指针
 *   → 任何一步失败都不丢内容。
 *
 * 【校验】head + memory 行数必须等于原文行数；两段内容拼接后必须与原文逐字节一致。
 */
const fs = require('fs')

const AGENTS = 'E:/星河宠记/AGENTS.md'
const MEM_OUT = 'E:/星河宠记/项目记忆/AGENTS-历史记忆.md'

const raw = fs.readFileSync(AGENTS, 'utf8')
const eol = raw.includes('\r\n') ? '\r\n' : '\n'
const lines = raw.split(/\r?\n/)

// 定位「## 项目记忆」标题行
const idx = lines.findIndex((l) => /^##\s+项目记忆\s*$/.test(l))
if (idx < 0) {
  console.error('❌ 未找到「## 项目记忆」标题行，中止')
  process.exit(1)
}

const head = lines.slice(0, idx) // 规则部分（保留）
const memory = lines.slice(idx) // 记忆部分（迁出）

// 校验：两段拼起来必须等于原文
const rejoined = [...head, ...memory].join(eol)
if (rejoined !== raw) {
  console.error('❌ 切分校验失败：head+memory 与原文不一致，中止（未写任何文件）')
  process.exit(1)
}

// 安全检查：规则类小节必须都在 head 里（防止误把规则当记忆迁走）
const RULE_SECTIONS = ['## graphify', '## AI 能力配置', '## 提示词技能', '## UI 技能', '## 部署配置规范', '### 生产数据安全红线']
const headText = head.join('\n')
const missing = RULE_SECTIONS.filter((s) => !headText.includes(s))
if (missing.length) {
  console.error(`❌ 有规则小节落在记忆段里，中止：${missing.join(', ')}`)
  process.exit(1)
}

console.log('==== 切分结果 ====')
console.log(`  原文总行数 : ${lines.length}`)
console.log(`  规则段     : ${head.length} 行（保留在 AGENTS.md）`)
console.log(`  记忆段     : ${memory.length} 行（迁出）`)
console.log(`  规则小节校验: ${RULE_SECTIONS.length - missing.length}/${RULE_SECTIONS.length} 全部在保留段 ✅`)

// ── ① 写记忆文件 ──
const memHeader = [
  '# 星河宠记 · AGENTS.md 历史项目记忆',
  '',
  '> 本文件由 `AGENTS.md` 的「## 项目记忆」节整段迁出（2026-09-11）。',
  '>',
  '> **迁出原因**：AGENTS.md 长到 114 KB，超过工作区指令 64 KB 的注入预算，',
  '> 末尾约 50 KB 每次会话都被截断；而记忆是按时间追加的，**最新的恰好被砍掉**。',
  '> 迁出后 AGENTS.md 只留规则，永远完整可见；记忆改为按需读取本文件。',
  '>',
  '> 新增记忆请**追加到本文件末尾**。规则类内容仍写在 AGENTS.md 靠前位置。',
  '',
  '---',
  '',
].join(eol)

fs.writeFileSync(MEM_OUT, memHeader + memory.join(eol), 'utf8')
console.log(`\n① 记忆已写入 ${MEM_OUT}`)

// ── ② 备份 AGENTS.md ──
fs.copyFileSync(AGENTS, `${AGENTS}.bak-slim`)
console.log(`② 原文件已备份 ${AGENTS}.bak-slim`)

// ── ③ 替换为指针 ──
const pointer = [
  '## 项目记忆',
  '',
  '> 📌 **本项目的历史项目记忆已迁至独立文件**：`项目记忆/AGENTS-历史记忆.md`',
  '>',
  '> **迁出原因（2026-09-11）**：本节曾占 AGENTS.md 全文 86%，导致文件达 114 KB、',
  '> 超出工作区指令 64 KB 的注入预算，**末尾约 50 KB 每次会话都被截断**；',
  '> 而记忆按时间追加、最新的在最末，正好全在被截断的部分。',
  '>',
  '> 现在的分工：',
  '> - **AGENTS.md（本文件）** = 规则，必须完整可见 → 新增规则**加到靠前位置**，不要追加到末尾。',
  '> - **`项目记忆/AGENTS-历史记忆.md`** = 历史项目记忆（迁出前的内容）。',
  '> - **`项目记忆/progress.md`** = 近期会话进度日志（与上者是两套记录，不是重复）。',
  '>',
  '> 需要项目历史时主动读这两个文件，不要假设它们已在上下文里。',
  '',
].join(eol)

fs.writeFileSync(AGENTS, head.join(eol) + eol + pointer, 'utf8')
console.log(`③ AGENTS.md 已替换为指针`)

// ── 结果 ──
const after = fs.statSync(AGENTS).size
const memSize = fs.statSync(MEM_OUT).size
console.log('\n==== 结果 ====')
console.log(`  AGENTS.md          ${(raw.length / 1024).toFixed(1)} KB → ${(after / 1024).toFixed(1)} KB`)
console.log(`  AGENTS-历史记忆.md  ${(memSize / 1024).toFixed(1)} KB`)
console.log(`  注入预算 64 KB     ${after / 1024 <= 64 ? '✅ 在预算内，不再截断' : '❌ 仍超预算'}`)
