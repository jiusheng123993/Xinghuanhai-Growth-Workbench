/**
 * Agent 确定性意图预筛（纯函数，无依赖）
 * 目的：对可规则识别的高置信度意图，在调用付费 LLM 意图分类前先用正则命中，
 * 既省一次分类调用，又消除 LLM 分类的不确定性——例如把「这是什么猫」误判为 chat，
 * 导致不调 search_breed_info、不跳品种详情页（用户「AI 识别到品种却没跳」的根因之一）。
 * 只收录高精度规则：宁可漏判（回落到 LLM 分类）也不误判（误判会污染意图路由）。
 */

/** 品种提问规则：命中即锁定 breed 意图（意图分类步骤可跳过） */
const BREED_QUESTION_PATTERNS: RegExp[] = [
  /这是什么(?:猫|狗|犬|品种|种类)/, // "这是什么猫/狗/品种"
  /这是(?:啥|什么)(?:猫|狗|犬)/,     // "这是啥猫"
  /是什么(?:猫|狗|犬|品种)/,         // "是什么猫"
  /(?:啥|什么|哪个)品种/,            // "什么品种/啥品种"
  /(?:猫|狗|犬)的品种/,              // "猫的品种"
];

/** 归一化：去空白、转小写（中文问句去空格；英文无关紧要） */
function normalize(text: string): string {
  return (text || '').replace(/\s+/g, '').toLowerCase();
}

/** 是否为品种提问（供 Agent 意图预筛使用） */
export function detectBreedQuestion(text: string): boolean {
  const t = normalize(text);
  if (!t) return false;
  return BREED_QUESTION_PATTERNS.some((p) => p.test(t));
}
