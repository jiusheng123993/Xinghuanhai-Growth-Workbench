/**
 * emoji → 面性图标 映射表
 *
 * 【用途】全站有 92 个页面文件把 emoji 当图标用。为了让替换有据可依、口径统一，
 * 这里集中定义「哪个 emoji 该换成哪个图标」，替换脚本与人工改稿都以本表为准。
 *
 * 【取舍原则】只替换「功能性」emoji，保留「情绪/装饰」类：
 *  · 功能性（要换）：导航、按钮、卡片入口、状态提示 —— 这些位置需要精确、统一、
 *    可随主题换色的图标，emoji 在不同机型上字形差异大、无法换色、看着不专业。
 *  · 情绪/装饰（保留）：✨ 🎉 😊 💕 等 —— 它们是产品"有温度"的一部分，
 *    全部换成规整图标会让界面变得工具化、冷冰冰。
 *  · 文案符号（保留）：→ ✓ ✕ ★ 等常出现在文案里（如"查看详情 →"），
 *    属于排版符号而非图标，替换会破坏文案节奏。
 */
import type { FillIconName } from './icons-fill'

/** 需要替换成图标的 emoji（键含不带变体选择符的形式，匹配时会先剥掉 ️） */
export const EMOJI_TO_ICON: Record<string, FillIconName> = {
  // —— 宠物与家庭 ——
  '🐾': 'paw-print',
  '🐱': 'cat',
  '🐈': 'cat',
  '🐶': 'dog',
  '🐕': 'dog',
  '🐩': 'dog',

  // —— 功能入口 ——
  '📋': 'clipboard-text',
  '📝': 'note-pencil',
  '✏': 'pencil-simple',
  '🔍': 'magnifying-glass',
  '🔎': 'magnifying-glass',
  '📷': 'camera',
  '📸': 'camera',
  '🖼': 'image',
  '📅': 'calendar-check',
  '📆': 'calendar-check',
  '🍽': 'bowl-food',
  '🥣': 'bowl-food',
  '🦴': 'bone',

  // —— 健康医疗 ——
  '💉': 'syringe',
  '🩺': 'stethoscope',
  '🏥': 'hospital',
  '💊': 'pill',
  '❤': 'heart',
  '💗': 'heartbeat',
  '💓': 'heartbeat',
  '⚖': 'scales',
  '🧬': 'dna',
  '💧': 'drop',

  // —— 状态与提示 ——
  '⚠': 'warning',
  '✅': 'check-circle',
  '🚨': 'first-aid',
  '💡': 'lightbulb',
  '🔔': 'bell',
  '➕': 'plus',

  // —— 内容与工具 ——
  '📈': 'chart-line',
  '📊': 'chart-line',
  '🎨': 'palette',
  '🏆': 'trophy',
  '👑': 'crown',
  '📤': 'share-network',
  '📖': 'book-open',
  '📚': 'book-open',
  '🎬': 'film-strip',
  '👥': 'users',
  '👤': 'user',
  '🤝': 'handshake',
  '💬': 'chat-circle',
  '⚙': 'gear',
  '🚪': 'sign-out',
  '🔄': 'arrows-clockwise',
  '📍': 'map-pin',
  '⭐': 'star',
  '🌟': 'star',
  '🏠': 'house',
  '🏡': 'house',
  '⏰': 'clock',
  '🕐': 'clock',
  '⚡': 'lightning',
  '👶': 'baby',
  '💞': 'heart',
  '📄': 'clipboard-text',
}

/**
 * 明确保留、不做替换的 emoji（情绪与装饰）
 * 列出来是为了让后续审查有明确依据，而不是"忘了换"
 */
export const KEEP_EMOJI: readonly string[] = [
  '✨', '🎉', '🎊', '😊', '😄', '🥰', '😍', '😢', '😭', '😌',
  '💕', '💖', '🌈', '☀', '🌙', '✦', '🫶', '🥹',
]

/**
 * 查询某个 emoji 对应的面性图标
 *
 * @param emoji - 原始 emoji 字符（可带变体选择符 U+FE0F）
 * @returns 对应图标名；未收录（应保留原样）时返回 null
 */
export function emojiToIcon(emoji: string): FillIconName | null {
  // 先剥离变体选择符（如 ⚠️ = ⚠ + U+FE0F），统一按基础字形查表
  const base = emoji.replace(/\uFE0F/g, '')
  return EMOJI_TO_ICON[base] ?? null
}

/** 该 emoji 是否属于「应替换」的功能性图标 */
export function shouldReplaceEmoji(emoji: string): boolean {
  return emojiToIcon(emoji) !== null
}
