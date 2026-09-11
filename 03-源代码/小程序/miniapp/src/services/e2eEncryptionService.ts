/**
 * 端到端加密服务
 *
 * 健康数据的加密同步/解密、字段级加密工具，确保用户数据隐私
 */
import Taro from '@tarojs/taro'
import { encrypt, decrypt } from '../utils/crypto'
import type { PetHealthEntry } from '../memory-body/types/memoryBodyTypes'

export interface EncryptedData<T> {
  encrypted: string
  iv: string
  userId: string
  timestamp: number
}

export interface SyncPayload {
  entries: string
  lastSyncAt: string
  deviceId: string
}

export interface DecryptedSyncPayload {
  entries: PetHealthEntry[]
  lastSyncAt: string
  deviceId: string
}

const SYNC_VERSION = 'v1'
const STORAGE_KEY_DEVICE_ID = 'xhh_device_id'

function getDeviceId(): string {
  const stored = Taro.getStorageSync(STORAGE_KEY_DEVICE_ID)
  if (stored) return stored
  const newId = `device_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
  Taro.setStorageSync(STORAGE_KEY_DEVICE_ID, newId)
  return newId
}

export function encryptSyncPayload(
  entries: PetHealthEntry[],
  userId: string
): EncryptedData<SyncPayload> {
  const payload: SyncPayload = {
    entries: JSON.stringify(entries),
    lastSyncAt: new Date().toISOString(),
    deviceId: getDeviceId(),
  }

  const dataToEncrypt = JSON.stringify({
    version: SYNC_VERSION,
    payload,
  })

  const encrypted = encrypt(dataToEncrypt, userId)

  return {
    encrypted,
    iv: '',
    userId,
    timestamp: Date.now(),
  }
}

export function decryptSyncPayload(
  encryptedData: EncryptedData<SyncPayload>,
  userId: string
): DecryptedSyncPayload | null {
  try {
    if (encryptedData.userId !== userId) {
      return null
    }

    const decrypted = decrypt(encryptedData.encrypted, userId)
    if (!decrypted) {
      return null
    }

    const parsed = JSON.parse(decrypted)
    if (parsed.version !== SYNC_VERSION) {
      return null
    }

    const payload = parsed.payload as SyncPayload
    return {
      entries: JSON.parse(payload.entries) as PetHealthEntry[],
      lastSyncAt: payload.lastSyncAt,
      deviceId: payload.deviceId,
    }
  } catch {
    return null
  }
}

export function encryptPetHealthData(
  data: Record<string, unknown>,
  userId: string
): string {
  const payload = JSON.stringify({
    version: SYNC_VERSION,
    data,
  })
  return encrypt(payload, userId)
}

export function decryptPetHealthData(
  encrypted: string,
  userId: string
): Record<string, unknown> | null {
  try {
    const decrypted = decrypt(encrypted, userId)
    if (!decrypted) return null

    const parsed = JSON.parse(decrypted)
    if (parsed.version !== SYNC_VERSION) return null

    return parsed.data as Record<string, unknown>
  } catch {
    return null
  }
}

export function encryptField(value: string, userId: string): string {
  return encrypt(value, userId)
}

export function decryptField(encrypted: string, userId: string): string {
  return decrypt(encrypted, userId)
}

export function isEncrypted(data: unknown): data is EncryptedData<unknown> {
  if (typeof data !== 'object' || data === null) return false
  const d = data as Record<string, unknown>
  return typeof d.encrypted === 'string' && typeof d.userId === 'string'
}
