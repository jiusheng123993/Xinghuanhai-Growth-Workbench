/**
 * 食物安全数据库入口
 * 聚合所有安全等级的食物数据，提供统一的查询接口
 */

/** 食物安全条目 */
import { FOOD_SAFETY_ORIGINAL_A } from './foodSafetyOriginalA'
import { FOOD_SAFETY_ORIGINAL_B } from './foodSafetyOriginalB'
import { FOOD_SAFETY_TOXIC_A } from './foodSafetyToxicA'
import { FOOD_SAFETY_TOXIC_B } from './foodSafetyToxicB'
import { FOOD_SAFETY_DANGEROUS_A } from './foodSafetyDangerousA'
import { FOOD_SAFETY_DANGEROUS_B } from './foodSafetyDangerousB'
import { FOOD_SAFETY_CAUTION_A } from './foodSafetyCautionA'
import { FOOD_SAFETY_CAUTION_B } from './foodSafetyCautionB'
import { FOOD_SAFETY_SAFE_VEG } from './foodSafetySafeVeg'
import { FOOD_SAFETY_SAFE_FRUIT } from './foodSafetySafeFruit'
import { FOOD_SAFETY_SAFE_MEAT } from './foodSafetySafeMeat'
import { FOOD_SAFETY_SAFE_GRAIN } from './foodSafetySafeGrain'
import { FOOD_SAFETY_SUPPLEMENT_A } from './foodSafetySupplementA'
import { FOOD_SAFETY_SUPPLEMENT_B } from './foodSafetySupplementB'

export interface FoodSafetyItem {
  id: string
  name: string
  aliases: string[]
  safetyLevel: 'safe' | 'caution' | 'dangerous' | 'toxic'
  speciesApplicable: ('dog' | 'cat')[]
  dangerousCompounds?: string[]
  toxicDoses?: string
  symptoms?: string[]
  breedWarnings?: string[]
  detail: string
  firstAid?: string
}

export const FOOD_SAFETY_DATA: FoodSafetyItem[] = [
  ...FOOD_SAFETY_ORIGINAL_A,
  ...FOOD_SAFETY_ORIGINAL_B,
  ...FOOD_SAFETY_TOXIC_A,
  ...FOOD_SAFETY_TOXIC_B,
  ...FOOD_SAFETY_DANGEROUS_A,
  ...FOOD_SAFETY_DANGEROUS_B,
  ...FOOD_SAFETY_CAUTION_A,
  ...FOOD_SAFETY_CAUTION_B,
  ...FOOD_SAFETY_SAFE_VEG,
  ...FOOD_SAFETY_SAFE_FRUIT,
  ...FOOD_SAFETY_SAFE_MEAT,
  ...FOOD_SAFETY_SAFE_GRAIN,
  ...FOOD_SAFETY_SUPPLEMENT_A,
  ...FOOD_SAFETY_SUPPLEMENT_B,
]
