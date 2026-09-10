import { describe, it, expect } from 'vitest'
import { checkInput, sanitizeOutput, detectOffTopic } from '../ruleGuard'

describe('checkInput', () => {
  it('should detect self-harm keywords', () => {
    const result = checkInput('我觉得不想活了')
    expect(result.blocked).toBe(true)
    expect(result.isCrisis).toBe(true)
    expect(result.action).toBe('crisis_intervention')
  })

  it('should detect animal abuse keywords', () => {
    const result = checkInput('我教你杀猫的方法')
    expect(result.blocked).toBe(true)
  })

  it('should detect phone number', () => {
    const result = checkInput('我的手机是13812345678')
    expect(result.blocked).toBe(true)
  })

  it('should detect ID card number', () => {
    const result = checkInput('110101199001011234')
    expect(result.blocked).toBe(true)
  })

  it('should pass normal pet-related text', () => {
    const result = checkInput('青橘今天食欲不太好')
    expect(result.blocked).toBe(false)
    expect(result.action).toBe('pass')
  })

  it('should pass empty text', () => {
    const result = checkInput('')
    expect(result.blocked).toBe(false)
  })
})

describe('detectOffTopic', () => {
  it('should detect human romance/relationship topics', () => {
    expect(detectOffTopic('我想谈恋爱了')).toBe(true)
    expect(detectOffTopic('我失恋了')).toBe(true)
    expect(detectOffTopic('被家里催婚')).toBe(true)
    expect(detectOffTopic('和男朋友分手了')).toBe(true)
  })

  it('should detect homework/coding/translation/finance/weather/fortune/job topics', () => {
    expect(detectOffTopic('帮我写作业')).toBe(true)
    expect(detectOffTopic('帮我写代码')).toBe(true)
    expect(detectOffTopic('帮我翻译这段话')).toBe(true)
    expect(detectOffTopic('今天股票怎么样')).toBe(true)
    expect(detectOffTopic('今天天气怎么样')).toBe(true)
    expect(detectOffTopic('帮我算算运势')).toBe(true)
    expect(detectOffTopic('最近在找工作')).toBe(true)
  })

  it('should pass pet-related text', () => {
    expect(detectOffTopic('豆豆今天食欲不好')).toBe(false)
    expect(detectOffTopic('它把花瓶打碎了')).toBe(false)
    expect(detectOffTopic('我家猫感冒了怎么办')).toBe(false)
    expect(detectOffTopic('')).toBe(false)
  })

  it('should NOT match pet breeding/mating/weight requests（歧义词刻意未收录）', () => {
    expect(detectOffTopic('想给我家猫找个对象配种')).toBe(false)
    expect(detectOffTopic('我家狗发情了怎么办')).toBe(false)
    expect(detectOffTopic('我家猫太胖了想减肥')).toBe(false)
  })
})

describe('sanitizeOutput', () => {
  it('should truncate long text', () => {
    const long = 'x'.repeat(200)
    const result = sanitizeOutput(long, 150)
    expect(result.length).toBeLessThanOrEqual(153)
    expect(result.endsWith('...')).toBe(true)
  })

  it('should not truncate short text', () => {
    const short = 'hello world'
    const result = sanitizeOutput(short, 150)
    expect(result).toBe(short)
  })
})
