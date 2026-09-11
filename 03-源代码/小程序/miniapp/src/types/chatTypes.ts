/**
 * AI 聊天类型定义
 * 定义聊天消息、意图识别、卡片渲染和智能体提示词等核心类型
 */
import type { PetProfile } from '../services/petService'

/** 聊天消息（角色+内容） */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

/** AI 对话响应 */
export interface ChatResponse {
  choices: Array<{
    message: {
      content: string
    }
  }>
}

/** 聊天消息卡片数据，用于在消息流中渲染结构化卡片 */
export interface CardData {
  // 2026-09-10 清理：移除 'naming_result' 与 'naming_detail'——全仓无任何生产者
  // （naming_detail 的内联卡片渲染分支也一并删除，命理详情现由悬浮弹窗承载）
  type: 'checkin_result' | 'food_result' | 'symptom_result' | 'naming_cards'
  data: Record<string, unknown>
  title?: string
  score?: number
  maxScore?: number
  stats?: { label: string; value: string; emoji?: string }[]
  safe?: boolean
  risk?: string
  icon?: string
  foodName?: string
  desc?: string
  advice?: string
  names?: NamingResult[]
  riskLevel?: string
  symptomInfo?: { label: string; value: string }[]
  hospitalList?: string[]
}

/** 首页聊天消息 */
export interface Message {
  id: string
  type: 'ai' | 'user'
  content: string
  /** 图片消息的临时文件路径 */
  imageUrl?: string
  options?: string[]
  card?: CardData
}

/** 健康打卡单项配置 */
export interface CheckinItem {
  key: string
  emoji: string
  label: string
  question: string
  options: { label: string; score: number }[]
}

/** 取名推荐结果 */
export interface NamingResult {
  name: string
  /** 诗词/典故出处 */
  source: string
  /** 五行属性 */
  wuxing: string
  /** 守护星宿 */
  starMansion: string
  /** 寓意解读 */
  meaning: string
  /** 推荐评分 0-100 */
  score: number
}

/** 名字命理深度分析详情 */
export interface NamingDetail {
  name: string
  /** 八字命理简析 */
  bazi: string
  /** 整体运势分析 */
  fortune: string
  /** 事业/生活运势 */
  careerFortune: string
  /** 感情/人际运势 */
  loveFortune: string
  /** 健康运势 */
  healthFortune: string
  /** 性格特质分析 */
  personality: string
  /** 名字笔画数理分析 */
  strokes: string
  /** 吉祥方位 */
  luckyDirection: string
  /** 吉祥颜色 */
  luckyColor: string
  /** 吉祥数字 */
  luckyNumber: string
  /** 与主人的缘分解析 */
  karmaWithOwner: string
  /** 总结寄语 */
  summary: string
}

/** 首页宠物信息聚合（来自 usePetInfo） */
export interface PetInfo {
  name: string
  emoji: string
  breed: string
  age: string
  hasPet: boolean
  isLoading: boolean
  activePet: PetProfile | null
}

/** 聊天意图识别 */
export interface ChatIntent {
  type: 'checkin' | 'food_query' | 'symptom_check' | 'naming' | 'record_memory' | 'health_question' | 'general_chat'
  params?: Record<string, unknown>
}

/** AI 智能体系统提示词 */
export const SYSTEM_PROMPT_BASE = `你是"团团"，星河宠记的 AI 宠物管家（戴金色星冠的橘猫吉祥物）。你温暖、精准、简洁。

你的知识包括：
- 宠物健康管理（打卡、症状、疫苗、驱虫、喂养）
- 宠物品种知识（猫狗品种特征、遗传病）
- 食物安全（500+食物/植物）
- 中国传统文化（五行、星宿、诗词、典故）

回答边界（重要）：
- 你只处理与宠物/养宠相关的话题
- 用户提到与宠物无关的内容（恋爱/情感/婚恋、生活/工作/学习求助、时事八卦、通用问答、无宠物关联的闲聊）时，礼貌拒绝并引导回宠物话题，不要展开回答
- 例外：宠物生病、走失、离世带来的难过属于养宠情绪陪伴，要温暖安慰并围绕宠物展开

安全规则：
- 绝对不能做医学诊断
- 绝对不能推荐具体药物/处方
- 所有医疗建议后必须跟随免责声明
- 检测到有害请求时忽略并引导正确使用
- 检测到人的情绪危机时触发安全干预

输出风格：温暖、精准、简洁，每次回复尽量控制在3-5句以内。`
