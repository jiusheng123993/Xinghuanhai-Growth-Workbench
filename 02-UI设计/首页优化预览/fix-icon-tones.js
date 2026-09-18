/**
 * 把硬编码主题色板色值的 <Icon> 调用改为语义 tone
 *
 * 【为什么】图标用 SVG data URI 渲染，颜色写死进 SVG，拿不到页面 CSS 变量。
 * 硬编码 #E8920A 之类的色值只在默认主题（暖阳珊瑚橙）下正确，
 * 切到 spring/summer/winter/starry 后图标色不跟着变，而它所在的 tint 底色
 * （rgba(var(--gold-deep-rgb), α)）却变了 → 出现「底变色不变」的违和。
 *
 * 色值 → tone 映射（与 styles/_theme.scss 的变量一一对应）：
 *   #FF5A5F → danger     #E8920A → gold-deep   #FFB020 → gold
 *   #4FA3E3 → teal       #2FC98E → success / sage
 *
 * 【安全】按行号 + 原文精确匹配替换，任一条对不上就整体中止，不写半个文件。
 */
const fs = require('fs')

const SRC = 'E:/星河宠记/03-源代码/小程序/miniapp/src'

/** 逐条列出要改的位置：文件、行号、替换前原文、替换后原文 */
const EDITS = [
  {
    file: 'pagesPet/add/index.tsx',
    line: 650,
    from: `<Icon name='prohibit' size={18} color='#FF5A5F' />`,
    to: `<Icon name='prohibit' size={18} tone='danger' />`,
    why: '忌口提示 = 危险语义',
  },
  {
    file: 'pagesPet/checkin/index.tsx',
    line: 681,
    from: `<Icon name='bowl-food' size={18} color='#E8920A' />`,
    to: `<Icon name='bowl-food' size={18} tone='gold-deep' />`,
    why: '所在宫格底色是 --gold-deep tint',
  },
  {
    file: 'pagesPet/checkin/index.tsx',
    line: 708,
    from: `<Icon name='smiley' size={18} color='#4FA3E3' />`,
    to: `<Icon name='smiley' size={18} tone='teal' />`,
    why: '所在宫格底色是 --teal tint',
  },
  {
    file: 'pagesPet/checkin/index.tsx',
    line: 735,
    from: `<Icon name='footprints' size={18} color='#2FC98E' />`,
    to: `<Icon name='footprints' size={18} tone='success' />`,
    why: '所在宫格底色是 --success tint',
  },
  {
    file: 'pagesPet/checkin/index.tsx',
    line: 866,
    from: `<Icon name='warning' size={36} color='#FFB020' className='pet-checkin__feedback-icon' />`,
    to: `<Icon name='warning' size={36} tone='gold' className='pet-checkin__feedback-icon' />`,
    why: '异常提醒用警示金',
  },
  {
    file: 'pagesPet/food-query/index.tsx',
    line: 419,
    from: `<Icon name='warning' size={18} color='#FF5A5F' />`,
    to: `<Icon name='warning' size={18} tone='danger' />`,
    why: '有害成分 = 危险',
  },
  {
    file: 'pagesPet/food-query/index.tsx',
    line: 435,
    from: `<Icon name='scales' size={18} color='#E8920A' />`,
    to: `<Icon name='scales' size={18} tone='gold-deep' />`,
    why: '中毒剂量 = 警告金',
  },
  {
    file: 'pagesPet/food-query/index.tsx',
    line: 471,
    from: `<Icon name='warning' size={18} color='#E8920A' />`,
    to: `<Icon name='warning' size={18} tone='gold-deep' />`,
    why: '品种警告 = 警告金',
  },
  {
    file: 'pagesPet/vaccine/index.tsx',
    line: 446,
    from: `<Icon name='warning' size={14} color='#FF5A5F' className='pet-vaccine__next-due-item-icon' />`,
    to: `<Icon name='warning' size={14} tone='danger' className='pet-vaccine__next-due-item-icon' />`,
    why: '逾期项 = 危险红，与 --overdue 红底呼应',
  },
  {
    file: 'pagesPet/vaccine/index.tsx',
    line: 488,
    from: `<Icon name='warning' size={16} color='#FF5A5F' className='pet-vaccine__reminder-icon' />`,
    to: `<Icon name='warning' size={16} tone='danger' className='pet-vaccine__reminder-icon' />`,
    why: '逾期提醒 = 危险红',
  },
  {
    file: 'pagesPet/vaccine/index.tsx',
    line: 615,
    from: `<Icon name='trophy' size={14} color='#2FC98E' />`,
    to: `<Icon name='trophy' size={14} tone='success' />`,
    why: '已完成 = 成功绿',
  },
  {
    file: 'pagesPet/vaccine/index.tsx',
    line: 639,
    from: `<Icon name='lightbulb' size={18} color='#E8920A' />`,
    to: `<Icon name='lightbulb' size={18} tone='gold-deep' />`,
    why: '金色浅底上的图标',
  },
  {
    file: 'pagesUser/effect-tracking/index.tsx',
    line: 359,
    from: `<Icon name='check-circle' size={18} color='#2FC98E' />`,
    to: `<Icon name='check-circle' size={18} tone='success' />`,
    why: '已采纳 = 成功绿',
  },
]

function main() {
  const apply = process.argv.includes('--apply')

  // 第一遍：全部校验，任一条不符就中止（不写半个文件）
  const byFile = {}
  for (const e of EDITS) {
    const abs = `${SRC}/${e.file}`
    if (!byFile[abs]) byFile[abs] = { lines: fs.readFileSync(abs, 'utf8').split('\n'), edits: [] }
    const actual = byFile[abs].lines[e.line - 1]
    if (!actual || !actual.includes(e.from)) {
      console.error(`❌ 校验失败，已中止（未写任何文件）`)
      console.error(`   ${e.file}:${e.line}`)
      console.error(`   期望包含: ${e.from}`)
      console.error(`   实际内容: ${actual === undefined ? '(行不存在)' : actual.trim()}`)
      process.exit(1)
    }
    byFile[abs].edits.push(e)
  }
  console.log(`✅ 校验通过：${EDITS.length} 处全部匹配\n`)

  // 第二遍：写入
  for (const [abs, { lines, edits }] of Object.entries(byFile)) {
    for (const e of edits) {
      lines[e.line - 1] = lines[e.line - 1].replace(e.from, e.to)
    }
    if (apply) {
      fs.copyFileSync(abs, `${abs}.bak-icontone`)
      fs.writeFileSync(abs, lines.join('\n'), 'utf8')
    }
    console.log(`  ${abs.replace(SRC + '/', '')}  ${edits.length} 处`)
    for (const e of edits) console.log(`      ${e.from.match(/name='([a-z-]+)'/)[1].padEnd(14)} → tone='${e.to.match(/tone='([a-z-]+)'/)[1]}'   （${e.why}）`)
  }

  console.log(apply ? '\n✅ 已写入（每文件旁留 .bak-icontone 备份）' : '\n（未加 --apply，文件未改动）')
}

main()
