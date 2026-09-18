/**
 * 全局路由防抖守卫 —— 修复「routeDone with a webviewId N is not found」
 *
 * 报错机制：上一次页面路由尚未完成时又发起新路由，微信基础库随后收到前一
 * webview 的 routeDone 消息时，该 webview 已被销毁/替换，找不到对应实例即报
 * 此错（框架级路由竞态）。典型触发：分包页（pagesPet / pagesUser）首次进入
 * 需下载分包、路由耗时长，用户以为没点上而快速连点 → 两次 navigateTo 并发。
 *
 * 方案：启动时包装（monkey-patch）Taro.navigateTo / Taro.redirectTo，加全局
 * 冷却锁——路由进行中（原 API 未 settle）的重复调用静默忽略；settle 后再留
 * 300ms 收尾冷却，覆盖基础库 routeDone 消息迟到的情况。
 *
 * 为什么不用 Taro.addInterceptor：实测本项目 Taro 3.6.0 的 addInterceptor 被
 * 绑定在 request 专用的 Link 拦截链上（@tarojs/shared native-apis.js:
 * equipCommonApis），只对 Taro.request 生效，拦不到路由 API。
 *
 * 安全性论证：
 * - 小程序构建下 @tarojs/taro 为 CommonJS 单例（module.exports = taro），
 *   全项目所有 `import Taro from '@tarojs/taro'` 拿到同一对象引用，运行期
 *   成员访问调用，替换属性即全局生效；
 * - 全项目 navigateTo/redirectTo 调用均为「发完即忘」，唯一带失败降级链的
 *   safeNavigateBack 用的是 switchTab/reLaunch/navigateBack（不在补丁范围），
 *   因此静默吞掉重复导航无副作用；
 * - 微信框架自身的页面切换（tab 切换、系统返回）不经 Taro.navigateTo，
 *   补丁不影响框架行为；switchTab/reLaunch/navigateBack 有登录守卫与降级链
 *   依赖（authGuard.redirectToLoginIfNeeded / safeNavigateBack），刻意不碰。
 *
 * ⚠️ 已知残余风险边界（显式记录）：
 * - 分包（pagesPet / pagesUser）首次进入需现场下载分包，下载耗时通常远超
 *   主包路由——本次对分包目标使用独立长占位窗（SUBPACK_PENDING_HOLD_MS=8s）
 *   覆盖下载窗口，连点竞态在分包场景被完整拦截；仅当极慢网络下首载超过 8s
 *   锁才先行过期（此时的二次点击仍可与第一次并发），该窄残留由
 *   app.config.ts 的 preloadRule（WiFi 预下载 pagesPet/pagesUser 分包）
 *   从根因侧收敛；
 * - 双击返回键触发的 navigateBack 连发、登录守卫 reLaunch 与用户导航并发
 *   不在本守卫防护范围内（二者均有各自的上游防重复逻辑兜底）。
 */
import Taro from '@tarojs/taro'
// 分包名单的唯一真相源（含与 app.config.ts 对齐的单测）—— 别在这里再硬编码前缀
import { isSubPackageUrl } from '../constants/subPackages'

/** 主包路由的占位保护窗：原 API 迟迟不 settle 时的最长锁定期（防锁死） */
const PENDING_HOLD_MS = 1500

/** 分包路由的占位保护窗：覆盖分包首载下载（1.9MB 分包在普通网络下可达数秒） */
const SUBPACK_PENDING_HOLD_MS = 8000

/**
 * 判断导航目标是否位于分包
 * 分包首载需下载，路由窗口远长于主包，必须用长占位窗防连点
 *
 * 【2026-09-12 修正】名单原本硬编码成 `pagesPet / pagesUser` 两个前缀 —— 于是
 * `pagesMemoir` 一直漏在保护之外，新增的 `pagesYuantuan`（团团全屏页）也会漏。
 * 现改为统一读 `constants/subPackages.ts` 的 `SUB_PACKAGE_ROOTS`（唯一真相源，
 * 且有单测与 `app.config.ts` 的 subPackages 对齐，漏加会红）。
 *
 * @param url 导航目标完整路径（如 /pagesPet/avatar-customize/index）
 */
function isSubpackUrl(url?: string): boolean {
  return isSubPackageUrl(url)
}

/** 路由 settle 后的收尾冷却：等待基础库 routeDone 消息处理完再放行下一次导航 */
const SETTLE_BUFFER_MS = 300

/** 冷却截止时间戳（ms）；0 表示当前无锁 */
let lockUntil = 0

/** 防重复安装标记（app 入口可能因热更新等多次执行顶层代码） */
let installed = false

/**
 * 尝试获取路由执行权
 * @param url 导航目标路径（用于判别分包目标选择长占位窗）
 * @returns 本次导航的占位窗截止时间戳；null=冷却中被拦截（调用方应静默跳过）
 */
function acquireRouteLock(url?: string): number | null {
  const now = Date.now()
  // 分包目标用长占位窗（覆盖分包首载下载），主包保持短窗（快速连点手感不拖慢）
  const holdMs = isSubpackUrl(url) ? SUBPACK_PENDING_HOLD_MS : PENDING_HOLD_MS
  if (now < lockUntil) {
    // 墙钟回拨防护：若冷却剩余远超「本次占位窗 + 收尾冷却」理论上限，说明系统
    // 时钟被回拨（手动改时间/NTP 校准），继续拦截会让所有导航静默失效数小时且
    // 无自愈，故强制作废旧锁重新上锁；正常场景剩余 ≤ 本次占位窗，不受影响
    if (lockUntil - now > holdMs + SETTLE_BUFFER_MS) {
      console.warn('[routeGuard] 检测到异常时钟状态（疑似系统回拨），已重置路由冷却锁')
    } else {
      return null
    }
  }
  // 先按「进行中占位窗」上锁：即使原 API 同步抛错/永不回调，锁也会自动过期，
  // 不会出现一次异常导致后续所有导航被永久吞掉的死锁
  const expiry = now + holdMs
  lockUntil = expiry
  return expiry
}

/**
 * 安装全局路由防抖守卫（应用入口装载一次）
 * 仅包装 navigateTo / redirectTo；冷却截止时间戳见模块顶部常量说明。
 */
export function installRouteGuard(): void {
  if (installed) return
  installed = true

  /**
   * 包装单个路由 API：保留原函数的 Promise 返回与 success/fail/complete
   * 回调语义（原样透传 options 与返回值），仅在其外层叠加冷却锁。
   */
  const wrapNav = <T extends (options: never) => Promise<unknown>>(apiName: string, original: T): T => {
    const wrapped = (options: Parameters<T>[0]): ReturnType<T> => {
      // 读取导航目标 URL 判别是否分包（分包目标走长占位窗防连点竞态）
      const targetUrl = (options as { url?: string } | undefined)?.url
      const myHoldExpiry = acquireRouteLock(targetUrl)
      if (myHoldExpiry === null) {
        console.warn(`[routeGuard] 上一次路由未完成，已忽略本次重复${apiName}`)
        // 以成功形态收尾（与微信 ok 响应形状一致）；被吞的是「冗余重复导航」，
        // 不触发原 options 回调，避免调用方误以为页面真的打开了两次
        return Promise.resolve({ errMsg: `${apiName}:ok` }) as ReturnType<T>
      }
      const result = original(options)
      // 独立监听链释放锁：不污染返回给调用方的 result；
      // catch 兜底防止「路由失败」在监听链上产生 unhandled rejection
      Promise.resolve(result)
        .catch(() => {})
        .finally(() => {
          // 仅当锁仍属于「本次导航的占位窗」时才收紧为短冷却：
          // 若本次路由迟迟未 settle、占位窗已过期且更晚的导航已重新上锁，
          // 此处不得砍短对方（更晚导航）的保护窗——宁长勿短防竞态复发；
          // 正常快速完成的路由仍立即收紧，不多占用户的下一次点击响应时间
          if (lockUntil <= myHoldExpiry) {
            lockUntil = Date.now() + SETTLE_BUFFER_MS
          }
        })
      // 原样透传原 API 的 Promise（含 success/fail/complete 回调语义）
      return result as ReturnType<T>
    }
    return wrapped as unknown as T
  }

  // 逐个替换 Taro 单例上的方法（bind 保证原函数 this 指向 Taro 自身）
  const navNames = ['navigateTo', 'redirectTo'] as const
  for (const name of navNames) {
    const original = (Taro as unknown as Record<string, ((options: never) => Promise<unknown>) | undefined>)[name]
    if (typeof original !== 'function') continue
    ;(Taro as unknown as Record<string, unknown>)[name] = wrapNav(name, original.bind(Taro))
  }
}

/** 仅供测试：重置守卫内部状态 */
export function resetRouteGuardLock(): void {
  lockUntil = 0
}
