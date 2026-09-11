/**
 * 设置页面配置
 *
 * 【2026-09-12 IA 第 2a 批】「个人资料」页（pagesUser 分包的 profile 页）已并入本页，
 * 而资料编辑必须用微信原生组件（chooseAvatar + nickname，Taro 3.6 编译层不支持这两个属性），
 * 故把 profile 页原来的 usingComponents 声明平移到本页；不声明则原生标签会渲染成空节点。
 * 相对路径按本页所在目录 pagesUser/settings 计算。
 */
export default definePageConfig({
  navigationBarTitleText: '设置',
  usingComponents: {
    'wechat-profile': '../../components/WechatProfile/index',
  },
})
