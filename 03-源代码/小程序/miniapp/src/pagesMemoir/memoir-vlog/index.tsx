/**
 * 标准回忆录页面（回忆录馆「标准」档入口）
 *
 * 背景（2026-09-11）：
 * 本页与 `pagesMemoir/memoir-full/index.tsx` 原本是**逐字节完全相同**的两份实现
 * （各 1863 行 TSX + 1166 行 SCSS，MD5 一致），任何修复都要改两遍，是典型的"复制即分叉"隐患。
 *
 * ⚠️ **共用实现的前提是"按路由分档"，别删掉那段路由分支**：
 * `memoir-full/index.tsx` 内部用 `tierFromRoutePath(Taro.getCurrentInstance().router?.path)`
 * 推导本页服务的档位，再由 `MEMOIR_TIER_BOUNDS[pageTier]` 决定照片上下限与文案。
 * 这段分支是"完整档 8-15 张可达"的唯一依据——历史事故正是两页复制时把 standard 边界
 * 一起复制了过去，导致最贵的完整档永远选不出来（2026-09-11 修复）。
 * 它由 `src/utils/__tests__/memoirTier.test.ts` 的回归锁守护，删了会红。
 *
 * 两页的真实差异只有页面标题（各自 `index.config.ts`）；路由上的 `?tier=` 参数只是档位预选提示。
 *
 * 现在的分工：
 * - 实现唯一事实源：`memoir-full/index.tsx`
 * - 本页只保留路由入口；页面标题仍走自己的 `index.config.ts`（「标准回忆录」与完整档不同）
 * - 样式：这里必须保留 `./index.scss` 的 import——Taro 按页面模块图生成 wxss，
 *   若本页不 import 样式，该页会完全没有样式；`index.scss` 内部再 `@import` 完整档样式同源
 *
 * 若将来「标准」与「完整」两档业务逻辑真要分叉，应改为"抽公共组件 + 各页传 props"，
 * 而不是再复制一份实现。
 */
import './index.scss'

export { default } from '../memoir-full/index'
