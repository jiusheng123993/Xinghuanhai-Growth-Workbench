/**
 * AI 能力入口的路由工具（2026-09-12 收口批次 §2 新增）
 *
 * 【这个文件解决什么问题】
 * IA 口径「团团 = 全站 AI 能力的唯一入口」落地后，散落各处的 AI 入口都要跳团团
 * （`TAB_BAR_AI_PATH`）。但如果只跳到"团团首屏"，用户还得在能力条上再点一次 ——
 * 等于把"唯一入口"做成"多一步入口"，违背 IA 意图。
 * 所以团团接受一个可选路由参数 `capability`，带参数进来即自动触发对应能力。
 *
 * 【为什么单独抽一个工具函数，而不是各处自己拼字符串】
 * 参数名 `capability` 与取值 key（`food` / `symptom` / ...）是**入口与团团页之间的契约**：
 *   · 团团页读取侧：`pagesYuantuan/agent/index.tsx` 直接引用本文件的 `AI_CAPABILITY_KEYS` 做白名单校验；
 *   · 入口写入侧：本文件的 `buildAiEntryUrl()`。
 * 若各处手拼 `?capability=food`，改参数名时必然漏改某一处，症状是"点了按钮跳过去却没反应"
 * ——而且**不报错**，只有真机点得出来。抽到这里后，写入侧只有一个函数、读取侧只有一份白名单，
 * 且读取侧引用的就是这份白名单本身（不是抄一份），两侧不可能漂移。
 *
 * `utils/__tests__/aiEntry.test.ts` 会锁住参数名与关键取值，改名/改值会被测试拦下。
 */
import { TAB_BAR_AI_PATH } from '../constants/tabBar'

/**
 * 团团页支持「带参数自动触发」的能力 key 白名单
 *
 * 【为什么只列这几个】与 IA 的判断标准一致：
 *   · **需要 AI 推理的能力** → 才值得收拢到团团、才有"带参数直达"的意义（本清单）；
 *   · **纯记录 / 查询类**（打卡 / 品种 / 疫苗 / 时光）→ 入口本就该原路径直达，
 *     不该往团团引，因此团团页对这几个 key 也**不做任何反应**。
 *
 * 这组取值由团团页（`pagesYuantuan/agent/index.tsx` 的 `AUTO_CAPABILITY_KEYS`）直接引用做校验，
 * 是两侧共用的唯一真相 —— 不要在任何地方再抄一份等价的字符串数组。
 */
export const AI_CAPABILITY_KEYS = ['food', 'symptom', 'hospital', 'naming', 'memory'] as const

/** 团团页可自动触发的 AI 能力 key（由上面的白名单派生，避免两处各写一遍联合类型） */
export type AiCapabilityKey = (typeof AI_CAPABILITY_KEYS)[number]

/**
 * 拼出「带能力参数」的团团入口 URL
 *
 * @param capability - 要自动触发的 AI 能力 key；传 `undefined` 则等同于只打开团团首屏
 * @returns 形如 `/pagesYuantuan/agent/index?capability=food` 的可直接交给 `Taro.navigateTo` 的 URL
 *
 * 【为什么非法 key 不在这里拦】本函数只负责拼串；"非法值什么都不做"的兜底由团团页
 * （读取侧）负责 —— 读取侧是唯一收口，拦两次会让"到底谁说了算"变模糊。
 */
export function buildAiEntryUrl(capability?: AiCapabilityKey): string {
  return capability ? `${TAB_BAR_AI_PATH}?capability=${capability}` : TAB_BAR_AI_PATH
}
