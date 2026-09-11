/**
 * 订阅消息服务
 *
 * 微信小程序订阅消息模板管理，订阅状态查询/更新
 */
import Taro from '@tarojs/taro'
import { getStorage, setStorage , storage } from '../utils/storage';

import { logger } from '../logger';
import { checkFrequency, recordSend } from './frequencyControlService';
import { CONFIG } from '../config';
import {
  FOLLOWUP_TEMPLATE_ID,
  CARE_PLAN_REMINDER_TEMPLATE_ID,
  HEALTH_CHECKIN_TEMPLATE_ID,
  TEMPLATE_IDS,
  type TemplateId,
} from '../constants/templateIds';

const SUBSCRIBE_STATUS_KEY = 'subscribe_status';

export interface SubscribeStatus {
  templateId: string;
  accepted: boolean;
  acceptedAt?: number;
  lastUsedAt?: number;
  usageCount: number;
}

export { FOLLOWUP_TEMPLATE_ID, CARE_PLAN_REMINDER_TEMPLATE_ID, HEALTH_CHECKIN_TEMPLATE_ID, TEMPLATE_IDS, type TemplateId };

export interface SubscribeMessageData {
  [key: string]: { value: string };
}

export interface TemplateConfig {
  id: string;
  name: string;
  description: string;
  requiredFields: string[];
}

export const TEMPLATE_CONFIGS: Record<string, TemplateConfig> = {
  [FOLLOWUP_TEMPLATE_ID]: {
    id: FOLLOWUP_TEMPLATE_ID,
    name: '急救跟进提醒',
    description: '急救后第二天跟进，询问用户感受',
    requiredFields: ['thing1', 'time2', 'thing3'],
  },
  [CARE_PLAN_REMINDER_TEMPLATE_ID]: {
    id: CARE_PLAN_REMINDER_TEMPLATE_ID,
    name: '护理任务提醒',
    description: '3天护理计划每日任务提醒',
    requiredFields: ['thing1', 'time2', 'thing3'],
  },
  [HEALTH_CHECKIN_TEMPLATE_ID]: {
    id: HEALTH_CHECKIN_TEMPLATE_ID,
    name: '健康打卡提醒',
    description: '定时健康记录提醒',
    requiredFields: ['thing1', 'time2', 'thing3'],
  },
};

export async function requestSubscribe(
  templateIds: string[] = [FOLLOWUP_TEMPLATE_ID]
): Promise<Record<string, boolean>> {
  const results: Record<string, boolean> = {};

  try {
    const res = await Taro.requestSubscribeMessage({
      tmplIds: templateIds,
      entityIds: [],
    });

    templateIds.forEach((id) => {
      const status = (res as Record<string, string>)[id];
      const accepted = status === 'accept';
      results[id] = accepted;

      updateSubscribeStatus(id, accepted);
    });

    return results;
  } catch {
    templateIds.forEach((id) => {
      results[id] = false;
    });
    return results;
  }
}

export async function requestFollowupSubscribe(): Promise<boolean> {
  const results = await requestSubscribe([FOLLOWUP_TEMPLATE_ID]);
  return results[FOLLOWUP_TEMPLATE_ID] ?? false;
}

export async function requestCarePlanSubscribe(): Promise<boolean> {
  const results = await requestSubscribe([CARE_PLAN_REMINDER_TEMPLATE_ID]);
  return results[CARE_PLAN_REMINDER_TEMPLATE_ID] ?? false;
}

export async function requestAllSubscribes(): Promise<Record<string, boolean>> {
  return requestSubscribe([
    FOLLOWUP_TEMPLATE_ID,
    CARE_PLAN_REMINDER_TEMPLATE_ID,
    HEALTH_CHECKIN_TEMPLATE_ID,
  ]);
}

export function updateSubscribeStatus(templateId: string, accepted: boolean): void {
  const statusList = getStorage<SubscribeStatus[]>(SUBSCRIBE_STATUS_KEY) || [];

  const existingIndex = statusList.findIndex((s) => s.templateId === templateId);
  const newStatus: SubscribeStatus = {
    templateId,
    accepted,
    acceptedAt: accepted ? Date.now() : undefined,
    usageCount: 0,
  };

  if (existingIndex >= 0) {
    const existing = statusList[existingIndex];
    newStatus.usageCount = existing.usageCount;
    if (accepted && !existing.acceptedAt) {
      newStatus.acceptedAt = Date.now();
    } else if (!accepted) {
      newStatus.acceptedAt = undefined;
    }
    statusList[existingIndex] = newStatus;
  } else {
    statusList.push(newStatus);
  }

  setStorage(SUBSCRIBE_STATUS_KEY, statusList);
}

export function getSubscribeStatus(templateId: string): SubscribeStatus | null {
  const statusList = getStorage<SubscribeStatus[]>(SUBSCRIBE_STATUS_KEY) || [];
  return statusList.find((s) => s.templateId === templateId) || null;
}

export function hasAcceptedSubscribe(templateId: string): boolean {
  const status = getSubscribeStatus(templateId);
  return status?.accepted ?? false;
}

export function getAllSubscribeStatus(): SubscribeStatus[] {
  return getStorage<SubscribeStatus[]>(SUBSCRIBE_STATUS_KEY) || [];
}

export function recordTemplateUsage(templateId: string): void {
  const statusList = getStorage<SubscribeStatus[]>(SUBSCRIBE_STATUS_KEY) || [];
  const index = statusList.findIndex((s) => s.templateId === templateId);

  if (index >= 0) {
    statusList[index].lastUsedAt = Date.now();
    statusList[index].usageCount++;
    setStorage(SUBSCRIBE_STATUS_KEY, statusList);
  }
}

export function clearSubscribeStatus(): void {
  setStorage(SUBSCRIBE_STATUS_KEY, []);
}

export async function sendSubscribeMessage(
  templateId: string,
  data: SubscribeMessageData,
  page?: string
): Promise<boolean> {
  if (!hasAcceptedSubscribe(templateId)) {
    return false;
  }

  if (templateId.includes('PLACEHOLDER')) {
    return false;
  }

  // 频率检查
  const freqCheck = checkFrequency(templateId);
  if (!freqCheck.allowed) {
    logger.warn('subscribeService', `Frequency check failed: ${freqCheck.reason}`);
    return false;
  }

  try {
    const token = storage.getToken();

    const res = await Taro.request({
      url: `${CONFIG.API_BASE_URL}/api/subscribe/send`,
      method: 'POST',
      data: { templateId, data, page },
      header: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });

    if (res.statusCode === 200) {
      recordTemplateUsage(templateId);
      recordSend(templateId, true); // 记录发送成功
      return true;
    }

    recordSend(templateId, false); // 记录发送失败
    return false;
  } catch {
    recordSend(templateId, false);
    return false;
  }
}
