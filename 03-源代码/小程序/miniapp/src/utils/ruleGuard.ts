const SELF_HARM_KEYWORDS: string[] = [
  '自杀', '自残', '自伤', '不想活了', '活不下去',
  '结束生命', '了结自己', '死了一了百了'
]

const ANIMAL_ABUSE_KEYWORDS: string[] = [
  '虐待', '毒杀', '下毒', '打死', '弄死', '杀猫', '杀狗',
  '安乐死自己', '怎么让宠物死'
]

const PRIVACY_PATTERNS: RegExp[] = [
  /1[3-9]\d{9}/,
  /\d{17}[\dXx]/,
  /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/
]

const TOXIC_FOOD_NAMES: string[] = [
  '巧克力', '可可', '葡萄', '洋葱', '大蒜', '木糖醇',
  '牛油果', '酒精', '咖啡', '茶', '夏威夷果', '生面团',
  '韭菜', '葱', '啤酒', '红酒', '白酒', '咖啡因',
  '百合', '郁金香', '水仙', '夹竹桃', '蓖麻'
]

export interface RuleGuardResult {
  blocked: boolean
  isCrisis: boolean
  reason?: string
  action: 'pass' | 'block' | 'crisis_intervention'
}

function normalizeInput(text: string): string {
  return text
    .normalize('NFKC')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/[\s\u3000]+/g, '')
    .replace(/[·•・‧･]/g, '')
}

const INPUT_MAX_LENGTH = 5000

export function checkInput(text: string): RuleGuardResult {
  if (!text) {
    return { blocked: false, isCrisis: false, action: 'pass' }
  }

  if (text.length > INPUT_MAX_LENGTH) {
    return {
      blocked: true,
      isCrisis: false,
      reason: `输入内容过长，最多允许 ${INPUT_MAX_LENGTH} 字符`,
      action: 'block'
    }
  }

  const normalized = normalizeInput(text)

  for (const kw of SELF_HARM_KEYWORDS) {
    if (text.includes(kw) || normalized.includes(kw)) {
      return {
        blocked: true,
        isCrisis: true,
        reason: '检测到自我伤害倾向',
        action: 'crisis_intervention'
      }
    }
  }

  for (const kw of ANIMAL_ABUSE_KEYWORDS) {
    if (text.includes(kw) || normalized.includes(kw)) {
      return {
        blocked: true,
        isCrisis: false,
        reason: '检测到虐待动物倾向',
        action: 'block'
      }
    }
  }

  for (const pattern of PRIVACY_PATTERNS) {
    if (pattern.test(text)) {
      return {
        blocked: true,
        isCrisis: false,
        reason: '检测到疑似隐私信息',
        action: 'block'
      }
    }
  }

  return { blocked: false, isCrisis: false, action: 'pass' }
}

// ========== 越界话题（回答边界：专门服务宠物行业） ==========
// 与服务端 agentRuleIntent.detectOffTopic 同一套高精度规则：只拦截「几乎必然与宠物无关」的
// 短语类别，刻意排除有宠物语境歧义的词（找对象/处对象=配种、减肥=给猫减肥、感冒=猫感冒、
// 游戏=和猫玩游戏、八字/生肖=取名命理）。长尾越界由服务端 LLM 意图分类器 offtopic 兜底。

/** 与宠物无关的越界话术（按类别分组，高精度；词条均核查过宠物语境歧义） */
const OFFTOPIC_PATTERNS: RegExp[] = [
  // —— 恋爱/婚恋 ——
  /谈恋爱|想恋爱|恋爱了|脱单|相亲|失恋|分手|暗恋|表白|前任|网恋|异地恋|求婚|离婚|结婚|催婚/,
  // —— 学业代办（兼容"写一篇论文/写个作业"等量词）——
  /写(?:个|篇|一篇|一下)?(?:作业|论文|作文)|做(?:个|份)?作业/,
  // —— 编程/技术（i 标志：Python/Java 忽略大小写）——
  /写代码|写程序|写脚本|学编程|学Python|学Java|debug|代码报错|前端开发|后端开发/i,
  // —— 翻译代办 ——
  /帮我翻译|翻译成|翻译一下|英译中|中译英|翻译这段/,
  // —— 求职/职场（i 标志：PPT 等拉丁缩写忽略大小写）——
  /找工作|求职|面试|做简历|写简历|做PPT|离职|辞职|跳槽/i,
  // —— 财经/投资/博彩（i 标志：A股 等忽略大小写）——
  /股票|炒股|基金|理财|比特币|加密货币|区块链|彩票|中奖|涨停|跌停|A股|美股/i,
  // —— 天气查询 ——
  /天气预报|天气怎么样|天气如何|今日天气|明天天气/,
  // —— 时事/政治/新闻 ——
  /新闻|时政|政治|选举|特朗普|拜登|俄乌|中美关系/,
  // —— 娱乐/追剧/游戏（具体游戏名，避开"和猫玩游戏"歧义）——
  /追剧|综艺|明星|八卦|娱乐圈|王者荣耀|原神|吃鸡|游戏攻略/,
  // —— 星座/算命/运势（避开"八字/生肖"宠物命名歧义）——
  /星座|运势|算命|占卜|塔罗|风水|看手相/,
]

/** 越界话题的固定拒绝话术（与服务端 OFFTOPIC_REPLY 一致，确定性输出） */
export const OFFTOPIC_REPLY =
  '我是「团团」宠物管家，只专注养宠与宠物行业相关的话题哦～恋爱、生活、工作、时事这些我不擅长，就不展开了。咱们还是聊你家毛孩子吧：给它打个卡、查查食物，或记录点今天的小事？'

/**
 * 是否为与宠物无关的越界话题（恋爱/婚恋、学业、编程、财经、天气、时事、娱乐、算命、求职等高精度类别）
 * 供旧版聊天链路（/api/ai/chat 兜底 + 发图轮）在调 LLM 前确定性拦截
 */
export function detectOffTopic(text: string): boolean {
  if (!text) return false
  const normalized = normalizeInput(text)
  if (!normalized) return false
  return OFFTOPIC_PATTERNS.some((p) => p.test(normalized))
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
}

export function sanitizeOutput(text: string, maxLength: number = 150): string {
  const escaped = escapeHtml(text)
  if (escaped.length > maxLength) {
    return escaped.substring(0, maxLength) + '...'
  }
  return escaped
}
