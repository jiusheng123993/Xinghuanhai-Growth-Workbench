/**
 * 取名提示词构建单元测试（2026-09-10 补齐）
 *
 * 重点锁两件事（都是线上事故的根因面）：
 *  ① **跨端契约**：取名/命理提示词不得包含会被服务端越界词表（agentRuleIntent.detectOffTopic）
 *     命中的措辞——命理详情曾因提示词里的"运势"被 /api/ai/chat 在调 LLM 前硬拦截，
 *     导致 AI 命理解析 100% 失效、永远显示本地模板。
 *  ② **看图取名**：链路上模型看不到图片，提示词只能带"视觉分析出的外貌描述"；
 *     没有描述时必须明确禁止模型编造照片内容，且不得再把照片 URL 当"图"喂进去。
 */
import { describe, it, expect } from 'vitest'
import { buildRecommendPrompt, buildInterpretPrompt, buildDetailPrompt } from '../namingPrompts'

/**
 * 服务端人类"运势"问句正则（当前值，见 server/src/services/agentRuleIntent.ts）
 * 副本放在这里做跨端锁：前端提示词一旦写成这些人类问法，命理/取名请求又会被整条拦掉。
 */
const OFFTOPIC_FORTUNE_PATTERNS = [
  /(?:看|算|测|查|问|求|占)(?:一?下|一卦|看|算)?(?:我的|今年|今天|今日|明天|本周|这周|本月|明年|近期|最近)?运势/,
  /(?:我的|今年|今天|今日|明天|本周|这周|本月|明年|近期|最近)的?运势/,
]
/** 其余单词级越界词（星座/算命/占卜/塔罗/风水/看手相） */
const OFFTOPIC_KEYWORD_PATTERN = /星座|算命|占卜|塔罗|风水|看手相/

const baseRecommendParams = {
  breed: '布偶猫',
  birthDate: '2026-03-12',
  gender: 'female',
  season: '春',
}

describe('namingPrompts', () => {
  describe('buildRecommendPrompt', () => {
    it('should include species label when species is provided', () => {
      const cat = buildRecommendPrompt({ ...baseRecommendParams, species: 'cat' })
      const dog = buildRecommendPrompt({ ...baseRecommendParams, species: 'dog' })
      expect(cat).toContain('（猫咪）')
      expect(dog).toContain('（狗狗）')
    })

    it('should fall back to 宠物 when species is missing', () => {
      const prompt = buildRecommendPrompt(baseRecommendParams)
      expect(prompt).toContain('为一只布偶猫宠物推荐5个中文宠物名字')
      expect(prompt).not.toContain('undefined')
    })

    it('should write 未知 instead of a broken season sentence when birthDate is empty', () => {
      const prompt = buildRecommendPrompt({ ...baseRecommendParams, birthDate: '', season: '未知' })
      // 季节未知时不再重复写括号；性别用中文标签而非 male/female
      expect(prompt).toContain('出生日期：未知，性别：母')
    })

    it('should render gender as Chinese label', () => {
      expect(buildRecommendPrompt({ ...baseRecommendParams, gender: 'male' })).toContain('性别：公')
      expect(buildRecommendPrompt({ ...baseRecommendParams, gender: 'female' })).toContain('性别：母')
      expect(buildRecommendPrompt({ ...baseRecommendParams, gender: 'unknown' })).toContain('性别：未知')
    })

    it('should include the visual appearance description when provided', () => {
      const prompt = buildRecommendPrompt({
        ...baseRecommendParams,
        appearance: '橘白相间，圆脸，琥珀色大眼睛，白手套',
      })
      expect(prompt).toContain('橘白相间，圆脸，琥珀色大眼睛，白手套')
      expect(prompt).toContain('视觉分析')
    })

    it('should forbid inventing photo content when photo exists but appearance is unknown', () => {
      const prompt = buildRecommendPrompt({ ...baseRecommendParams, photoUrl: '/uploads/pet-photos/a.jpg' })
      expect(prompt).toContain('未能识别出外貌特征')
      expect(prompt).toContain('不要编造照片内容')
      // 照片 URL 不再进提示词：链路上是纯文本模型，喂 URL 只会让它"假装看过"
      expect(prompt).not.toContain('/uploads/pet-photos/a.jpg')
    })

    it('should ask for JSON with the 5 cultural dimensions and exclude repeats', () => {
      const prompt = buildRecommendPrompt({
        ...baseRecommendParams,
        style: '古风诗意',
        description: '安静粘人',
        excludeNames: ['墨韵', '云栖'],
      })
      expect(prompt).toContain('风格偏好：古风诗意')
      expect(prompt).toContain('主人对宠物的描述：安静粘人')
      expect(prompt).toContain('已经推荐过，请务必避免重复推荐：墨韵、云栖')
      expect(prompt).toContain('"source"')
      expect(prompt).toContain('"wuxing"')
      expect(prompt).toContain('"starMansion"')
    })
  })

  describe('buildInterpretPrompt', () => {
    it('should embed name/breed/birthDate and ask for 5 dimensions', () => {
      const prompt = buildInterpretPrompt('墨韵', '布偶猫', '2026-03-12')
      expect(prompt).toContain('名字：墨韵')
      expect(prompt).toContain('品种：布偶猫')
      expect(prompt).toContain('出生日期：2026-03-12')
      expect(prompt).toContain('字义拆解')
      expect(prompt).toContain('守护星宿')
    })
  })

  describe('buildDetailPrompt', () => {
    it('should request all 12 命理 fields as JSON', () => {
      const prompt = buildDetailPrompt({
        name: '墨韵',
        breed: '布偶猫',
        birthDate: '2026-03-12',
        gender: 'female',
        season: '春',
        wuxing: '水',
        starMansion: '壁水貐',
      })
      for (const field of [
        'bazi',
        'fortune',
        'careerFortune',
        'loveFortune',
        'healthFortune',
        'personality',
        'strokes',
        'luckyDirection',
        'luckyColor',
        'luckyNumber',
        'karmaWithOwner',
        'summary',
      ]) {
        expect(prompt).toContain(`"${field}"`)
      }
      expect(prompt).toContain('性别：女')
    })
  })

  describe('跨端契约：提示词不得命中服务端越界词表', () => {
    it('should keep recommend prompt free of off-topic fortune-telling phrasing', () => {
      const prompt = buildRecommendPrompt({ ...baseRecommendParams, species: 'cat', style: '古风诗意' })
      OFFTOPIC_FORTUNE_PATTERNS.forEach((p) => expect(prompt).not.toMatch(p))
      expect(prompt).not.toMatch(OFFTOPIC_KEYWORD_PATTERN)
    })

    it('should keep interpret prompt free of off-topic fortune-telling phrasing', () => {
      const prompt = buildInterpretPrompt('墨韵', '布偶猫', '2026-03-12')
      OFFTOPIC_FORTUNE_PATTERNS.forEach((p) => expect(prompt).not.toMatch(p))
      expect(prompt).not.toMatch(OFFTOPIC_KEYWORD_PATTERN)
    })

    it('should keep detail prompt free of off-topic fortune-telling phrasing', () => {
      // 此处是命理详情事故的回归锁：提示词里可以出现"整体运势/健康运势"（服务端业务词），
      // 但绝不能出现"看运势/今年运势/我的运势"这类会被人类问句正则命中的组合
      const prompt = buildDetailPrompt({
        name: '墨韵',
        breed: '布偶猫',
        birthDate: '2026-03-12',
        gender: 'female',
        season: '春',
        wuxing: '水',
        starMansion: '壁水貐',
      })
      OFFTOPIC_FORTUNE_PATTERNS.forEach((p) => expect(prompt).not.toMatch(p))
      expect(prompt).not.toMatch(OFFTOPIC_KEYWORD_PATTERN)
    })
  })
})
