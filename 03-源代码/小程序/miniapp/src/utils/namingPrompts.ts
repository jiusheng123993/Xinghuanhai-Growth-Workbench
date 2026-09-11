/**
 * 取名引擎 - AI 提示词构建
 *
 * 支持两种模式：
 * 1. 推荐模式：根据品种/生日/性别/风格/照片/描述推荐名字
 * 2. 解读模式：根据用户提供的名字进行文化解读
 */

export interface RecommendParams {
  breed: string
  birthDate: string
  gender: string
  season: string
  style?: string
  photoUrl?: string
  /** 照片外貌描述（由视觉模型提取，见 namingService.extractNamingAppearance）：
   *  取名链路是纯文本模型，传 URL 等于没传——只有这段描述才能真正让 AI"看见"宠物 */
  appearance?: string
  description?: string
  /** 物种（cat/dog）：独立取名页由用户手动选择，聊天内取名取当前宠物档案。
   *  此前只有品种、没有物种，用户选"狗"也不会影响提示词（2026-09-10 修复）。 */
  species?: string
  /** 已推荐过的名字，需避免重复 */
  excludeNames?: string[]
}

/**
 * 物种中文标签（提示词用）
 * @param species - 'cat' | 'dog' | 其它
 * @returns 中文标签，未知物种返回空串（不写进提示词，避免出现"undefined"这类噪声）
 */
function speciesLabel(species?: string): string {
  if (species === 'cat') return '猫咪'
  if (species === 'dog') return '狗狗'
  return ''
}

/**
 * 性别中文标签（提示词用）
 * 2026-09-10 审查 P3：此前直接把 male/female/unknown 写进中文提示词，读起来是半截英文；
 * 未知性别写"未知"而不是硬塞一个性别。同时兼容直接传中文"公/母"的调用方。
 */
function genderLabel(gender?: string): string {
  if (gender === 'male' || gender === '公' || gender === '男') return '公'
  if (gender === 'female' || gender === '母' || gender === '女') return '母'
  return '未知'
}

/**
 * 构建名字推荐 prompt
 *
 * 要求 AI 返回结构化 JSON，便于前端解析展示。
 */
export function buildRecommendPrompt(params: RecommendParams): string {
  const { breed, birthDate, gender, season, style, photoUrl, appearance, description, species, excludeNames } = params

  // 物种缺失时退化为"宠物"，不写空串，保证句子完整可读
  const subject = speciesLabel(species) || '宠物'

  const parts: string[] = [
    `为一只${breed}${subject === '宠物' ? subject : `（${subject}）`}推荐5个中文宠物名字。`,
    // 生日缺失/非法时不写 "（未知天）" 这类半截话术；季节也未知时不再重复写括号
    // （2026-09-10 审查 P3：此前会输出"出生日期：未知（未知）"）
    `出生日期：${birthDate || '未知'}${season && season !== '未知' ? `（${season}）` : ''}，性别：${genderLabel(gender)}。`,
  ]

  if (style && style !== '不限风格') {
    parts.push(`风格偏好：${style}。`)
  }

  if (appearance) {
    // 真正的"看图取名"：描述由视觉模型从真实照片提取（毛色/花纹/体型/眼睛/特殊标记）
    parts.push(`照片外貌特征（来自真实照片的视觉分析）：${appearance}。请结合这些特征推荐贴合的名字。`)
  } else if (photoUrl) {
    // 有照片但未提取出外貌：明确禁止模型"脑补"照片内容（此前提示词写"请根据照片中外貌特征"，
    // 而取名链路是纯文本模型、根本看不到图，模型只能编造）
    parts.push('主人上传过照片，但系统未能识别出外貌特征：请不要编造照片内容，仅依据品种与主人描述推荐。')
  }

  if (description) {
    parts.push(`主人对宠物的描述：${description}。请结合这些特点推荐名字。`)
  }

  if (excludeNames && excludeNames.length > 0) {
    parts.push(`\n以下名字已经推荐过，请务必避免重复推荐：${excludeNames.join('、')}。`)
  }

  parts.push(
    `\n每个名字从以下维度完整解读：`,
    `1. 来源：诗词/典故/山川地名/星宿，必须引用原文并标注出处`,
    `2. 五行：名字汉字的五行属性及与出生季节的关联`,
    `3. 星宿：对应的二十八星宿之一`,
    `4. 寓意：温暖雅致的解读（2-3句话）`,
    `5. 评分：0-100分`,
    `\n推荐要求：`,
    `- 名字2-3个汉字`,
    `- 古典雅致有文化底蕴`,
    `- 避免过于常见的名字（如：小白、小黑、旺财）`,
    `- 5个名字风格多样，各有特色`,
    `\n请严格按以下JSON格式输出（只输出JSON，不要其他文字）：`,
    `[`,
    `  {"name":"名字","source":"诗词典故出处（引用原文+出处）","wuxing":"五行属性及与季节关联","starMansion":"守护星宿","meaning":"寓意解读","score":95}`,
    `]`
  )

  return parts.join('\n')
}

/**
 * 构建名字解读 prompt
 *
 * 用户已有候选名字，AI 从文化角度深度解读。
 */
export function buildInterpretPrompt(name: string, breed: string, birthDate: string): string {
  return `你是一位精通中国传统文化的取名大师。请深度解读以下宠物名字：

名字：${name}
品种：${breed}
出生日期：${birthDate}

请从以下维度完整解读（每个维度2-3句话）：
1. 字义拆解：逐字分析名字中每个汉字的含义和意象
2. 五行属性：名字整体的五行属性，以及与出生季节的生克关系
3. 守护星宿：对应的二十八星宿，及其象征意义
4. 诗词典故：引用至少2处经典诗词或典故，标注出处
5. 综合评价：整体寓意、适用场景、给主人的建议

使用温暖、雅致的语气，引用经典诗句时标注出处，让用户感受到文化深度。`
}

export interface DetailPromptParams {
  name: string
  breed: string
  birthDate: string
  gender: string
  season: string
  wuxing: string
  starMansion: string
  description?: string
}

/**
 * 构建命理深度分析 prompt
 *
 * 模拟传统命理师的风格，从八字、五行、星宿、笔画等维度全面分析名字的运势。
 */
export function buildDetailPrompt(params: DetailPromptParams): string {
  const { name, breed, birthDate, gender, season, wuxing, starMansion, description } = params

  const parts: string[] = [
    `你是一位精通中国传统命理学的取名大师，请为以下宠物名字进行深度命理分析：`,
    ``,
    `【基本信息】`,
    `名字：${name}`,
    `品种：${breed}`,
    `出生日期：${birthDate}（${season}天出生）`,
    `性别：${gender === 'male' ? '男' : gender === 'female' ? '女' : '未知'}`,
    `名字五行：${wuxing}`,
    `守护星宿：${starMansion}`,
  ]

  if (description) {
    parts.push(`主人描述：${description}`)
  }

  parts.push(
    ``,
    `请从以下维度进行命理级别的深度分析，使用温暖而富有文化底蕴的语言：`,
    ``,
    `1. 八字命理简析：根据出生季节推算八字特点，分析名字与八字的生克关系（3-4句话）`,
    `2. 整体运势：综合五行、星宿、字义，分析这个名字带来的整体运势走向（3-4句话）`,
    `3. 事业/生活运势：这个名字对宠物日常生活、活力、表现力的影响（2-3句话）`,
    `4. 感情/人际运势：名字对宠物与主人、其他宠物、家人之间缘分的影响（2-3句话）`,
    `5. 健康运势：从五行平衡角度分析名字对宠物健康的影响（2-3句话）`,
    `6. 性格特质：这个名字会赋予宠物什么样的性格特质（2-3句话）`,
    `7. 笔画数理：按传统姓名学分析名字的笔画数和数理含义（2-3句话）`,
    `8. 吉祥方位：这个名字对应的吉祥方位`,
    `9. 吉祥颜色：这个名字对应的吉祥颜色`,
    `10. 吉祥数字：这个名字对应的幸运数字`,
    `11. 与主人缘分：从名字的气场分析宠物与主人的缘分契合度（2-3句话）`,
    `12. 总结寄语：一段温暖、有文化底蕴的寄语，给主人和宠物（3-4句话）`,
    ``,
    `请严格按以下JSON格式输出（只输出JSON，不要其他文字）：`,
    `{`,
    `  "bazi": "八字命理简析",`,
    `  "fortune": "整体运势分析",`,
    `  "careerFortune": "事业/生活运势",`,
    `  "loveFortune": "感情/人际运势",`,
    `  "healthFortune": "健康运势",`,
    `  "personality": "性格特质分析",`,
    `  "strokes": "笔画数理分析",`,
    `  "luckyDirection": "吉祥方位",`,
    `  "luckyColor": "吉祥颜色",`,
    `  "luckyNumber": "吉祥数字",`,
    `  "karmaWithOwner": "与主人缘分解析",`,
    `  "summary": "总结寄语"`,
    `}`,
    ``,
    `语言风格：温暖、雅致、有文化底蕴，像一位博学的命理师在娓娓道来。可适当引用《易经》《黄帝内经》等经典。`,
  )

  return parts.join('\n')
}