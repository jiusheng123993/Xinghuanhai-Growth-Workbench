/**
 * 宠物归属识别（2026-09-11 新增）
 *
 * 【解决什么问题】多宠家庭里，"记一条回忆"过去一律落到"当前选中那只"名下：
 *   用户说"记一下烧鸭今天拆家"，结果记到了烧鸡头上，而且界面上看不出来 —— 数据归属就错了。
 *   现在统一走这里：**从回忆正文里认宠物名**，认出谁就记给谁。
 *
 * 【匹配规则】按本地宠物名做包含匹配：
 *   · 命中 1 只 → 就是它
 *   · 命中多只 → 全部关联（"两只一起晒太阳"这种共同回忆正好一次记完）
 *   · 一只都没提到 → 退回 fallback（通常是"当前宠物"），再退回列表第一只
 * 【为什么放在前端】宠物名是本地已有数据，匹配零成本、零延迟、断网也能用；
 *   服务端仍会逐个校验归属（routes/timeline.ts），前端只负责"猜一个合理的默认值"，猜错用户可改。
 *
 * ⚠️ 名字为空的宠物会被跳过（空串会被任何正文"包含"，是最容易踩的坑）。
 */
import type { PetProfile } from '../services/petService'

/**
 * 从文本里识别提到的宠物
 *
 * @param text - 回忆正文（可为空）
 * @param pets - 候选宠物列表（调用方需保证非空）
 * @param fallbackPetId - 一只都没提到时的兜底宠物 id（通常是当前宠物）
 * @returns 命中的宠物 id 列表，**至少一个**（列表非空的前提下）
 */
export function detectPetsInText(
  text: string,
  pets: PetProfile[],
  fallbackPetId?: string,
): string[] {
  if (!pets.length) return []
  const body = (text || '').trim()
  if (body) {
    // 名字长的优先（"烧鸡腿"与"烧鸡"同时是宠物名时，别把长名字的那只漏掉）
    const matched = pets
      .filter((p) => !!p.name && !!p.name.trim() && body.includes(p.name))
      .sort((a, b) => b.name.length - a.name.length)
      .map((p) => p.id)
    if (matched.length) return Array.from(new Set(matched))
  }
  const fallback = fallbackPetId && pets.some((p) => p.id === fallbackPetId)
    ? fallbackPetId
    : pets[0].id
  return [fallback]
}

/**
 * 把宠物对象转成回忆卡片上的标签结构（与后端 content.pets 同形）
 *
 * 只在前端"乐观插入/服务端未回填"时使用，正常路径以服务端返回的 content.pets 为准。
 */
export function toPetTags(pets: PetProfile[]): { id: string; name: string; emoji: string }[] {
  return pets.map((p) => ({
    id: p.id,
    name: p.name,
    emoji: p.species === 'cat' ? '🐱' : p.species === 'dog' ? '🐕' : '🐾',
  }))
}
