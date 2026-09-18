/**
 * 星河宠记 · 品牌插画批量生成器
 *
 * 【风格锁定】用户已定方案 A：3D 黏土毛绒（与品牌 IP logo-catdog-01.png 同源）
 *
 * 【角色一致性怎么保证】这是全套插画成败的关键 —— AI 每张画出来的猫狗容易"换脸"。
 * 做法是双保险：
 *   ① 把品牌 IP（logo-catdog-01.png）作为参考图喂给 Seedream（Seedream 4.0 支持 images 数组，
 *      server 的 familyPhotoService 就是这么用的）；
 *   ② 提示词里逐字重复同一段角色锚点描述（毛色/花纹/五官/材质），并显式声明"保持与参考图一致"。
 *   —— 对应《pet-prompt-engine》技能 §七 角色锁定表与金科玉律第 4 条。
 *
 * 【数量锁定】画面中只出现这一只猫和这一只狗（金科玉律第 3 条，防模型加戏）。
 *
 * 提示词按技能 §三 公式组装：
 *   {主体}+{外貌}+{表情}+{画风}+{光影氛围}+{画质}+{角色锁定}+{主体锁定}
 *
 * 密钥只从 server/.env 读取，绝不打印、绝不写进代码。
 *
 * 用法：
 *   node gen-illustrations.mjs --batch=validate   # 4 张跨场景验证角色一致性
 *   node gen-illustrations.mjs --batch=empty      # 空态插画
 *   node gen-illustrations.mjs --batch=header     # 功能头图
 *   node gen-illustrations.mjs --batch=moment     # 激励时刻
 *   node gen-illustrations.mjs --batch=share      # 分享卡背景
 *   node gen-illustrations.mjs --batch=all
 *   node gen-illustrations.mjs --only=<key>       # 单张重跑
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '../..')
const ENV_PATH = path.join(ROOT, '03-源代码', 'server', '.env')
const REF_IP = path.join(__dirname, 'reference', 'brand-ip-felt.jpg')
const OUT_DIR = path.join(__dirname, 'generated')
const API = 'https://ark.cn-beijing.volces.com/api/v3/images/generations'
const MODEL = 'doubao-seedream-4-0-250828'

// ─────────────────────────────────────────────
// 角色锚点（每张图逐字重复，防止跨图换脸）
//
// 【踩坑记录】初版只写「奶油色卷毛小狗」——太含糊，模型在 header-family-photo
// 那张把它画成了**巴哥犬**（扁脸、黑口鼻罩、满脸褶子），角色直接断掉。
// 教训：角色锚点必须写到「品种级」并补**排除项**，否则模型会自由发挥。
// ─────────────────────────────────────────────
const CHARACTERS =
  '画面里有一只橘色虎斑小猫和一只奶油色卷毛小狗，两只都是毛毡玩偶质感：' +
  '小猫是橘色短毛配深棕色虎斑条纹、额头有 M 形纹路、白色下巴与胸口、白色嘴套、' +
  '脸圆、眼睛大而黑且圆、鼻子是小小的粉色三角、粉色内耳、白色四爪；' +
  '小狗是**奶油色玩具贵宾（泰迪）造型**：全身紧密的奶油色小卷毛、长垂耳、' +
  '口鼻部短而微微前突但**绝不是扁脸**、鼻子是**中小号的黑色圆珠鼻**、黑色圆眼、' +
  '没有脸部褶皱、没有黑色口鼻罩；' +
  '两只角色的外形、配色、材质必须与参考图完全一致，不要改变品种与毛色。' +
  '绝对不要画成巴哥犬、斗牛犬、拳师犬、法斗等扁脸短鼻犬，不要出现脸部褶皱或黑色面罩。'

// ─────────────────────────────────────────────
// 风格锚点（方案 A：3D 黏土毛绒）
// ─────────────────────────────────────────────
const STYLE =
  '3D 黏土毛绒质感渲染，柔软绒毛材质，圆润可爱的造型，高光泽柔和表面，' +
  '类似皮克斯与黏土动画电影的质感；' +
  '柔和间接光照，暖色调，淡奶油色到浅暖橙的渐变背景，画面温馨治愈。'

const QUALITY =
  '高质量，细节丰富，光线柔和，构图干净，无文字，无水印，无 logo，无边框。'

const LOCK = '画面中只出现这一只猫和这一只狗，不要出现其他动物或人物。'

/** 通用尾缀 */
const tail = (composition) => `${STYLE}${composition}${QUALITY}${LOCK}`

// ─────────────────────────────────────────────
// 插画清单
// ─────────────────────────────────────────────
const PLATES = {
  // ── 验证批次：4 个差异极大的场景，用来检验角色是否跨场景稳定 ──
  validate: [
    {
      key: 'v1-empty-album',
      scene: '小猫和小狗并排坐在一起，一起低头望向面前一本摊开的空白相册，神态温柔又期待，猫咪微微歪头。',
      composition: '主体居中，四周留白充足，正方形构图。',
    },
    {
      key: 'v2-empty-bowl',
      scene: '小猫用爪子轻轻碰一只空空的饭碗，小狗在旁边歪头看，两只都露出疑惑又期待的表情。',
      composition: '主体居中，四周留白充足，正方形构图。',
    },
    {
      key: 'v3-moment-streak',
      scene:
        '小猫和小狗开心地一起举起前爪庆祝，周围飘着几颗暖金色小星星和几个彩色气球，气氛热烈欢快。',
      composition: '主体居中偏下，上方留出放文字的空间，正方形构图。',
    },
    {
      key: 'v4-header-memoir',
      scene:
        '小猫和小狗并排坐在影院红色座椅上，前方是一块发出暖光的空白银幕，两只都抬头期待地看着银幕。',
      composition: '横向构图，主体偏左，右侧留出放标题文字的空间。',
    },
  ],

  // ── 空态插画（74 处空态里最高频的场景）──
  empty: [
    { key: 'empty-timeline', scene: '小猫和小狗并排坐着望向面前一本摊开的空白相册，神态温柔期待，猫咪微微歪头。', composition: '主体居中，四周留白充足，正方形构图。' },
    { key: 'empty-checkin', scene: '小猫和小狗一起看着一块空白的打卡记录板，小狗歪头，猫爪搭在板子边上，表情好奇。', composition: '主体居中，四周留白充足，正方形构图。' },
    { key: 'empty-pet', scene: '一只空空的小窝放在画面中央，小猫和小狗从两侧探进头来看向窝里，表情好奇又期待。', composition: '主体居中，四周留白充足，正方形构图。' },
    { key: 'empty-search', scene: '小猫和小狗一起低头看一枚立在地上的放大镜，镜片里空空的，两只表情疑惑。', composition: '主体居中，四周留白充足，正方形构图。' },
    { key: 'empty-photo', scene: '小猫和小狗好奇地看着一个空的相框，相框里是空白的奶油色，两只脑袋挤在一起往里看。', composition: '主体居中，四周留白充足，正方形构图。' },
    { key: 'empty-chart', scene: '小猫和小狗一起看着一块空白的成长曲线板，板子上只有淡淡的网格线没有数据，两只神情期待。', composition: '主体居中，四周留白充足，正方形构图。' },
    { key: 'empty-vaccine', scene: '小猫和小狗一起看着一本空白的日历，日历上只有淡淡格子没有标记，小狗用爪子指着日历。', composition: '主体居中，四周留白充足，正方形构图。' },
    {
      key: 'empty-family',
      scene:
        '小猫和小狗分别坐在一块空坐垫的左右两侧，两只都扭头看向中间那块空坐垫，神情温柔期待。',
      composition: '主体居中，四周留白充足，正方形构图。',
    },
    { key: 'empty-achievement', scene: '小猫和小狗一起看着一个空空的奖杯陈列架，架子上没有奖杯，两只抬头仰望，表情期待。', composition: '主体居中，四周留白充足，正方形构图。' },
    { key: 'empty-message', scene: '小猫和小狗一起好奇地看着一个空白的对话气泡，气泡里空空的，两只凑在一起望进去。', composition: '主体居中，四周留白充足，正方形构图。' },
  ],

  // ── 功能头图（横版，右侧留标题位）──
  header: [
    { key: 'header-memoir', scene: '小猫和小狗并排坐在影院座椅上，抬头望向前方发出暖光的空白银幕，期待又温馨。', composition: '横向构图，主体偏左，右侧大片留白。' },
    { key: 'header-avatar-studio', scene: '小猫站在一面化妆镜前，镜子里映出它自己，小狗在旁边叼着一件小披风，像在准备变装。', composition: '横向构图，主体偏左，右侧大片留白。' },
    { key: 'header-health', scene: '小狗坐在检查台上，小猫在旁边举着一块写有空白横线的健康记录板，两只神情认真又可爱。', composition: '横向构图，主体偏左，右侧大片留白。' },
    { key: 'header-family-photo', scene: '小猫和小狗并排坐好，一起看向前方像在配合拍全家福，身后是一块奶油色的空白背景布。', composition: '横向构图，主体偏左，右侧大片留白。' },
    { key: 'header-naming', scene: '小猫和小狗一起盯着一块空白的小木牌，木牌上还没有字，小狗歪头思考，猫爪摸着下巴。', composition: '横向构图，主体偏左，右侧大片留白。' },
  ],

  // ── 激励时刻（情绪高光）──
  moment: [
    { key: 'moment-streak-7', scene: '小猫和小狗开心地一起举起前爪庆祝，头顶飘着一个写着数字 7 的暖金色气球，周围有小星星。', composition: '主体居中偏下，上方留白放文字，正方形构图。' },
    { key: 'moment-streak-30', scene: '小猫和小狗戴着小小的纸皇冠一起欢呼，周围飘着暖金色小星星和彩带，气氛热烈。', composition: '主体居中偏下，上方留白放文字，正方形构图。' },
    { key: 'moment-birthday', scene: '小猫和小狗围着一个插着蜡烛的小蛋糕，蜡烛上有一小簇暖光，两只开心地眯眼笑。', composition: '主体居中偏下，上方留白放文字，正方形构图。' },
    { key: 'moment-anniversary', scene: '小猫和小狗一起举着一块心形的小牌子，牌子是空白的暖橙色，两只贴在一起开心地笑。', composition: '主体居中偏下，上方留白放文字，正方形构图。' },
    { key: 'moment-achievement', scene: '小猫和小狗一起站在一个小小的领奖台上，小狗举着一枚暖金色的奖牌，两只都神气又开心。', composition: '主体居中偏下，上方留白放文字，正方形构图。' },
    { key: 'moment-first-checkin', scene: '小猫和小狗一起用爪子按下一个大大的暖橙色圆形按钮，按钮下方漾出暖光，两只兴奋地看着。', composition: '主体居中偏下，上方留白放文字，正方形构图。' },
  ],

  // ── 分享卡背景（能铺满、不抢文字）──
  share: [    { key: 'share-card-warm', scene: '小猫和小狗在画面角落安静地并排坐着，姿态放松，主体缩小，画面大部分是柔和的奶油色与暖橙渐变。', composition: '主体置于右下角且较小，画面大片留白，横向构图。' },
    { key: 'share-card-starry', scene: '小猫和小狗坐在一个小山丘上一起仰望星空，夜空是深蓝到暖紫渐变并点缀暖金色小星星，主体较小。', composition: '主体置于下方居中且较小，上方大片夜空留白，竖向构图。' },
    { key: 'share-card-soft', scene: '小猫和小狗的背影坐在窗边，窗外是柔和的暖橙色夕阳光晕，主体很小，画面以光晕和留白为主。', composition: '主体置于左下角且较小，画面大片留白，竖向构图。' },
  ],

  // ── 品牌 IP（毛毡质感版，替换现状光滑磨砂版，让全站质感 100% 统一）──
  // 构图必须对齐现有 logo-catdog-01.png：方形、两只半身像并排、面朝镜头、干净奶油底，
  // 这样首页 Hero（280rpx 方形容器）、加载 logo、登录页徽章三处都能直接替换。
  brand: [
    {
      key: 'brand-ip-felt',
      scene:
        '小猫和小狗的头部与上半身特写，两只并排靠在一起正面朝向镜头，猫咪微微歪头眯眼微笑，小狗张嘴开心笑露出舌头，主体占满画面中央，背景是干净无杂物的淡奶油色。',
      composition: '正方形构图，两只主体居中且大小接近，四周留白均匀，不要出现其他物体。',
    },
  ],

  // ── 页面头图（宠物档案 / 我的 / 家庭）──
  // 与 header-* 同类：主体偏左、右侧留白，用于页面顶部「插画头图 + 标题」。
  // 之所以要这类图：空态插画只有新用户看得到，老用户有数据就永远触发不到，
  // 页面要「看得出来变好了」必须改始终可见的区域。
  pageheader: [
    {
      key: 'page-pet-profile',
      scene:
        '小猫和小狗并排坐在一起，一起低头看着面前摊开的一本档案册，册页上有几张小照片贴纸，两只神情专注又温暖。',
      composition: '横向构图，主体偏左，右侧大片留白。',
    },
    {
      key: 'page-mine',
      scene:
        '小猫和小狗并排坐在一起，两只一起抬头望向斜上方（像在看镜头后面的主人），猫咪眯眼微笑，小狗张嘴开心笑，姿态亲昵。',
      composition: '横向构图，主体偏左，右侧大片留白。',
    },
    {
      key: 'page-family',
      scene:
        '小猫和小狗并排坐在一座小小的奶油色房子前，房子有暖橙色屋顶，两只从门口探出头来，画面温馨有归属感。',
      composition: '横向构图，主体偏左，右侧大片留白。',
    },
    // —— 以下 3 张为补齐「今天 / 创作 / 时光」三个主 tab 页（2026-09-11）——
    // 上面三张覆盖了 我的 / 家庭 / 宠物档案，剩下这三个主页面还没有头图。
    {
      key: 'page-home',
      scene:
        '小猫和小狗在温馨的家里等主人：小狗坐在门口的地垫上朝前看，小猫趴在旁边的小窝边抬起头，脚边放着一个毛线球，背景是柔和的家居一角。',
      composition: '横向构图，主体偏左，右侧大片留白。',
    },
    {
      key: 'page-creative',
      scene:
        '小猫和小狗一起在画画：小狗嘴里叼着一支画笔，小猫抬起前爪按在一张摊开的空白画布上，脚边散落几支彩色画笔和颜料小罐，两只神情专注又开心。',
      composition: '横向构图，主体偏左，右侧大片留白。',
    },
    {
      key: 'page-timeline',
      scene:
        '小猫和小狗并排走在一条暖色的小路上，小路两旁立着几张像相框一样的小照片，两只一边往前走一边回头张望，像在回望一路走来的时光。',
      composition: '横向构图，主体偏左，右侧大片留白。',
    },
  ],

  // ── 创作页「今日 / 更多」六个功能入口的专用插画（2026-09-11）──
  //
  // 【为什么新开一批】用户要把那 6 张小卡做成插画，而现有 24 张全是**空态**场景，
  //   没有一张是给这六个入口画的（拿 empty-achievement 的奖杯去表示"健康报告"会误导）。
  // 【为什么构图比其他批次"近"】这批插画在卡片里只显示约 106px（真机口径），
  //   沿用空态那种"四周大片留白"会被缩得看不清主体，所以改成"中近景、猫狗占画面约三分之二"。
  grid: [
    {
      key: 'grid-checkin',
      scene:
        '小猫和小狗并排坐着，一起低头看面前一块斜立的小小打卡板，板上是三格空白的方框，小狗抬起一只前爪像是要按上去，两只神情认真又开心。',
      composition: '主体居中偏近景，猫狗合计约占画面三分之二，四周留白适度，正方形构图。',
    },
    {
      key: 'grid-agent',
      scene:
        '小猫和小狗一起好奇地凑向桌上一个圆润的小音箱，音箱正面透出一圈柔和的暖光，小狗歪着头认真在听，小猫伸出前爪轻轻碰了一下音箱。',
      composition: '主体居中偏近景，猫狗合计约占画面三分之二，四周留白适度，正方形构图。',
    },
    {
      key: 'grid-lineage',
      scene:
        '小猫和小狗并排坐在画面中间靠下，头顶上方环绕着**多枚用柔和细线相连的小圆形相框**（不是一个大圆，是好几枚小相框连成一张小小的关系网），相框里是空白的奶油色，两只一起抬头看着那些连线。' +
        '（重申角色：猫是橘色虎斑短毛、白色下巴与胸口、粉色三角小鼻；狗是奶油色卷毛泰迪、长垂耳、中小号黑色圆珠鼻、嘴短而微突但**绝不是扁脸**；两只五官必须与参考图完全一致）',
      composition: '主体居中，头顶那圈小相框与连线要完整落在画面内、四边都留白，正方形构图。',
    },
    {
      key: 'grid-weekly',
      scene:
        '小猫和小狗一起看一块小小的周报板，板上有几根柔和的暖色柱状条和一个环形刻度，小狗抬起前爪指向其中一根柱子，两只表情惊喜。',
      composition: '主体居中偏近景，猫狗合计约占画面三分之二，四周留白适度，正方形构图。',
    },
    {
      key: 'grid-vaccine',
      scene:
        '小猫和小狗一起看一本斜立的小台历，台历上是空白的格子，其中一格旁有一枚小小的护盾标记，小狗抬起前爪指向某一天，小猫在旁边点头。',
      composition: '主体居中偏近景，猫狗合计约占画面三分之二，四周留白适度，正方形构图。',
    },
    {
      key: 'grid-report',
      scene:
        '小猫和小狗并排凑近，一起低头看一张平铺展开的空白报告单，纸面上只有柔和的暖色折线，不要出现文字、字母、数字。',
      composition: '主体居中偏近景，猫狗合计约占画面三分之二，四周留白适度，正方形构图。',
    },
  ],
}

// ─────────────────────────────────────────────
// 调用
// ─────────────────────────────────────────────
function readEnv(file) {
  const env = {}
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
  return env
}

/** 品牌 IP 转 data URI 作参考图 —— 锁死两个角色的形象 */
function refDataUri() {
  return `data:image/png;base64,${fs.readFileSync(REF_IP).toString('base64')}`
}

/** Seedream 返回的是 JPEG 字节，落盘必须按真实格式命名（原有 auth-hero.png 假 PNG 就是这么来的） */
function sniffExt(buf) {
  if (buf[0] === 0x89 && buf[1] === 0x50) return '.png'
  if (buf[0] === 0xff && buf[1] === 0xd8) return '.jpg'
  if (buf[0] === 0x52 && buf[1] === 0x49) return '.webp'
  return '.bin'
}

async function generateOne(apiKey, plate, ref) {
  const isWide = plate.composition.includes('横向')
  const prompt = `${CHARACTERS}${plate.scene}${tail(plate.composition)}`
  const body = {
    model: MODEL,
    prompt,
    // 空态要清晰的正方形；头图/分享卡用横竖版
    size: isWide ? '1280x720' : '1024x1024',
    n: 1,
    watermark: false,
    images: [ref], // ← 参考图锁角色
  }

  let lastErr = ''
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt) await new Promise((r) => setTimeout(r, 3000 * attempt))
    const resp = await fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120000),
    })
    if (resp.status === 429) {
      lastErr = '429 限流'
      continue
    }
    if (!resp.ok) {
      lastErr = `${resp.status} ${(await resp.text().catch(() => '')).slice(0, 200)}`
      continue
    }
    const data = await resp.json()
    const url = data?.data?.[0]?.url
    if (!url) {
      lastErr = '返回无 url'
      continue
    }
    const imgResp = await fetch(url, { signal: AbortSignal.timeout(120000) })
    if (!imgResp.ok) {
      lastErr = `下载 ${imgResp.status}`
      continue
    }
    return Buffer.from(await imgResp.arrayBuffer())
  }
  throw new Error(lastErr || '未知失败')
}

async function main() {
  const args = process.argv.slice(2)
  const only = (args.find((a) => a.startsWith('--only=')) || '').split('=')[1]
  const batchArg = (args.find((a) => a.startsWith('--batch=')) || '--batch=validate').split('=')[1]

  const env = readEnv(ENV_PATH)
  const apiKey = env.SEEDREAM_API_KEY
  if (!apiKey) {
    console.error('❌ server/.env 缺少 SEEDREAM_API_KEY')
    process.exit(1)
  }

  let plates
  if (only) {
    plates = Object.values(PLATES).flat().filter((p) => p.key === only)
    if (!plates.length) {
      console.error(`❌ 找不到 key=${only}`)
      process.exit(1)
    }
  } else if (batchArg === 'all') {
    plates = Object.values(PLATES).flat()
  } else {
    plates = PLATES[batchArg] || []
  }
  if (!plates.length) {
    console.error(`❌ 没有匹配的批次：${batchArg}`)
    process.exit(1)
  }

  fs.mkdirSync(OUT_DIR, { recursive: true })
  const ref = refDataUri()
  console.log(`参考图（品牌 IP）：${(ref.length / 1024).toFixed(0)} KB 内联`)
  console.log(`本批 ${plates.length} 张\n`)

  const manifest = []
  for (const plate of plates) {
    process.stdout.write(`  ${plate.key.padEnd(24)} `)
    try {
      const buf = await generateOne(apiKey, plate, ref)
      const ext = sniffExt(buf)
      const out = path.join(OUT_DIR, `${plate.key}${ext}`)
      fs.writeFileSync(out, buf)
      console.log(`✅ ${(buf.length / 1024).toFixed(0)} KB${ext}`)
      manifest.push({ key: plate.key, file: path.basename(out), bytes: buf.length, scene: plate.scene })
    } catch (e) {
      console.log(`❌ ${e.message}`)
      manifest.push({ key: plate.key, error: e.message })
    }
  }

  const mPath = path.join(OUT_DIR, `manifest-${only || batchArg}.json`)
  fs.writeFileSync(mPath, JSON.stringify(manifest, null, 2), 'utf8')
  const ok = manifest.filter((m) => !m.error).length
  console.log(`\n成功 ${ok} / ${plates.length} → ${OUT_DIR}`)
}

main()
