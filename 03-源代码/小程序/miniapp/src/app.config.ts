export default defineAppConfig({
  pages: [
    'pages/index/index',
    // 2026-09-12（IA 第 3 批 · 自定义 tabBar）：从 5 tab 收敛为「4 tab + 中心 AI 按钮」，
    // 「宠物」退出 tabBar —— pages/pet-profile/index 仍是**已注册的普通页面**，只是不在 tabBar.list 里。
    // ⚠️ 退出 tabBar 后入口收敛为 3 处（旧注释里的"首页宠物卡"入口**并不存在**：
    // 2026-09-12 实测 src/pages/index/index.tsx 全文件 `pet-profile` 零命中，别再去首页找它）：
    //   ① src/pages/mine/index.tsx ——「数据服务」组的「宠物档案」菜单项（无条件常驻，主要入口）
    //   ② src/pages/family/index.tsx —— 家庭页宠物卡（handlePetClick）
    //   ③ src/pagesPet/achievement/index.tsx —— 成就墙空态按钮
    // 三处都必须用 navigateTo：微信只允许 switchTab 打开 tabBar.list 里的页面，
    // 对已退出 tabBar 的页面调 `Taro.switchTab` 会**静默失败**（不抛错，用户点了毫无反应）。
    'pages/creative/index',
    'pages/pet-profile/index',
    'pages/mine/index',
    // 以下两个页面保留注册，但 tabBar 归属不同：
    // · pages/timeline/index —— **就是 tab 页**（在下方 tabBar.list 里，文字「时光」），
    //   只能由 `Taro.switchTab` 进入；判归属一律以 tabBar.list 为准，别看本节注释。
    // · pages/family/index —— 已退出 tabBar 的普通页面（创作板块 IA 2026-09-09：5 tab 收敛为 4 tab），
    //   用 navigateTo 进入（入口如 src/pages/mine/index.tsx 的家庭卡片）。
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
    // 自定义 tabBar：原生 tabBar 做不出「中间凸起的团团圆钮」，必须关掉原生渲染，
    // 由 src/custom-tab-bar/index.tsx 自绘（Taro 约定的组件目录，会编进主包）。
    // 代价：Taro.setTabBarStyle / setTabBarItem 等原生标签栏 API 全部失效，
    // 标签栏的底色、文字色、图标改由组件按 themeStore 的当前主题渲染。
    custom: true,
    color: '#B69B83',
    selectedColor: '#FF6B3D',
    backgroundColor: '#FFFFFF',
    borderStyle: 'white',
    // ⚠️ 顺序必须与 src/constants/tabBar.ts 的 TAB_BAR_TABS 严格一致
    // （有单测 constants/__tests__/tabBar.test.ts 钉住；中心 AI 按钮不是 tab 页，不进本 list）。
    // 自定义 tabBar 下原生图标不再渲染，这里保留 iconPath 是为了让 app.json 仍完整描述
    // 这 4 个 tab，真正的图标由组件按主题选目录（getTabBarIconDir）渲染。
    list: [
      {
        pagePath: 'pages/index/index',
        text: '今天',
        iconPath: 'assets/icons/home.png',
        selectedIconPath: 'assets/icons/home-active.png',
      },
      {
        pagePath: 'pages/timeline/index',
        text: '时光',
        iconPath: 'assets/icons/timeline.png',
        selectedIconPath: 'assets/icons/timeline-active.png',
      },
      {
        pagePath: 'pages/creative/index',
        text: '创作',
        iconPath: 'assets/icons/creative.png',
        selectedIconPath: 'assets/icons/creative-active.png',
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
        // 宠物日记页（diary）已于 2026-09-12（IA 第 2c 批）并入 pages/timeline/index：
        // 日记视图（diaryEngine 拟人日记 + 6 档心情筛选）搬进时光线，此路由不再注册。
        // diaryService / diaryEngine 是数据与引擎层，仍在被 pages/timeline 与打卡页使用，不能删。
        'food-query/index',
        'symptom-check/index',
        'trends/index',
        'vaccine/index',
        'avatar-customize/index',
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
        // 标准档入口页 memoir-vlog（28 行再导出壳，档位靠路由名隐含承载）已于 2026-09-12
        // （IA 第 2d 批）删除：standard/full 共用唯一实现 memoir-full，档位改由 ?tier= 显式指定
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
