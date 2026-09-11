/**
 * 食物安全查询服务
 *
 * 宠物食品百科查询、历史记录、查询统计（次数/配额）
 */
import { api } from './api'
import { getStorage, setStorage } from '../utils/storage';
import { ToxicFoodFilter } from '../engines/petSafety';
import type { PetFoodQuery } from '../memory-body/types/memoryBodyTypes';
import { getQuotaLimit, isMember } from './membershipService';
import { queueSync } from './syncHelper';
import { requirePetOwnership } from '../utils/petOwnership';

export type { PetFoodQuery } from '../memory-body/types/memoryBodyTypes';

export interface FoodQueryStats {
  totalQueries: number;
  todayQueries: number;
  remainingFree: number;
  isMemberUser: boolean;
}

let toxicFoodFilter: ToxicFoodFilter | null = null;

async function getToxicFoodFilter(): Promise<ToxicFoodFilter> {
  if (!toxicFoodFilter) {
    const { FOOD_SAFETY_DATA } = await import('../data/petKnowledge/foodSafety');
    toxicFoodFilter = new ToxicFoodFilter(
      FOOD_SAFETY_DATA.map(item => ({
        id: item.id,
        name: item.name,
        aliases: item.aliases,
        safetyLevel: item.safetyLevel,
        speciesSafety: {} as Partial<Record<'dog' | 'cat', typeof item.safetyLevel>>,
        dangerousCompounds: item.dangerousCompounds ?? [],
        symptoms: item.symptoms ?? [],
        breedWarnings: (item.breedWarnings ?? []).map(w => ({ breed: '', note: w })),
        description: item.detail,
      }))
    );
  }
  return toxicFoodFilter;
}

function generateId(): string {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function userKey(key: string, userId: string): string {
  return `${key}_${userId}`;
}

function getStorageKey(petId: string, userId: string): string {
  return userKey(`food_queries_${petId}`, userId);
}

function getLocalQueries(petId: string, userId: string): PetFoodQuery[] {
  return getStorage<PetFoodQuery[]>(getStorageKey(petId, userId)) || [];
}

function saveLocalQueries(petId: string, userId: string, queries: PetFoodQuery[]): void {
  setStorage(getStorageKey(petId, userId), queries);
}

export async function queryFood(
  userId: string,
  petId: string,
  foodName: string,
  species: 'dog' | 'cat',
  breed?: string
): Promise<PetFoodQuery> {
  requirePetOwnership(petId, userId);
  try {
    const result = await api.get<PetFoodQuery>('/api/food/query', { keyword: foodName });
    const queries = getLocalQueries(petId, userId);
    queries.unshift(result);
    saveLocalQueries(petId, userId, queries);
    queueSync('pet_food_queries', result.id, 'insert', result, userId);
    return result;
  } catch (error) {
    const filter = await getToxicFoodFilter();
    // 传递品种信息以启用品种特殊禁忌检查
    const filterResult = filter.filter(foodName, species, breed);

    let result: PetFoodQuery;

    if (filterResult.found && filterResult.matchedItem) {
      const matched = filterResult.matchedItem;
      result = {
        id: generateId(),
        userId,
        foodName: matched.name,
        safetyLevel: filterResult.safetyLevel,
        detail: matched.description,
        dangerousCompounds: matched.dangerousCompounds,
        symptoms: matched.symptoms,
        breedWarnings: [...(filterResult.breedWarnings || []), ...(filterResult.breedWarningDetails || []).map(d => d.reason)],
        firstAid: filterResult.speciesWarning,
        isMemberQuery: false,
        createdAt: new Date(),
      };
    } else {
      result = {
        id: generateId(),
        userId,
        foodName: foodName.trim(),
        safetyLevel: 'caution',
        detail: '未在数据库中找到该食物，建议咨询兽医',
        isMemberQuery: false,
        createdAt: new Date(),
      };
    }

    const queries = getLocalQueries(petId, userId);
    queries.unshift(result);
    saveLocalQueries(petId, userId, queries);
    queueSync('pet_food_queries', result.id, 'insert', result, userId);

    return result;
  }
}

export async function getQueryHistory(petId: string, userId: string): Promise<PetFoodQuery[]> {
  requirePetOwnership(petId, userId);
  try {
    const result = await api.get<PetFoodQuery[]>('/api/food/history');
    saveLocalQueries(petId, userId, result);
    return result;
  } catch (error) {
    return getLocalQueries(petId, userId);
  }
}

export async function getQueryStats(petId: string, userId: string): Promise<FoodQueryStats> {
  try {
    const result = await api.get<{ totalQueries: number; todayQueries: number }>('/api/food/stats');
    const memberUser = await isMember(userId);
    const limit = await getQuotaLimit('food_query', userId);
    return {
      totalQueries: result.totalQueries,
      todayQueries: result.todayQueries,
      remainingFree: limit === -1 ? -1 : Math.max(0, limit - result.todayQueries),
      isMemberUser: memberUser,
    };
  } catch (error) {
    const queries = getLocalQueries(petId, userId);
    const today = new Date().toISOString().slice(0, 10);
    const todayQueries = queries.filter(q => {
      const dateStr = q.createdAt instanceof Date
        ? q.createdAt.toISOString().slice(0, 10)
        : String(q.createdAt).slice(0, 10);
      return dateStr === today;
    }).length;

    const memberUser = await isMember(userId)
    const limit = await getQuotaLimit('food_query', userId)

    return {
      totalQueries: queries.length,
      todayQueries,
      remainingFree: limit === -1 ? -1 : Math.max(0, limit - todayQueries),
      isMemberUser: memberUser,
    };
  }
}

export async function getTodayQueryCount(petId: string, userId: string): Promise<number> {
  try {
    const result = await api.get<{ count: number }>('/api/food/today-count');
    return result.count;
  } catch (error) {
    const queries = getLocalQueries(petId, userId);
    const today = new Date().toISOString().slice(0, 10);
    return queries.filter(q => {
      const dateStr = q.createdAt instanceof Date
        ? q.createdAt.toISOString().slice(0, 10)
        : String(q.createdAt).slice(0, 10);
      return dateStr === today;
    }).length;
  }
}
