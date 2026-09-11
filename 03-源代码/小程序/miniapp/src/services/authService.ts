/**
 * 认证服务
 *
 * 微信登录（code 换取 token）、用户信息获取、Token 刷新、退出登录
 */
// 星河宠记 v2.0 - 认证服务
import Taro from '@tarojs/taro';
import { api } from './api';
import { storage } from '../utils/storage';
import type { User as UserProfile } from '../types';

/** 登录结果 */
export interface LoginResult {
  success: boolean;
  token?: string;
  user?: UserProfile;
  error?: string;
}

/**
 * 微信登录：获取 code 并换取 token
 */
export async function loginWithCode(): Promise<LoginResult> {
  try {
    // 1. 调用 Taro.login() 获取微信临时凭证 code
    const { code } = await Taro.login();

    if (!code) {
      return { success: false, error: '未获取到微信登录凭证' };
    }

    // 2. 将 code 发送到后端换取 token
    const result = await api.post<{ token: string; user: { id: string; nickname?: string; avatarUrl?: string } }>(
      '/api/auth/login',
      { provider: 'wechat', code }
    );

    if (result.token && result.user) {
      const user: UserProfile = {
        id: result.user.id,
        nickname: result.user.nickname ?? '',
        avatar: result.user.avatarUrl ?? '',
        createdAt: new Date().toISOString(),
      };
      storage.setToken(result.token);
      return {
        success: true,
        token: result.token,
        user,
      };
    }

    return { success: false, error: '登录失败' };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : '登录失败',
    };
  }
}

/**
 * 获取用户信息
 */
export async function getUserProfile(userId: string): Promise<UserProfile | null> {
  try {
    const raw = await api.get<{ id: string; nickname?: string; avatarUrl?: string }>('/api/auth/profile');

    if (raw) {
      const user: UserProfile = {
        id: raw.id,
        nickname: raw.nickname ?? '',
        avatar: raw.avatarUrl ?? '',
        createdAt: new Date().toISOString(),
      };
      return user;
    }

    return null;
  } catch (err) {
    return null;
  }
}

/**
 * 刷新 Token（当前后端未提供专用刷新端点，保留接口兼容）
 * @param token - 旧 refresh token（参数原名 refreshToken 与函数名同名，
 *  触发 @typescript-eslint/no-shadow，2026-09-11 改名 token）
 */
export async function refreshToken(token: string): Promise<{
  success: boolean;
  token?: string;
  error?: string;
}> {
  try {
    const result = await api.post<{ token: string }>('/api/auth/refresh', { refreshToken: token });
    if (result.token) {
      storage.setToken(result.token);
      return { success: true, token: result.token };
    }
    return { success: false, error: '刷新失败' };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : '刷新 Token 失败',
    };
  }
}

/**
 * 绑定手机号（微信 getPhoneNumber）
 * @param code - 微信手机号授权码
 * @returns 绑定结果，成功时返回脱敏手机号后4位
 */
export async function bindPhone(code: string): Promise<{ success: boolean; phone?: string }> {
  try {
    // ⚠️【2026-09-11 修复】后端成功时返回 `{ success: true, data: { phone } }`，
    // 而 api 层在 body.success 为真时返回的是 **body.data**（即 `{ phone }`），
    // 不再有 success 字段。这里原来读 `result.success` → 恒为 undefined（假）
    // → **绑定手机号即使成功也永远返回失败**；phone 也要从同一层取。
    // 现在：api 层不抛错即视为成功（业务失败时它会 throw，见 services/api.ts 的 request()）。
    const data = await api.post<{ phone?: string }>('/api/auth/bind-phone', { code });
    return { success: true, phone: data?.phone };
  } catch {
    return { success: false };
  }
}

/**
 * 退出登录
 */
export async function logout(): Promise<void> {
  storage.removeToken();
}
