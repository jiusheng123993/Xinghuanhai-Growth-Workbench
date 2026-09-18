/**
 * 新手引导闸门（唯一的"标记 key + 首次进入判定 + 登录后出口"）
 *
 * 【为什么要有这个文件】新手引导页 `pagesUser/onboarding/index` 重做完成后，
 * 全仓**没有任何导航指向它** —— 登录成功 / 绑定微信资料成功后都是直接
 * `reLaunch('/pages/index/index')`，只有开发者工具直连路由才能看到那三屏。
 * 于是「登录 → 引导 → 首页」这条链事实上不存在。
 *
 * 更麻烦的是"标记 key"原本有两个潜在真相源：引导页自己写 `onboarding_completed`
 * （完成/跳过都写），而后续任何新的跳转点若再各自写一遍字面量，
 * 一旦有人改 key 就会出现"引导记了、判定读不到 → 老用户被反复引导"这类隐蔽 bug。
 * 所以本文件收敛三件事：
 *   ① `ONBOARDING_DONE_KEY`：全仓唯一 key 来源（引导页也改成 import 它）；
 *   ② `hasCompletedOnboarding()`：首次进入判定（读）；
 *   ③ `goAfterAuthEntry()`：登录 / 绑定资料完成后的**唯一出口**（写判定 + 分流路由）。
 *
 * 【为什么用裸 Taro 存储而不是 utils/storage】
 * `utils/storage` 的读写 key 会被 `setStorageUserId` 加上 userId 前缀，而
 * 登录页/引导页的读写时机与 `_currentUserId` 的赋值时机并不同步（登录刚成功那一瞬
 * 前缀可能还没落上），会出现"写进去的和读出来的不是同一个 key"。
 * `pagesUser/bind-wechat` 的跳过标记当初也踩过同一个坑并改用裸 Taro 存储，
 * 这里沿用同一口径：**裸 key、不做账号隔离**（引导是"这台设备上的新用户吗"，
 * 换账号重新登录时保留"已看过引导"是合理且更省事的语义）。
 */
import Taro from '@tarojs/taro'

/**
 * 「已完成新手引导」标记的存储 key —— **全仓唯一真相源**
 *
 * 沿用旧实现的字面量，不换 key：老用户设备上已经有这个标记，
 * 换 key 会让所有老用户被重新引导一遍（2026-09-12 重做时明确保留的约束）。
 */
export const ONBOARDING_DONE_KEY = 'onboarding_completed'

/** 未完成引导时的落点：pagesUser 分包的新手引导页（三屏单页流程） */
export const ONBOARDING_URL = '/pagesUser/onboarding/index'

/** 已完成引导（以及所有老用户路径）的落点：首页 tab */
export const HOME_URL = '/pages/index/index'

/**
 * 是否已完成过新手引导
 *
 * 【为什么整段 try/catch】storage 在各端行为不同：小程序端读写同步但可能抛
 * （存储配额满、用户清理、基础库异常），H5/App 端底层实现也不同。
 * 判定函数绝不能因为读存储异常就把整个登录流程打断 ——
 * 异常时保守返回 false 的错误代价只是"多看一次引导"，而抛出去的错误代价是"登不进去"。
 *
 * @returns true = 已看过引导（不再引导）；false = 没看过，或读取异常（保守引导）
 */
export function hasCompletedOnboarding(): boolean {
  try {
    // 引导页写入的是字符串 'true'；个别端拿到的可能是布尔 true，两种都认。
    // 另外把 '1' 也算上：防止将来有人用其他写法写入而判定失灵。
    const raw = Taro.getStorageSync(ONBOARDING_DONE_KEY)
    return raw === 'true' || raw === true || raw === '1'
  } catch {
    return false
  }
}

/**
 * 记录"引导已完成"（完成与跳过都要调用）
 *
 * 【为什么完成和跳过都算完成】跳过 = 用户主动选择不看，下次登录再弹一遍是骚扰；
 * 想看的人有「我的 → 设置 → 新手指引」这条常驻回看入口（本批同时补上）。
 *
 * 【为什么 try/catch 吞掉异常】写标记失败不该让用户卡在引导页：
 * 引导页的完成动作紧接着要跳「添加宠物」，标记写不进去只是下次可能多看一遍，
 * 而抛异常会直接中断导航。
 */
export function markOnboardingCompleted(): void {
  try {
    Taro.setStorageSync(ONBOARDING_DONE_KEY, 'true')
  } catch {
    // 写失败无补救手段（本地存储），静默降级：引导流程照常往下走
  }
}

/**
 * 登录 / 绑定资料完成后的统一出口
 *
 * 分流：
 *  - **没完成引导** → `redirectTo` 到 `pagesUser/onboarding/index`（新用户这一次机会）；
 *  - **已完成引导** → 保持改动前的既有行为 `reLaunch(HOME_URL)`，
 *    老用户路径一个字节都不变（有专门的测试钉住这条）。
 *
 * 【为什么选 redirectTo 而不是 navigateTo】（规范要求给出理由，这里写全）
 *  1. 两者都在 `pagesUser` 分包内，属"分包内跳转"，不会跨分包被微信拒绝；
 *     且它们都由 `utils/routeGuard` 的全局守卫覆盖（`navigateTo`/`redirectTo`
 *     都在补丁范围内、分包目标走 8s 长占位窗），连点竞态有兜底。
 *  2. 本仓注释里记过的坑是「**reLaunch 到分包页**在 lazyCodeLoading 下偶发
 *     `routeDone with a webviewId N is not found`」—— 因为 reLaunch 会销毁整个
 *     页面栈、目标分包还要现下载，webview 实例与 routeDone 消息错位。
 *     所以这里**刻意不用 reLaunch 进引导页**（登录页当初跳 bind-wechat 选
 *     navigateTo 也是同一原因），redirectTo 只替换当前页、不重建整个栈。
 *  3. 为什么不选 navigateTo：`onboarding/index.config.ts` 是 `navigationStyle: 'custom'`
 *     （**没有左上返回键**），如果登录页留在栈里，用户在引导页用系统返回手势
 *     就会退回"已登录的登录页"—— 一个用户认知里的死胡同。redirectTo 把登录页
 *     替换掉，栈里只剩引导页，出口只有产品自己给的两个（跳过 / 添加宠物）。
 *  4. 登录后进引导只发生一次，不需要"返回登录页"这层栈。
 *
 * 【失败兜底】redirectTo 万一失败（极慢网络下分包首载、路由被守卫吞掉），
 * 绝不能把用户丢在一个已经没了登录页的空白栈里，故回退到首页（老行为）。
 * 用 `.catch` 而不是 await：调用点（登录成功、绑定保存）都是"发完即忘"的同步流程。
 */
export function goAfterAuthEntry(): void {
  if (!hasCompletedOnboarding()) {
    Taro.redirectTo({ url: ONBOARDING_URL }).catch(() => {
      Taro.reLaunch({ url: HOME_URL })
    })
    return
  }
  Taro.reLaunch({ url: HOME_URL })
}
