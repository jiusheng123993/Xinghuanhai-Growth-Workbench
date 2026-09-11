/**
 * 回忆录三档纯函数层（B2 前端镜像 B1 后端契约）
 *
 * 后端唯一事实源：server/src/config.ts MEMOIR_TIER_CONFIG / MEMOIR_TIER_PRICES。
 * 前端这份边界表只用于「交互期提示」（选照片时的档位满足判定、确认页可选档置灰），
 * 最终校验以后端 schema superRefine 为准（2026-09-09 契约变更说明 §六.2）。
 * 边界值改动必须两端同步（后端改动时此文件测试会红，防止静默漂移）。
 */

/** 回忆录档位（与后端 tier 枚举一致；旧语义 member/free 是会员身份，不是档位） */
export type MemoirTier = 'light' | 'standard' | 'full'

/** 档位照片/时长边界（镜像后端 MEMOIR_TIER_CONFIG） */
export interface TierBounds {
  minPhotos: number
  maxPhotos: number
  minDuration: number
  maxDuration: number
  defaultDuration: number
}

/** 三档边界（镜像后端 MEMOIR_TIER_CONFIG，2026-09-09 定稿） */
export const MEMOIR_TIER_BOUNDS: Record<MemoirTier, TierBounds> = {
  light: { minPhotos: 1, maxPhotos: 3, minDuration: 5, maxDuration: 30, defaultDuration: 20 },
  standard: { minPhotos: 5, maxPhotos: 7, minDuration: 40, maxDuration: 50, defaultDuration: 45 },
  full: { minPhotos: 8, maxPhotos: 15, minDuration: 60, maxDuration: 90, defaultDuration: 75 },
}

/** 三档价格表（单位：分；镜像后端 MEMOIR_TIER_PRICES，membership 端点同款形状） */
export type MemoirPrices = Record<MemoirTier, { member: number; free: number }>

/** 档位展示元信息（纯展示，不参与校验） */
export const TIER_META: Record<MemoirTier, { name: string; desc: string; emoji: string }> = {
  light: { name: '轻纪念', desc: '1-3 张照片 · 约20秒 · 轻量单段', emoji: '🌱' },
  standard: { name: '标准回忆录', desc: '5-7 张照片 · 约45秒 · 多段叙事', emoji: '📖' },
  full: { name: '完整回忆录', desc: '8-15 张照片 · 约75秒 · 完整章节', emoji: '🏆' },
}

/** 档位顺序（确认页三档卡从轻到重展示） */
export const MEMOIR_TIER_ORDER: MemoirTier[] = ['light', 'standard', 'full']

/**
 * 判定某档位在当前照片数下是否可选（边界外不可选）
 * @param tier - 档位
 * @param photoCount - 已选照片数
 */
export function isTierAvailable(tier: MemoirTier, photoCount: number): boolean {
  const b = MEMOIR_TIER_BOUNDS[tier]
  return photoCount >= b.minPhotos && photoCount <= b.maxPhotos
}

/**
 * 当前照片数下全部可选档位（按从轻到重排序）
 * @param photoCount - 已选照片数
 */
export function availableTiers(photoCount: number): MemoirTier[] {
  return MEMOIR_TIER_ORDER.filter((t) => isTierAvailable(t, photoCount))
}

/**
 * 当前照片数对应的「默认推荐档」：可用档里最重的一档（素材越多越值），无可用档返回 null
 * 与后端 material-check 的 suggested_tier 语义不同——后者基于库内素材总量给「去补素材」建议，
 * 这里基于「用户实际已选照片」给默认选中档。
 * @param photoCount - 已选照片数
 */
export function recommendTier(photoCount: number): MemoirTier | null {
  const tiers = availableTiers(photoCount)
  return tiers.length > 0 ? tiers[tiers.length - 1] : null
}

/**
 * 从价格表取某档展示价（分）
 * @param prices - 三档价格表（membership 端点返回，缺档容错返回 0 由调用方兜底）
 * @param tier - 档位
 * @param isMember - 是否会员（true 取 member 价，false 取 free 价）
 */
export function pickTierPrice(prices: MemoirPrices | null | undefined, tier: MemoirTier, isMember: boolean): number {
  const entry = prices?.[tier]
  if (!entry) return 0
  return isMember ? entry.member : entry.free
}

/**
 * 分转元展示文本（1890 → "18.9"，整数不带小数点）
 * @param fen - 金额（分）
 */
export function formatYuan(fen: number): string {
  const yuan = fen / 100
  return Number.isInteger(yuan) ? String(yuan) : yuan.toFixed(1)
}

/**
 * 档位不可选的原因文案（确认页置灰卡说明）
 * @param tier - 档位
 * @param photoCount - 已选照片数
 */
export function tierUnavailableReason(tier: MemoirTier, photoCount: number): string {
  const b = MEMOIR_TIER_BOUNDS[tier]
  if (photoCount < b.minPhotos) return `需至少 ${b.minPhotos} 张照片`
  return `最多 ${b.maxPhotos} 张照片`
}

/**
 * 由页面路由名推导「该路由的默认档位」（2026-09-12 起只作兜底默认值，不再单独决定页面档位）
 *
 * 背景（2026-09-11 修复存量 P0）：
 * `memoir-vlog`（标准档）与 `memoir-full`（完整档）原本是两份**逐字节完全相同**的实现，
 * 复制时把 standard 的照片边界（5-7）一起复制了过去，于是完整档页面的选照片上限被死锁在 7 张，
 * `isTierAvailable('full', n≤7)` 恒为 false —— **最贵的完整档（8-15 张）在任何入口都选不出来**。
 * 同期该页 toast 还写着"最多选择15张照片"，文案与逻辑自相矛盾，反证原意就是支持 15 张。
 *
 * 修复口径：**档位边界一律从 MEMOIR_TIER_BOUNDS 派生**，禁止再在页面里硬编码某个档位的边界
 * （这是防止同一 bug 被再次复制出来的关键）。
 *
 * 2026-09-12（IA 第 2d 批）：`memoir-vlog` 那条 28 行再导出壳路由已删除。在此之前 standard 吃的是
 * 「别的路由一律兜底 standard」这条分支（它自己连名字都没有），所以本函数**已经不能**再被当作
 * 档位的唯一来源 —— standard 现在由显式 `?tier=standard` 承载，判定顺序见 resolveMemoirTier。
 *
 * @param routePath - 当前页面路由（`Taro.getCurrentInstance().router?.path`）
 * @returns 该路由的默认档位；未知或缺失路由按 `standard` 兜底（对旧链接最保守）
 */
export function tierFromRoutePath(routePath?: string): MemoirTier {
  if (routePath?.includes('memoir-full')) return 'full'
  if (routePath?.includes('memoir-daily')) return 'light'
  return 'standard'
}

/**
 * 解析「多段纪念管线」页（`pagesMemoir/memoir-full/index.tsx` 这份 standard/full 唯一实现）
 * 本次应该服务哪个档位。
 *
 * 为什么要有这个函数（2026-09-12 IA 第 2d 批）：
 * standard（5-7 张）与 full（8-15 张）共用同一份实现，分档原来靠“进页时用的是哪条路由名”隐含决定
 * —— standard 甚至连名字都没有，纯粹吃 tierFromRoutePath 的兜底分支。删掉 memoir-vlog 壳路由后，
 * 回忆录馆的「标准回忆录」卡只能改指 memoir-full，而 memoir-full 会按路由名把自己判成 full，
 * standard 的照片上下限就会静默从 5-7 变成 8-15，这正是 2026-09-11 修过的「完整档选不出来」P0
 * 的镜像 bug。更要命的是：因为兜底分支照旧返回 standard，**原来的单元测试仍会全绿**，
 * 只有真机点「标准回忆录」卡才会暴露 —— 所以分档必须改成显式入参，
 * 彻底去掉“某个页面/路由是否存在”这类隐式依赖。
 *
 * 判定顺序（显式入参优先）：
 *   1. 显式 `?tier=standard|full` —— 回忆录馆三档卡直达的唯一依据（用户选哪档就是哪档）；
 *   2. 路由名兜底 —— `memoir-full` → full、`memoir-daily` → light、其余 → standard，
 *      与删除 memoir-vlog 之前保持一致（老链接/裸进页不会被误升档）。
 *
 * @param routePath - 当前页面路由（`Taro.getCurrentInstance().router?.path`）
 * @param tierParam - 路由 query 里的 `tier` 参数（`Taro.getCurrentInstance().router?.params?.tier`）
 * @returns 本页应服务的档位；light 有独立页面 memoir-daily、不由本页承载，
 *          因此脏参数（空串、light、拼错的值）一律忽略并走路由兜底，避免档位边界与管线不符
 */
export function resolveMemoirTier(routePath?: string, tierParam?: string): MemoirTier {
  if (tierParam === 'standard' || tierParam === 'full') return tierParam
  return tierFromRoutePath(routePath)
}
