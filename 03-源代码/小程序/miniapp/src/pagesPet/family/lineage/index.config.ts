/** 血缘图谱页面配置
 *  2026-09-12：导航标题由「家族图谱」改为「血缘图谱」—— 全站口径（IA 与「我的」页入口）都叫血缘图谱；
 *  另一个同名页 pagesPet/family-tree 已下线，不会再出现"两个页面导航栏同名"的问题。 */
export default definePageConfig({
  navigationBarTitleText: '血缘图谱',
  enableShareAppMessage: true,
  enablePullDownRefresh: false,
})