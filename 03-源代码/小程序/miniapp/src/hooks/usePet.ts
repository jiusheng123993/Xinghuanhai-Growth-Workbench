/**
 * 宠物信息管理 Hook
 * 提供宠物资料的增删改查、切换及状态管理
 */
import { useEffect, useCallback } from 'react';
import Taro from '@tarojs/taro';
import { usePetStore, type PetProfile } from '../stores/petStore';
import { useAuthStore } from '../stores/authStore';

interface UsePetReturn {
  pets: PetProfile[];
  currentPet: PetProfile | null;
  isLoading: boolean;
  error: string | null;
  initUser: (userId: string) => Promise<void>;
  addPet: (data: Omit<PetProfile, 'id' | 'createdAt' | 'updatedAt'>) => Promise<PetProfile>;
  updatePet: (id: string, data: Partial<PetProfile>) => Promise<void>;
  removePet: (id: string) => Promise<void>;
  markPetDeceased: (id: string, date: string) => Promise<void>;
  switchPet: (id: string) => Promise<void>;
  refreshPets: () => Promise<void>;
  clearError: () => void;
}

/**
 * 宠物信息管理 Hook
 * 提供宠物资料的增删改查、切换及状态管理
 */
export function usePet(): UsePetReturn {
  const {
    userId,
    pets,
    currentPet,
    isLoading,
    error,
    initUser,
    fetchPets,
    addPet,
    updatePet,
    removePet,
    markPetDeceased,
    switchPet,
    clearError,
  } = usePetStore();

  const authUserId = useAuthStore(s => s.user?.id || '');

  useEffect(() => {
    if (authUserId && !userId) {
      initUser(authUserId);
    }
  }, [authUserId, userId, initUser]);

  useEffect(() => {
    if (userId && pets.length === 0 && !isLoading) {
      fetchPets(userId)
    }
  }, [userId, pets.length, isLoading, fetchPets]);

  const handleInitUser = useCallback(
    async (uid: string): Promise<void> => {
      await initUser(uid);
    },
    [initUser]
  );

  const handleAddPet = useCallback(
    async (data: Omit<PetProfile, 'id' | 'createdAt' | 'updatedAt'>): Promise<PetProfile> => {
      return addPet(data);
    },
    [addPet]
  );

  const handleUpdatePet = useCallback(
    async (id: string, data: Partial<PetProfile>): Promise<void> => {
      await updatePet(id, data);
    },
    [updatePet]
  );

  const handleRemovePet = useCallback(
    async (id: string): Promise<void> => {
      await removePet(id);
    },
    [removePet]
  );

  const handleMarkPetDeceased = useCallback(
    async (id: string, date: string): Promise<void> => {
      await markPetDeceased(id, date);
    },
    [markPetDeceased]
  );

  /**
   * 切换当前宠物（带失败兜底）
   *
   * 2026-09-11 统一：petStore.switchPet 失败时会 `throw err`，而本 hook 被
   * 打卡 / 疫苗 / 症状自查 / 食物查询 四个页面的 <PetSwitcher onSwitch={switchPet}> 直接引用，
   * 原先这里不接这个 promise —— 切换失败时既没有提示（用户点另一只宠物"没反应"），
   * 又会冒未处理的 Promise rejection。在此统一兜住，四处页面一起修好。
   */
  const handleSwitchPet = useCallback(
    async (id: string): Promise<void> => {
      try {
        await switchPet(id);
      } catch (err) {
        // 优先用**本次**捕获的异常信息：store.error 可能是上一次无关操作留下的旧消息
        // （例如 fetchPets 失败只写 error、不抛错）—— 2026-09-11 审查 P2-5
        const msg = err instanceof Error ? err.message : '';
        Taro.showToast({ title: msg || usePetStore.getState().error || '切换失败，请重试', icon: 'none' });
      }
    },
    [switchPet]
  );

  const handleRefreshPets = useCallback(async (): Promise<void> => {
    if (userId) {
      await fetchPets(userId);
    }
  }, [fetchPets, userId]);

  const handleClearError = useCallback((): void => {
    clearError();
  }, [clearError]);

  return {
    pets,
    currentPet,
    isLoading,
    error,
    initUser: handleInitUser,
    addPet: handleAddPet,
    updatePet: handleUpdatePet,
    removePet: handleRemovePet,
    markPetDeceased: handleMarkPetDeceased,
    switchPet: handleSwitchPet,
    refreshPets: handleRefreshPets,
    clearError: handleClearError,
  };
}
