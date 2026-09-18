/**
 * 分包 root 列表（唯一真相源）
 *
 * 【为什么单独抽一个文件】分包页面首载要**现场下载分包**，路由窗口远长于主包页面。
 * `utils/routeGuard.ts` 用这份名单判断"要不要给这次导航开长占位窗（8s）来防连点竞态"，
 * 一旦名单漏了某个分包，那个分包页就**完全没有保护** —— 本项目 2026-09-01 的
 * 「形象定制」页正是这么中的（报错 `routeDone with a webviewId 9 is not found`）。
 *
 * ⚠️ **新增分包时必须同步这里**，否则 `constants/__tests__/subPackages.test.ts` 会红
 * （它直接读 `app.config.ts` 的 `subPackages[].root` 逐项比对）。
 * 2026-09-12：新增 `pagesYuantuan`（团团全屏页）时，发现旧实现只硬编码了
 * `pagesPet / pagesUser` 两个前缀 —— `pagesMemoir` 从一开始就漏在外面，一并补上。
 */
export const SUB_PACKAGE_ROOTS = ['pagesPet', 'pagesMemoir', 'pagesUser', 'pagesYuantuan'] as const

/**
 * 判断一个导航目标是否位于分包
 *
 * @param url 导航目标（形如 `/pagesPet/avatar-customize/index`；也接受不带前导斜杠的写法）
 * @returns 位于任一分包 root 下时为 true
 */
export function isSubPackageUrl(url?: string): boolean {
  if (!url) return false
  const normalized = url.startsWith('/') ? url : `/${url}`
  return SUB_PACKAGE_ROOTS.some(root => normalized.startsWith(`/${root}/`))
}
