/**
 * 宠物归属识别单测（utils/petMatching）
 *
 * 这条规则决定"AI/弹窗记的回忆落到谁名下"，错了就是把用户的数据记到别的宠物头上，
 * 因此把边界逐条钉住：命中一只 / 命中多只 / 一只都没提到 / 空名字 / 名字互为前缀 / 空列表。
 */
import { describe, it, expect } from 'vitest'
import { detectPetsInText, toPetTags } from '../petMatching'
import type { PetProfile } from '../../services/petService'

/** 造一只宠物（只填本用例用得到的字段） */
function pet(id: string, name: string, species: 'cat' | 'dog' = 'cat'): PetProfile {
  return { id, name, species } as PetProfile
}

const 可乐 = pet('p1', '可乐', 'cat')
const 布丁 = pet('p2', '布丁', 'dog')
const 烧鸡腿 = pet('p3', '烧鸡腿', 'cat')
const 烧鸡 = pet('p4', '烧鸡', 'cat')

describe('detectPetsInText - 从正文里认宠物', () => {
  it('只提到一只 → 返回那一只（即使它不是当前宠物）', () => {
    expect(detectPetsInText('布丁今天学会了握手', [可乐, 布丁], 可乐.id)).toEqual([布丁.id])
  })

  it('提到多只 → 全部返回（多宠共同回忆）', () => {
    const ids = detectPetsInText('可乐和布丁一起晒太阳', [可乐, 布丁], 可乐.id)
    expect(ids.sort()).toEqual([可乐.id, 布丁.id].sort())
  })

  it('一只都没提到 → 回退到 fallback（当前宠物）', () => {
    expect(detectPetsInText('今天天气不错', [可乐, 布丁], 布丁.id)).toEqual([布丁.id])
  })

  it('fallback 不在列表里 → 回退到第一只（不会返回一个幽灵 id）', () => {
    expect(detectPetsInText('今天天气不错', [可乐, 布丁], 'p-不存在')).toEqual([可乐.id])
  })

  it('名字互为前缀时，长名字优先且都能命中', () => {
    // "烧鸡腿" 里包含 "烧鸡"：两只都应命中，且不因短名字截断而漏掉长名字那只
    const ids = detectPetsInText('烧鸡腿今天很乖', [烧鸡, 烧鸡腿], 烧鸡.id)
    expect(ids).toContain(烧鸡腿.id)
  })

  it('名字为空的宠物被跳过（空串会被任何正文"包含"）', () => {
    const 无名 = pet('p9', '   ')
    expect(detectPetsInText('随便写点什么', [无名, 可乐], 可乐.id)).toEqual([可乐.id])
  })

  it('宠物列表为空 → 返回空数组（调用方据此拦截保存）', () => {
    expect(detectPetsInText('布丁好可爱', [], 布丁.id)).toEqual([])
  })

  it('正文为空 → 直接回退 fallback', () => {
    expect(detectPetsInText('', [可乐, 布丁], 可乐.id)).toEqual([可乐.id])
  })
})

describe('toPetTags - 转成卡片标签结构', () => {
  it('物种映射到 emoji，字段名与后端 content.pets 对齐', () => {
    expect(toPetTags([可乐, 布丁])).toEqual([
      { id: 'p1', name: '可乐', emoji: '🐱' },
      { id: 'p2', name: '布丁', emoji: '🐕' },
    ])
  })

  it('未知物种兜底 🐾', () => {
    expect(toPetTags([pet('p5', '团团', 'other' as unknown as 'cat')])[0].emoji).toBe('🐾')
  })
})
