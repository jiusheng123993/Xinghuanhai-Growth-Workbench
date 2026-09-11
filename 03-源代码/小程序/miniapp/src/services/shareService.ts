/**
 * 分享服务
 *
 * 生成并分享宠物健康报告/动态等内容的图片
 */
import Taro from '@tarojs/taro'
import { CONFIG } from '../config'
import { api } from './api';
import {
  INVITE_CODE_LENGTH,
  INVITE_CODE_MAX_USE,
  SHARE_REWARD_INVITES,
  SHARE_REWARD_DAYS,
} from '../constants';
import type {
  ShareCardType,
  ShareRecord,
  InviteCode,
  ReferralRecord,
  ShareStats,
  ShareRewardResult,
} from '../types/shareTypes';

const SHARE_HISTORY_KEY = 'xhh_share_history';
const INVITE_CODE_KEY = 'xhh_invite_code';

function generateInviteCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < INVITE_CODE_LENGTH; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

export async function getOrCreateInviteCode(userId: string): Promise<string> {
  const cached = Taro.getStorageSync(INVITE_CODE_KEY);
  if (cached) return cached;

  try {
    const result = await api.get<{ code: string }>('/api/invite-code')
    if (result.code) {
      Taro.setStorageSync(INVITE_CODE_KEY, result.code);
      return result.code;
    }
  } catch {
    // fall through to local generation
  }

  const code = generateInviteCode();
  Taro.setStorageSync(INVITE_CODE_KEY, code);
  return code;
}

export async function recordShare(
  userId: string,
  cardType: ShareCardType,
  petId: string,
  platform: string
): Promise<ShareRecord | null> {
  const inviteCode = await getOrCreateInviteCode(userId);

  try {
    const record = await api.post<ShareRecord>('/api/shares', {
      user_id: userId,
      card_type: cardType,
      pet_id: petId,
      platform,
      invite_code: inviteCode,
    });

    const history: ShareRecord[] = Taro.getStorageSync(SHARE_HISTORY_KEY) || [];
    history.push(record);
    Taro.setStorageSync(SHARE_HISTORY_KEY, history);

    return record;
  } catch {
    return null;
  }
}

export async function getShareStats(userId: string): Promise<ShareStats> {
  const history: ShareRecord[] = Taro.getStorageSync(SHARE_HISTORY_KEY) || [];

  const foodShares = history.filter(r => r.cardType === 'food').length;
  const trendShares = history.filter(r => r.cardType === 'health_trend').length;
  const vaccineShares = history.filter(r => r.cardType === 'vaccine').length;
  const achievementShares = history.filter(r => r.cardType === 'achievement').length;

  try {
    const referrals = await api.get<ReferralRecord[]>('/api/referrals')
    return {
      totalShares: history.length,
      foodShares,
      trendShares,
      vaccineShares,
      achievementShares,
      totalInvites: referrals.length,
      successfulInvites: referrals.filter(r => r.rewardGranted).length,
    };
  } catch {
    return {
      totalShares: history.length,
      foodShares,
      trendShares,
      vaccineShares,
      achievementShares,
      totalInvites: 0,
      successfulInvites: 0,
    };
  }
}

export async function processReferral(
  inviteCode: string,
  newUserId: string
): Promise<boolean> {
  try {
    await api.post('/api/referrals/process', {
      invite_code: inviteCode,
      invitee_id: newUserId,
    });
    return true;
  } catch {
    return false;
  }
}

/** 待处理邀请码的本地存储 key（启动参数带入，登录成功后消费） */
export const PENDING_INVITE_CODE_KEY = 'xhh_pending_invite_code'

/**
 * 登录成功后消费待处理邀请码，建立推荐关系（邀请裂变链路）
 * @param userId - 当前登录用户 ID
 */
export async function processPendingReferral(userId: string): Promise<void> {
  try {
    const code = Taro.getStorageSync(PENDING_INVITE_CODE_KEY)
    if (!code || typeof code !== 'string') return
    // 仅在服务端确认建立推荐关系后清除；网络失败（processReferral 返回 false）保留供下次重试
    const ok = await processReferral(code, userId)
    if (ok) {
      Taro.removeStorageSync(PENDING_INVITE_CODE_KEY)
    }
  } catch {
    // 处理失败保留邀请码，下次登录再试
  }
}

export function getLocalShareHistory(): ShareRecord[] {
  return Taro.getStorageSync(SHARE_HISTORY_KEY) || [];
}

export function clearLocalShareHistory(): void {
  Taro.removeStorageSync(SHARE_HISTORY_KEY);
}

/**
 * 领取邀请奖励
 *
 * ⚠️【2026-09-11 修复】后端 `/api/shares/grant-reward` 成功时返回的是**扁平结构**
 * `{ success: true, rewardType: 'membership_days', rewardValue: REWARD_DAYS }` —— **没有 data 包裹**；
 * 而 api 层在 `body.success` 为真时返回的是 `body.data`（即 undefined）。
 * 这里原来读 `result.success` → 读 undefined 的属性抛 TypeError → 被 catch 吞掉
 * → 恒返回「网络异常，请稍后重试」。
 * 危害不止是文案错：服务端在 res.json **之前**就已经 `UPDATE memberships` 真发了会员天数，
 * 所以用户会看到"发放失败"，实际奖励已到账（也可能因此重复领取）。
 *
 * 现在以"api 层没有抛错"为成功判据：业务失败（未达标）时后端返回 success:false，
 * api 层会 throw Error(message)，这里把该文案如实透出。
 */
export async function grantShareReward(userId: string): Promise<ShareRewardResult> {
  try {
    await api.post('/api/shares/grant-reward')
    return {
      rewardGranted: true,
      rewardType: 'membership_days',
      rewardValue: SHARE_REWARD_DAYS,
      message: `邀请${SHARE_REWARD_INVITES}位好友，奖励${SHARE_REWARD_DAYS}天会员`,
    };
  } catch (err) {
    // 未达标时后端给的是「还需邀请 N 位好友即可获得奖励」，不要一律说成网络异常
    const message = err instanceof Error && err.message && err.message !== '请求失败'
      ? err.message
      : '奖励发放失败';
    return {
      rewardGranted: false,
      rewardType: 'none',
      rewardValue: 0,
      message,
    };
  }
}
