/**
 * AI 能力入口路由工具测试
 *
 * 【为什么要有这个测试文件】
 * `capability` 参数名与取值是「各 AI 入口」与「团团页」之间的**契约**：
 * 写入侧在本文件被测（`buildAiEntryUrl`），读取侧在
 * `pagesYuantuan/agent/index.tsx` 的 `AUTO_CAPABILITY_KEYS`。
 * 两侧任何一处漂移，症状都是"点了按钮跳过去却没反应"，而且**不报错**、只有真机点得出来。
 * 所以这里把关键取值钉死 —— 至少写入侧改名/改值时会立刻红灯。
 */
import { describe, it, expect } from 'vitest'

import { AI_CAPABILITY_KEYS, buildAiEntryUrl } from '../aiEntry'
import { TAB_BAR_AI_PATH } from '../../constants/tabBar'

describe('buildAiEntryUrl', () => {
  it('不带能力时返回团团首屏路径（与 tabBar 中心钮同一落点）', () => {
    expect(buildAiEntryUrl()).toBe(TAB_BAR_AI_PATH)
    expect(buildAiEntryUrl()).toBe('/pagesYuantuan/agent/index')
  })

  it('带能力时把 capability 拼成 query 参数', () => {
    expect(buildAiEntryUrl('food')).toBe('/pagesYuantuan/agent/index?capability=food')
  })

  it('支持契约里的全部 AI 能力 key', () => {
    // 逐个断言，避免"只测了 food"这种漏测
    expect(buildAiEntryUrl('symptom')).toBe('/pagesYuantuan/agent/index?capability=symptom')
    expect(buildAiEntryUrl('hospital')).toBe('/pagesYuantuan/agent/index?capability=hospital')
    expect(buildAiEntryUrl('naming')).toBe('/pagesYuantuan/agent/index?capability=naming')
    expect(buildAiEntryUrl('memory')).toBe('/pagesYuantuan/agent/index?capability=memory')
  })

  it('参数名就叫 capability（改名即破坏与团团页的契约）', () => {
    expect(buildAiEntryUrl('food')).toContain('capability=')
  })
})

describe('AI_CAPABILITY_KEYS', () => {
  it('只包含需要 AI 推理的能力，不含纯记录查询类', () => {
    expect([...AI_CAPABILITY_KEYS]).toEqual(['food', 'symptom', 'hospital', 'naming', 'memory'])
    // 打卡 / 疫苗是纯记录查询类，入口本就该原路径直达，不许进这份白名单
    expect(AI_CAPABILITY_KEYS as readonly string[]).not.toContain('checkin')
    expect(AI_CAPABILITY_KEYS as readonly string[]).not.toContain('vaccine')
  })
})
