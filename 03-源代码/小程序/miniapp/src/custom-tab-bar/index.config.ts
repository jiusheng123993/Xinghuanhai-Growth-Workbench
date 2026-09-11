/**
 * 自定义 tabBar 的组件配置
 *
 * 【为什么是「组件配置」而不是「页面配置」】`src/custom-tab-bar/` 会被 Taro 编译成
 * `dist/custom-tab-bar/`，微信按这个固定目录名把它当成**自定义组件**注入到每个含
 * tabBar 的页面（页面 json 里自动补 usingComponents）。因此它的 json 必须是
 * `{ component: true }`；若按页面配置写（navigationBarTitleText 之类），
 * 组件注册会失败，表现是「底部导航整条不出现」。
 *
 * 【为什么用 `export default { component: true }`，而不是 defineComponentConfig】
 * 本仓库装的 Taro 是 3.6.40，`@tarojs/taro` 的类型里**只导出** `defineAppConfig`
 * 与 `definePageConfig`（见 node_modules/@tarojs/taro/types/index.d.ts:194-195），
 * 并没有 `defineComponentConfig`；直接写会 TS 报「找不到名称 defineComponentConfig」。
 * 全仓库既有那些 index.config.ts（清一色是页面）用的也是同族的
 * `definePageConfig`，组件配置没有现成样板可抄，故按 Taro 对「纯组件配置」的写法
 * 直接导出对象 —— 与页面配置一样，由 Taro 的 config 插件编译成 json。
 */
export default {
  /** 标记为自定义组件（微信侧必需；缺了它 custom-tab-bar 不会被注册） */
  component: true,
}
