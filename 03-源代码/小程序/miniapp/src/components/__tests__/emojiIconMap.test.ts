/**
 * emoji → 面性图标 映射表测试
 *
 * 这层是「全站 emoji 替换」的唯一事实源：替换脚本与人工改稿都以它为准，
 * 一旦映射写错，替换就会把语义搞乱（如「疫苗」配到「医疗十字」）。
 */
import { describe, it, expect } from 'vitest'
import {
  emojiToIcon,
  shouldReplaceEmoji,
  EMOJI_TO_ICON,
  KEEP_EMOJI,
} from '../emojiIconMap'
import { FILL_ICON_PATHS } from '../icons-fill'

describe('emojiIconMap', () => {
  describe('emojiToIcon', () => {
    it('常见功能图标能正确映射', () => {
      expect(emojiToIcon('🐾')).toBe('paw-print')
      expect(emojiToIcon('💉')).toBe('syringe')
      expect(emojiToIcon('🩺')).toBe('stethoscope')
      expect(emojiToIcon('📅')).toBe('calendar-check')
      expect(emojiToIcon('🔍')).toBe('magnifying-glass')
    })

    it('带变体选择符（U+FE0F）的 emoji 也能命中', () => {
      // ⚠️ = ⚠ + FE0F，查表前会剥掉修饰符
      expect(emojiToIcon('⚠️')).toBe('warning')
      expect(emojiToIcon('🖼️')).toBe('image')
      expect(emojiToIcon('⚖️')).toBe('scales')
    })

    it('装饰/情绪类 emoji 不映射（应保留原样）', () => {
      expect(emojiToIcon('✨')).toBeNull()
      expect(emojiToIcon('🎉')).toBeNull()
      expect(emojiToIcon('😊')).toBeNull()
    })

    it('无法识别的字符返回 null', () => {
      expect(emojiToIcon('')).toBeNull()
      expect(emojiToIcon('abc')).toBeNull()
    })
  })

  describe('shouldReplaceEmoji', () => {
    it('功能图标返回 true，装饰类返回 false', () => {
      expect(shouldReplaceEmoji('💉')).toBe(true)
      expect(shouldReplaceEmoji('✨')).toBe(false)
    })
  })

  describe('映射表自洽性', () => {
    it('每个映射目标都是真实存在的面性图标', () => {
      const missing: string[] = []
      for (const [emoji, icon] of Object.entries(EMOJI_TO_ICON)) {
        if (!(icon in FILL_ICON_PATHS)) missing.push(`${emoji} → ${icon}`)
      }
      expect(missing).toEqual([])
    })

    it('保留清单里的 emoji 不应同时出现在映射表里（避免自相矛盾的规则）', () => {
      for (const keep of KEEP_EMOJI) {
        expect(EMOJI_TO_ICON[keep]).toBeUndefined()
      }
    })

    it('映射表不为空且键都是单字符 emoji', () => {
      const keys = Object.keys(EMOJI_TO_ICON)
      expect(keys.length).toBeGreaterThan(30)
      for (const k of keys) {
        // 每个键应当是单个 emoji 字形（可能带变体选择符）
        expect(k.replace(/\uFE0F/g, '').length).toBeLessThanOrEqual(2)
      }
    })
  })
})
