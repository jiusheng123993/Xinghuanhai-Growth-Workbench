/**
 * 取名降级与解析工具单元测试（2026-09-10 补齐）
 *
 * 背景：namingFallback 是取名链路"AI 不可用/输出异常"时的唯一兜底（解析 AI 返回值、
 * 本地名字库、命理详情模板），此前**零测试**，导致两个线上问题长期隐身：
 *   ① 思考模式导致 AI content 为空 → 静默走本地库（用户看到的名字永远那批）；
 *   ② JSON 解析不做字段校验 → 空名字/垃圾名字渲染成空白卡片。
 * 覆盖：JSON/代码块/截断 JSON/文本兜底/编号列表解析、字段清洗与丢弃、名字库匹配与耗尽。
 */
import { describe, it, expect } from 'vitest'
import {
  parseRecommendResult,
  generateFallbackNames,
  parseDetailResult,
  generateFallbackDetail,
} from '../namingFallback'

describe('namingFallback', () => {
  describe('parseRecommendResult', () => {
    it('should parse a clean JSON array when AI returns proper JSON', () => {
      const text =
        '[{"name":"墨韵","source":"《墨池记》","wuxing":"水","starMansion":"壁水貐","meaning":"墨香氤氲","score":95}]'
      const result = parseRecommendResult(text)
      expect(result).toHaveLength(1)
      expect(result[0].name).toBe('墨韵')
      expect(result[0].score).toBe(95)
      expect(result[0].wuxing).toBe('水')
    })

    it('should parse JSON wrapped in a markdown code fence', () => {
      const text = '好的，这是推荐：\n```json\n[{"name":"云栖","meaning":"安静温柔","score":92}]\n```'
      const result = parseRecommendResult(text)
      expect(result.map((n) => n.name)).toEqual(['云栖'])
    })

    it('should cap results at 5 when AI returns more names', () => {
      const pool = ['墨韵', '云栖', '霁月', '青崖', '鹿鸣', '兰舟', '竹影', '松风']
      const text = JSON.stringify(pool.map((name) => ({ name, meaning: '寓意', score: 90 })))
      expect(parseRecommendResult(text)).toHaveLength(5)
    })

    it('should drop items with blank name when AI returns incomplete objects', () => {
      // 截断/幻觉常见：有 meaning 没有 name → 渲染成空白卡片，必须丢弃
      const text = '[{"name":"","meaning":"空名字"},{"name":"兰舟","meaning":"悠然自得","score":87}]'
      const result = parseRecommendResult(text)
      expect(result).toHaveLength(1)
      expect(result[0].name).toBe('兰舟')
    })

    it('should drop over-long "name" values when parsing falls into prose text', () => {
      // name 超过 6 字说明抓到的不是名字（而是说明文字），直接丢弃而不是渲染
      const text = '[{"name":"这是一个非常长的说明文字不是名字","meaning":"x"}]'
      expect(parseRecommendResult(text)).toEqual([])
    })

    it('should use neutral score when score is missing or invalid', () => {
      const text = '[{"name":"霁月","meaning":"雨过天晴","score":"高分"}]'
      const result = parseRecommendResult(text)
      expect(result[0].score).toBe(85)
    })

    it('should fall back to line parsing when JSON is truncated mid-array', () => {
      // 思考模式/截断输出的典型形态：没有闭合的 ]
      const text = '推荐如下：\n墨韵：墨香氤氲，韵味悠长\n云栖 - 云深不知处，栖居于心\n'
      const result = parseRecommendResult(text)
      expect(result.map((n) => n.name)).toEqual(['墨韵', '云栖'])
    })

    it('should fall back to numbered list parsing when no name:meaning pairs exist', () => {
      const text = '1. 布丁 甜甜软软\n2. 团子 圆润可爱\n'
      const result = parseRecommendResult(text)
      expect(result.map((n) => n.name)).toEqual(['布丁', '团子'])
      // 编号是**排名**：第 1 名 100 分（5 星），第 2 名 95 分
      // （2026-09-10 审查 P2 修正：此前 rank1 → 10 分，卡片只显示 1 星却挂着"推荐"徽章）
      expect(result[0].score).toBe(100)
      expect(result[1].score).toBe(95)
    })

    it('should return empty array when the server rejects with off-topic copy', () => {
      // /api/ai/chat 命中越界词表时返回固定话术；行解析曾把句尾切成"你家毛孩子吧"当候选名
      const offTopic =
        '我是「团团」宠物管家，只专注养宠与宠物行业相关的话题哦～恋爱、生活、工作、时事这些我不擅长，就不展开了。咱们还是聊你家毛孩子吧：给它打个卡、查查食物，或记录点今天的小事？'
      expect(parseRecommendResult(offTopic)).toEqual([])
    })

    it('should drop prose fragments and single-character noise from line parsing', () => {
      const text = '推荐如下：\n好：这个真不错\n墨韵：墨香氤氲，韵味悠长\n'
      const result = parseRecommendResult(text)
      // "好" 单字、"推荐如下" 停用词、"这个真不错" 归属上一行 → 只应留下真正的名字
      expect(result.map((n) => n.name)).toEqual(['墨韵'])
    })

    it('should not treat JSON fragments as names when output is broken JSON', () => {
      const text = '[\n  {\n    "name"\n'
      expect(parseRecommendResult(text)).toEqual([])
    })

    it('should strip bracket/quote noise from parsed names', () => {
      const text = '[{"name":"「墨韵」","meaning":"寓意","score":90}]'
      expect(parseRecommendResult(text)[0].name).toBe('墨韵')
    })

    it('should return empty array when text is empty', () => {
      // AI content 为空（思考模式吃空 max_tokens）时的真实入参
      expect(parseRecommendResult('')).toEqual([])
    })
  })

  describe('generateFallbackNames', () => {
    it('should return 5 names of the matched style', () => {
      const result = generateFallbackNames('古风诗意')
      expect(result).toHaveLength(5)
      // 库内条目都带出处与五行，卡片才能渲染完整
      expect(result.every((n) => n.name && n.meaning)).toBe(true)
    })

    it('should mix all styles when style is 不限风格 (or an unknown keyword)', () => {
      const result = generateFallbackNames('不限风格')
      expect(result).toHaveLength(5)
      expect(generateFallbackNames('文雅').length).toBe(5)
    })

    it('should skip names already recommended when excludeNames is given', () => {
      const first = generateFallbackNames('古风诗意')
      const second = generateFallbackNames('古风诗意', first.map((n) => n.name))
      const firstNames = first.map((n) => n.name)
      expect(second.every((n) => !firstNames.includes(n.name))).toBe(true)
    })

    it('should return empty array when the pool is exhausted (caller must handle)', () => {
      // 换一批反复调用直到该风格名字取尽：返回空数组而不是重复推荐，
      // 调用方（useNamingFlow）据此恢复上一批并提示用户
      const seen: string[] = []
      let last: ReturnType<typeof generateFallbackNames> = []
      for (let i = 0; i < 12; i++) {
        last = generateFallbackNames('古风诗意', seen)
        seen.push(...last.map((n) => n.name))
      }
      expect(last).toEqual([])
      expect(seen.length).toBeGreaterThan(5)
    })
  })

  describe('parseDetailResult', () => {
    it('should parse detail JSON when AI returns valid object', () => {
      const text = '```json\n{"bazi":"命理简析","fortune":"整体运势","summary":"寄语"}\n```'
      const detail = parseDetailResult(text)
      expect(detail?.bazi).toBe('命理简析')
      expect(detail?.summary).toBe('寄语')
    })

    it('should return null when content is empty (AI failed / off-topic reply)', () => {
      // 命理详情被服务端越界话术拦截时返回的是自然语言，这里必须落 null → 走本地模板
      expect(parseDetailResult('')).toBeNull()
      expect(parseDetailResult('我是宠物管家，只聊养宠话题哦～')).toBeNull()
    })

    it('should return null on malformed JSON', () => {
      expect(parseDetailResult('{"bazi": "未闭合')).toBeNull()
    })
  })

  describe('generateFallbackDetail', () => {
    it('should generate a full detail object with all 12 display fields', () => {
      const detail = generateFallbackDetail('墨韵', '水', '壁水貐')
      expect(detail.name).toBe('墨韵')
      const fields = [
        detail.bazi,
        detail.fortune,
        detail.careerFortune,
        detail.loveFortune,
        detail.healthFortune,
        detail.personality,
        detail.strokes,
        detail.karmaWithOwner,
        detail.summary,
      ]
      // 弹窗会逐段渲染，任一字段为空会出现空段落
      expect(fields.every((f) => typeof f === 'string' && f.length > 0)).toBe(true)
      expect(detail.summary).toContain('墨韵')
    })

    it('should map lucky direction/color/number by wuxing', () => {
      expect(generateFallbackDetail('青崖', '木', '角木蛟').luckyDirection).toBe('东方')
      expect(generateFallbackDetail('星阑', '火', '星日马').luckyColor).toContain('红')
      expect(generateFallbackDetail('玉尘', '金', '奎木狼').luckyNumber).toBe('4、9')
      expect(generateFallbackDetail('云章', '水', '斗木獬').luckyNumber).toBe('1、6')
      expect(generateFallbackDetail('书瑶', '土', '女土蝠').luckyDirection).toBe('中央')
    })
  })
})
