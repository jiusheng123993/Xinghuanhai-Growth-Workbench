export default defineAppConfig({
  pages: [
    'pages/index/index',
    'pages/creative/index',
    'pages/pet-profile/index',
    'pages/mine/index',
    // 以下页面保留但退出 tabBar（创作板块 IA 2026-09-09：5 tab 收敛为 4 tab），
    // 仍可从创作页等入口 navigateTo 跳入，不能从 tabBar 直接进入
    'pages/timeline/index',
    'pages/family/index',
  ],
  window: {
    navigationBarBackgroundColor: '#FFF6EE',
    navigationBarTextStyle: 'black',
    navigationBarTitleText: '星河宠记',
    backgroundColor: '#FFF6EE',
    backgroundTextStyle: 'light',
  },
  tabBar: {
    color: '#B69B83',
    selectedColor: '#FF6B3D',
    backgroundColor: '#FFFFFF',
    borderStyle: 'white',
    list: [
      {
        pagePath: 'pages/index/index',
        text: '今天',
        iconPath: 'assets/icons/home.png',
        selectedIconPath: 'assets/icons/home-active.png',
      },
      {
        pagePath: 'pages/creative/index',
        text: '创作',
        iconPath: 'assets/icons/creative.png',
        selectedIconPath: 'assets/icons/creative-active.png',
      },
      {
        pagePath: 'pages/timeline/index',
        text: '时光',
        iconPath: 'assets/icons/timeline.png',
        selectedIconPath: 'assets/icons/timeline-active.png',
      },
      {
        pagePath: 'pages/pet-profile/index',
        text: '宠物',
        iconPath: 'assets/icons/pet.png',
        selectedIconPath: 'assets/icons/pet-active.png',
      },
      {
        pagePath: 'pages/mine/index',
        text: '我的',
        iconPath: 'assets/icons/mine.png',
        selectedIconPath: 'assets/icons/mine-active.png',
      },
    ],
  },
  subPackages: [
    {
      root: 'pagesPet',
      pages: [
        'add/index',
        'edit/index',
        'breed/index',
        'breed-detail/index',
        'checkin/index',
        'diary/index',
        'food-query/index',
        'symptom-check/index',
        'trends/index',
        'vaccine/index',
        'avatar-customize/index',
        'health-report/index',
        'grief/index',
        'hospital/index',
        'chronic-tracking/index',
        'feeding-advice/index',
        'naming/index',
        'family/dashboard/index',
        'family/calendar/index',
        'family/lineage/index',
        'share-card/index',
        'weekly-report/index',
        'yearly-review/index',
        'family-tree/index',
        'achievement/index',
      ],
    },
    // 回忆录 + 创作中心独立分包（2026-09-10：pagesPet 曾因超 2MB 上传失败，
    // 把 memoir/studio 挪到 pagesMemoir 独立分包，各分包 ≤2MB 满足微信限制）
    {
      root: 'pagesMemoir',
      pages: [
        'memoir-center/index',
        'memoir-daily/index',
        'memoir-vlog/index',
        'memoir-full/index',
        'studio/index',
      ],
    },
    {
      root: 'pagesUser',
      pages: [
        // 个人资料页（profile）已于 2026-09-12（IA 第 2a 批）并入 settings/index，故不再注册
        'settings/index',
        'onboarding/index',
        'agreement/index',
        'invite/index',
        'effect-tracking/index',
        'memory/index',
        'feedback/index',
        // 主包瘦身：登录页/会员中心页原在主包，迁入分包后主包体积降至 1.5M 以下（微信上传代码质量要求）
        'member/index',
        'login/index',
        // 登录后引导绑定微信头像昵称页（chooseAvatar + nickname 官方能力）
        'bind-wechat/index',
      ],
    },
  ],
  // 分包预下载：WiFi 环境进入首页后空闲预拉分包，缩短首次进入分包页的路由耗时
  // （连点触发 routeDone 竞态的根因级缓解；选 wifi 不消耗用户蜂窝流量）。
  // ⚠️ 微信硬限制：单条 preloadRule 预载包合计 ≤ 2MB（上传校验报错码 80058）。
  // 【2026-09-11 更新实测】分包瘦身（主题变量 CSS / @keyframes 收敛到全局，见
  // src/styles/_theme.scss 顶部说明）后 dist 体积：pagesPet 1557KB + pagesUser 593KB，
  // 合计 2150KB 仍 > 2MB，所以本规则**继续只保留 pagesUser**，pagesPet 不要加回来。
  // 注：微信按"IDE 编译后的源码体积"判定（实测比 dist 磁盘体积多约 100KB，
  // 来自 IDE 的 ES5 转译），所以按磁盘体积必须留出余量，别贴着 2048KB 走。
  preloadRule: {
    'pages/index/index': { network: 'wifi', packages: ['pagesUser'] },
  },
  // 开启"组件按需注入"：微信代码质量检查要求主包启用 lazyCodeLoading，
  // 否则上传时该项"未通过"。开启后页面组件按需加载，也能顺带减小首包体积。
  lazyCodeLoading: 'requiredComponents',
  // 微信同声传译插件（2026-09 语音输入改版）：按住说话由插件在微信侧直接转文字，
  // 不经过业务服务器、不需要云 ASR 密钥、不按量计费。
  // 需在微信公众平台「设置 > 第三方设置 > 插件管理」添加同声传译插件（provider wx069ba97219f66d99）。
  plugins: {
    WechatSI: {
      version: '0.3.5',
      provider: 'wx069ba97219f66d99',
    },
  },
  __usePrivacyCheck__: true,
})
