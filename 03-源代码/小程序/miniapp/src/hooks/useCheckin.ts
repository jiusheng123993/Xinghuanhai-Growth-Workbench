/**
 * 健康打卡 Hook
 * 提供宠物每日健康打卡的查询、提交与连续天数追踪
 */
import { useCallback } from 'react';
import { useCheckinStore } from '../stores/checkinStore';
import type { CheckinInput } from '../services/checkinService';
import type { Checkin } from '../types';

interface UseCheckinReturn {
  checkins: Checkin[];
  todayCheckin: Checkin | null;
  streakDays: number;
  isLoading: boolean;
  initUser: (userId: string) => Promise<void>;
  /**
   * 提交今日打卡
   *
   * 入参是服务层契约 CheckinInput（2026-09-11 P0 修复：原为 Partial<Checkin>，
   * 页面据此把 mood/appetite/stool 当 POST body 发出，被服务端 zod 校验挡成 400）。
   */
  doCheckin: (data: CheckinInput) => Promise<Checkin>;
  fetchCheckins: (petId: string) => Promise<void>;
}

/**
 * 健康打卡 Hook
 * 提供宠物每日健康打卡的查询、提交与连续天数追踪
 */
export function useCheckin(): UseCheckinReturn {
  const {
    checkins,
    todayCheckin,
    streakDays,
    isLoading,
    initUser,
    fetchCheckins,
    doCheckin,
  } = useCheckinStore();

  const handleInitUser = useCallback(
    async (userId: string): Promise<void> => {
      await initUser(userId);
    },
    [initUser]
  );

  const handleDoCheckin = useCallback(
    async (data: CheckinInput): Promise<Checkin> => {
      return doCheckin(data);
    },
    [doCheckin]
  );

  const handleFetchCheckins = useCallback(
    async (petId: string): Promise<void> => {
      await fetchCheckins(petId);
    },
    [fetchCheckins]
  );

  return {
    checkins,
    todayCheckin,
    streakDays,
    isLoading,
    initUser: handleInitUser,
    doCheckin: handleDoCheckin,
    fetchCheckins: handleFetchCheckins,
  };
}
