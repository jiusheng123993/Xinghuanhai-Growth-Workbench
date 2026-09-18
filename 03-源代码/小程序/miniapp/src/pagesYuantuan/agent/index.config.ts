/**
 * 团团（AI 全屏对话页）页面配置
 *
 * navigationBarTitleText 固定「团团」（IA 命名规范 L1 门名，见信息架构方案 §2.1）；
 * 保留原生导航栏（navigationStyle 默认）是为了自带左上角返回箭头 ——
 * 本页是 navigateTo 打开的全屏态，用户随时能退回「今天」。
 */
export default definePageConfig({
  navigationBarTitleText: '团团',
  navigationStyle: 'default',
})
