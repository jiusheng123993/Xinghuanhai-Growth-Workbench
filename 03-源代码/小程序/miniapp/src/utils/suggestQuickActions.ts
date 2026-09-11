/**
 * 智能快捷操作推荐
 * 根据用户消息关键词，推荐最相关的快捷操作
 *
 * 2026-09-10：图标从 emoji 统一改为面性图标名（icon 字段），
 * 由首页用 <Icon> 组件渲染，保证与全站图标体系一致、可随主题换色。
 */
import type { FillIconName } from '../components/icons-fill'

export interface QuickAction {
  action: string
  label: string
  /** 面性图标名（原为 emoji 字符串） */
  icon: FillIconName
}

const DEFAULT_ACTIONS: QuickAction[] = [
  { action: 'checkin', label: '打卡', icon: 'clipboard-text' },
  { action: 'food', label: '查食物', icon: 'magnifying-glass' },
  { action: 'symptom', label: '症状初筛', icon: 'stethoscope' },
]

const KEYWORD_MAP: Array<{ keywords: string[]; action: QuickAction }> = [
  {
    keywords: ['精神', '食欲', '拉稀', '呕吐', '咳嗽', '没精神', '不舒服', '异常', '生病', '生病了', '不爱动', '蔫', '发烧', '感冒', '腹泻', '便血'],
    action: { action: 'symptom', label: '症状初筛', icon: 'stethoscope' },
  },
  {
    keywords: ['吃', '能吃', '食物', '喂', '猫粮', '狗粮', '零食', '营养', '可以吃', '不能吃', '有毒', '中毒', '葡萄', '巧克力', '葱', '蒜'],
    action: { action: 'food', label: '查食物', icon: 'magnifying-glass' },
  },
  {
    keywords: ['打卡', '今天怎么样', '检查', '日常', '记录健康', '健康检查', '大便', '小便', '体重'],
    action: { action: 'checkin', label: '打卡', icon: 'clipboard-text' },
  },
  {
    keywords: ['名字', '取名', '叫什么', '新宠物', '起名', '命名', '好听的名字'],
    action: { action: 'naming', label: 'AI取名', icon: 'sparkle' },
  },
  {
    keywords: ['回忆', '记录', '照片', '纪念', '日记', '时光', '成长', '小时候'],
    action: { action: 'memory', label: '记录回忆', icon: 'camera' },
  },
]

/**
 * 根据用户消息分析推荐快捷操作
 * 返回最多 3 个最相关的操作，不足则用默认操作补齐
 */
export function suggestQuickActions(userMessage: string): QuickAction[] {
  const msg = userMessage.toLowerCase()
  const matched: QuickAction[] = []
  const seenActions = new Set<string>()

  for (const { keywords, action } of KEYWORD_MAP) {
    if (seenActions.has(action.action)) continue
    if (keywords.some(kw => msg.includes(kw.toLowerCase()))) {
      matched.push(action)
      seenActions.add(action.action)
    }
  }

  // 用默认操作补齐到 3 个
  for (const def of DEFAULT_ACTIONS) {
    if (matched.length >= 3) break
    if (seenActions.has(def.action)) continue
    matched.push(def)
    seenActions.add(def.action)
  }

  return matched.slice(0, 3)
}
