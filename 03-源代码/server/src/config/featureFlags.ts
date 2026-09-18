/**
 * 功能开关（Feature Flag）配置
 * 按 TECH_DESIGN 19.2 节实现集中式配置 + 灰度百分比
 * 新功能通过功能开关控制灰度上线，稳定后移除开关
 */

/** 功能开关定义 */
interface FeatureFlag {
  /** 开关唯一标识 */
  key: string;
  /** 全局开关 */
  enabled: boolean;
  /** 灰度百分比 (0-100) */
  rolloutPercentage: number;
  /** 白名单用户 ID（不受灰度百分比限制） */
  whitelistUserIds?: string[];
  /** 过期时间，稳定后自动移除 */
  expiresAt: string;
  /** 说明 */
  description: string;
}

/** 默认功能开关配置 */
const DEFAULT_FLAGS: FeatureFlag[] = [
  {
    key: 'family_module',
    enabled: true,
    rolloutPercentage: 100,
    expiresAt: '2026-10-01',
    description: '家庭管理模块（Phase 1.5）',
  },
  {
    key: 'family_tree',
    enabled: true,
    rolloutPercentage: 100,
    expiresAt: '2026-10-01',
    description: '家族图谱模块',
  },
  {
    key: 'memoir_module',
    enabled: true,
    rolloutPercentage: 50,
    expiresAt: '2026-11-01',
    description: '宠物回忆录模块（灰度中）',
  },
  // naming_engine（取名引擎）开关已于 2026-09-10 移除：全仓零消费（无任何 isFeatureEnabled
  // 调用点），且 expiresAt 已过期——isFeatureEnabled 对过期开关直接 return true，
  // 等于永久失效的"假开关"，保留只会误导后续维护者以为取名链路有灰度控制。
  {
    key: 'share_card',
    enabled: true,
    rolloutPercentage: 100,
    expiresAt: '2026-10-01',
    description: '分享卡片模块',
  },
  {
    key: 'yearly_review',
    enabled: false,
    rolloutPercentage: 0,
    expiresAt: '2026-12-01',
    description: '年度回忆图集（未上线）',
  },
  {
    key: 'websocket_realtime',
    enabled: true,
    rolloutPercentage: 100,
    expiresAt: '2026-09-15',
    description: 'WebSocket 实时推送',
  },
  {
    key: 'membership_promo',
    enabled: true,
    rolloutPercentage: 100,
    expiresAt: '2026-10-31',
    description: '会员促销价（3.3折，上线前三个月获客，到期恢复原价）',
  },
  {
    key: 'family_photo',
    enabled: true,
    rolloutPercentage: 50,
    expiresAt: '2026-11-01',
    description: '全家福AI合成（Phase 2，灰度中）',
  },
];

/** 功能开关缓存（运行时可从数据库刷新） */
let flagCache: Map<string, FeatureFlag> = new Map(
  DEFAULT_FLAGS.map(f => [f.key, f]),
);

/** 简单字符串哈希（用于灰度百分比计算） */
function simpleHash(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

/**
 * 判断功能开关是否对指定用户启用
 * @param flagKey - 开关标识
 * @param userId - 用户 ID（可选，不传则只判断全局开关）
 * @returns 是否启用
 */
export function isFeatureEnabled(flagKey: string, userId?: string): boolean {
  const flag = flagCache.get(flagKey);
  if (!flag || !flag.enabled) return false;

  // 过期检查
  if (new Date(flag.expiresAt) < new Date()) {
    console.warn(`[FeatureFlag] 开关 ${flagKey} 已过期，请移除`);
    return true; // 过期后默认开启
  }

  // 白名单用户直接放行
  if (userId && flag.whitelistUserIds?.includes(userId)) {
    return true;
  }

  // 灰度百分比
  if (userId) {
    const hash = simpleHash(userId);
    return (hash % 100) < flag.rolloutPercentage;
  }

  // 无 userId 时只看全局开关和百分比
  return flag.rolloutPercentage === 100;
}

/**
 * 判断会员促销价是否生效（membership_promo 开关）
 * 与 isFeatureEnabled 语义相反：促销开关过期后应关闭（恢复原价），而非默认开启
 * @returns 促销价是否生效
 */
export function isMembershipPromoActive(): boolean {
  const flag = flagCache.get('membership_promo');
  if (!flag || !flag.enabled) return false;
  // 促销过期后恢复原价
  if (new Date(flag.expiresAt) < new Date()) return false;
  // 促销统一生效（不按用户灰度）
  return true;
}

/**
 * 获取所有功能开关状态（供前端 /api/config/feature-flags 接口使用）
 * @param userId - 用户 ID（用于计算灰度结果）
 * @returns 开关状态对象
 */
export function getFeatureFlags(userId?: string): Record<string, boolean> {
  const result: Record<string, boolean> = {};
  for (const flag of flagCache.values()) {
    result[flag.key] = isFeatureEnabled(flag.key, userId);
  }
  return result;
}

/**
 * 更新功能开关（管理接口使用）
 * @param flagKey - 开关标识
 * @param updates - 更新内容
 */
export function updateFeatureFlag(flagKey: string, updates: Partial<FeatureFlag>): void {
  const flag = flagCache.get(flagKey);
  if (!flag) {
    throw new Error(`功能开关 ${flagKey} 不存在`);
  }
  flagCache.set(flagKey, { ...flag, ...updates });
  console.log(`[FeatureFlag] 开关 ${flagKey} 已更新:`, updates);
}
