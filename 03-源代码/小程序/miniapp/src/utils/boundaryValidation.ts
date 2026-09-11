/**
 * 边界值校验 - 纯函数工具集
 * 每个函数返回 null 表示校验通过，返回字符串表示错误信息
 */

/** 宠物名称最大长度 */
const PET_NAME_MAX_LENGTH = 50;
/** 宠物名称允许的字符：中文、英文、数字、空格、常用标点 */
const PET_NAME_PATTERN = /^[\u4e00-\u9fff\u3400-\u4dbfa-zA-Z0-9\s\-_.·]+$/;
/** 食物搜索关键词最大长度 */
const FOOD_SEARCH_MAX_LENGTH = 100;
/** 体重上限 (kg) */
const WEIGHT_MAX = 999.99;

/**
 * 校验宠物名称
 * @returns 错误信息，null 表示通过
 */
export function validatePetName(name: string): string | null {
  if (!name || name.trim().length === 0) {
    return '请输入宠物名称';
  }
  if (name.length > PET_NAME_MAX_LENGTH) {
    return `宠物名称不能超过${PET_NAME_MAX_LENGTH}个字符`;
  }
  if (!PET_NAME_PATTERN.test(name)) {
    return '宠物名称包含不允许的特殊字符';
  }
  return null;
}

/**
 * 校验体重
 * @param weight 体重值（字符串或数字）
 * @returns 错误信息，null 表示通过
 */
export function validateWeight(weight: string | number): string | null {
  const numWeight = typeof weight === 'string' ? parseFloat(weight) : weight;
  // 用 Number.isNaN 而非全局 isNaN：numWeight 必经 parseFloat 或本身即 number，两者语义等价，
  // 且 Number.isNaN 不会对非数字入参做隐式类型转换（避免 "abc" 被误判成 NaN 的歧义）
  if (Number.isNaN(numWeight) || numWeight <= 0) {
    return '请输入有效体重';
  }
  if (numWeight > WEIGHT_MAX) {
    return `体重不能超过${WEIGHT_MAX}kg`;
  }
  return null;
}

/**
 * 校验出生日期
 * @param dateStr 日期字符串，格式 YYYY-MM-DD
 * @returns 错误信息，null 表示通过
 */
export function validateBirthDate(dateStr: string): string | null {
  if (!dateStr) {
    return '请选择出生日期';
  }
  const date = new Date(dateStr + 'T00:00:00.000Z');
  // getTime() 返回 number（非法日期为 NaN），Number.isNaN 与原生 isNaN 在此完全等价
  if (Number.isNaN(date.getTime())) {
    return '出生日期格式不正确';
  }
  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10);
  if (dateStr > todayStr) {
    return '出生日期不能晚于今天';
  }
  return null;
}

/**
 * 校验食物搜索关键词
 * @returns 错误信息，null 表示通过
 */
export function validateFoodSearch(keyword: string): string | null {
  if (!keyword || keyword.trim().length === 0) {
    return '请输入食物名称';
  }
  if (keyword.length > FOOD_SEARCH_MAX_LENGTH) {
    return `食物名称不能超过${FOOD_SEARCH_MAX_LENGTH}个字符`;
  }
  return null;
}

/**
 * 校验症状初筛选择
 * @returns 错误信息，null 表示通过
 */
export function validateSymptomSelection(symptoms: string[]): string | null {
  if (!symptoms || symptoms.length === 0) {
    return '请至少选择一个症状';
  }
  return null;
}