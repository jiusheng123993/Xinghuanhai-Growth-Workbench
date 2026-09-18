/**
 * 品牌插画样图生成（同题材 · 两种风格对照）
 *
 * 【背景】用户判断「我们没那么好看是因为图片不够多」。核查后更准确的结论是：
 *   全项目 47 个页面，真正的品牌插画只有 7 张，绝大多数页面/空态零插画 —— 数量确实少；
 *   但更要命的是**风格不成体系**：品牌 IP（logo-catdog-01.png）是 3D 黏土质感，
 *   而登录主视觉的生成提示词写的是「柔和扁平质感」，两套风格在同一个 App 里打架。
 *   所以不能盲目加图，否则只会更乱。
 *
 * 【本脚本】固定同一角色、同一场景，只换画风，产出对照样图供选型：
 *   A = 3D 黏土/毛绒（对齐现有品牌 IP logo-catdog-01.png）
 *   B = 柔和扁平插画（对齐现有登录主视觉 login-hero.png）
 *
 * 提示词按《pet-prompt-engine》技能公式组装：
 *   {主体}+{外貌}+{表情}+{画风}+{光影氛围}+{画质}+{角色锁定}+{主体锁定}
 * 金科玉律照旧：不写宠物名字（这里的猫狗是品牌固定角色，不涉及用户宠物）、
 *   数量锁定（只出现这两只）、干净背景无文字无水印。
 *
 * 密钥只从 server/.env 读取，绝不打印、绝不写进代码。
 *
 * 用法：node gen-illustration-samples.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const envPath = 'E:/星河宠记/03-源代码/server/.env'
const OUT_DIR = path.join(__dirname, 'samples')

/** 读 .env 只取需要的键（手写解析，不引入 dotenv） */
function readEnv(file) {
  const env = {}
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
  return env
}

/** 角色锁定 + 主体锁定（所有样图共用，保证是"同一只猫同一只狗"） */
const CHARACTER = [
  '一只橘色虎斑小猫和一只奶油色小金毛',
  '猫咪是橘色底毛带深棕色虎斑条纹、额头有 M 形纹路、白色下巴和胸口、圆脸大眼、粉色小鼻子；',
  '小狗是奶油色卷毛、垂耳、圆润体型、黑亮圆鼻头；',
].join('')

const SCENE =
  '两只并排坐在一起，一起望向面前一本摊开的空白相册，神态温柔又期待，猫咪微微歪头，小狗嘴角上扬；'

const QUALITY =
  '高质量，细节丰富，柔和暖光，干净背景，居中构图，四周留白，画面温馨治愈，无文字，无水印，无logo；'

const LOCK =
  '画面中只出现这一只猫和这一只狗，不要出现其他动物、人物或道具；同一组角色，毛色与体型保持一致。'

/** 两种候选画风 */
const STYLES = [
  {
    key: 'A-3d-clay',
    label: '3D 黏土毛绒',
    style:
      '3D 黏土质感渲染，柔软毛绒材质，圆润可爱的造型，高光泽柔和表面，类似皮克斯 3D 动画电影的质感；',
    bg: '淡奶油色到浅暖橙的柔和渐变背景，暖色调；',
  },
  {
    key: 'B-soft-flat',
    label: '柔和扁平插画',
    style:
      '柔和扁平插画风格，简约流畅的线条，大色块铺陈，柔和的边缘过渡，轻微纸张颗粒质感，治愈系绘本感；',
    bg: '奶油白纯色背景，点缀少量暖橙与浅金色小星点；',
  },
]

async function generate(apiKey, prompt, outPath) {
  const resp = await fetch('https://ark.cn-beijing.volces.com/api/v3/images/generations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: 'doubao-seedream-4-0-250828',
      prompt,
      size: '1024x1024',
      n: 1,
      // 品牌自有插画不是「展示给用户看的 AI 生成内容」，不能带平台水印
      watermark: false,
    }),
  })
  if (!resp.ok) {
    const text = await resp.text().catch(() => '')
    throw new Error(`生成失败 ${resp.status}: ${text.slice(0, 300)}`)
  }
  const data = await resp.json()
  const url = data?.data?.[0]?.url
  if (!url) throw new Error('返回中没有图片 URL')

  const imgResp = await fetch(url)
  if (!imgResp.ok) throw new Error(`下载失败 ${imgResp.status}`)
  const buf = Buffer.from(await imgResp.arrayBuffer())
  fs.writeFileSync(outPath, buf)
  return buf.length
}

async function main() {
  const env = readEnv(envPath)
  const apiKey = env.SEEDREAM_API_KEY
  if (!apiKey) {
    console.error('❌ server/.env 里没有 SEEDREAM_API_KEY')
    process.exit(1)
  }
  fs.mkdirSync(OUT_DIR, { recursive: true })

  const results = []
  for (const s of STYLES) {
    const prompt = `${CHARACTER}${SCENE}${s.style}${s.bg}${QUALITY}${LOCK}`
    const outPath = path.join(OUT_DIR, `${s.key}.png`)
    process.stdout.write(`生成 ${s.label} … `)
    try {
      const bytes = await generate(apiKey, prompt, outPath)
      console.log(`✅ ${(bytes / 1024).toFixed(0)} KB`)
      results.push({ ...s, outPath, bytes, prompt })
    } catch (e) {
      console.log(`❌ ${e.message}`)
    }
  }

  fs.writeFileSync(
    path.join(OUT_DIR, 'prompts.json'),
    JSON.stringify(results.map((r) => ({ key: r.key, label: r.label, prompt: r.prompt })), null, 2),
    'utf8',
  )
  console.log(`\n产出 ${results.length} 张 → ${OUT_DIR}`)
}

main()
