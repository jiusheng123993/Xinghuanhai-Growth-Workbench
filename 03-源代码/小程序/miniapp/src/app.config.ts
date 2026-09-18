export default defineAppConfig({
  pages: [
    'pages/index/index',
    // 2026-09-12（IA 第 3 批 · 自定义 tabBar）：从 5 tab 收敛为「4 tab + 中心 AI 按钮」，
    // 「宠物」退出 tabBar —— pages/pet-profile/index 仍是**已注册的普通页面**，只是不在 tabBar.list 里。
    // ⚠️ 退出 tabBar 后宠物档案的入口（2026-09-12 第 4 批后共 4 处；本波「成就墙独立页下线」
    //   删掉了原 ③，故现为 3 处 —— 全部必须用 navigateTo）：
    //   ⚠️ 微信只允许 `switchTab` 打开 tabBar.list 里的页面；对已退出 tabBar 的页面调它会
    //   **静默失败**（不抛错、不报错，用户点了毫无反应）——所以下面每一处都得是 navigateTo。
    //   ① src/pages/mine/index.tsx ——「我的宠物」组的「宠物档案」菜单项（无条件常驻，主要入口；
    //      2026-09-12 第 5 批按 v2 重排分组后，它从「数据服务」组挪到了「我的宠物」组）
    //   ② src/pages/family/index.tsx —— 家庭页宠物卡（handlePetClick）
    //   ③ src/pages/index/index.tsx ——「今天」页：健康摘要右上「健康档案 ›」+ 点摘要卡本体
    //      （IA 第 4 批定的口径：健康数据的唯一归处是宠物档案，所以今天页只做直达、不重复展示）
    //   原 ③ 是 src/pagesPet/achievement/index.tsx 的成就墙空态按钮，该页已随本波
    //   「成就墙降为时光页分区」下线（页面文件与注册项都已删除），所以不在这里列了。
    // 注：早期注释写过「首页没有宠物档案入口」（当时属实），第 4 批重做今天页后已被推翻。
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
    // 【2026-09-12 默认主题改为春季（stores/themeStore.ts 的 DEFAULT_THEME = 'spring'）】
    // 下面两个是**微信原生窗口色**：在 JS 接管（themeStore.applyNativeBars → setNavigationBarColor）
    // 之前，冷启动首帧用它，所以必须跟应用层默认主题对齐。原值 '#FFF6EE' 是**秋季**的 navbarBg，
    // 新用户会先看到一块奶油橙、再被运行时改成春季色 = 一次可见的闪色。
    // 取值 = themeStore.ts 里 spring 元数据的 navbarBg（已核对实际值为 '#F3FAEF'）。
    navigationBarBackgroundColor: '#F3FAEF',
    // 春季 navbarFrontColor = '#000000' → 'black'，与改前一致，本次无需改动（已核查）。
    navigationBarTextStyle: 'black',
    navigationBarTitleText: '星河宠记',
    // 下拉露出的窗口底色，与窗口色保持一致，免得导航栏与露出区两块颜色割裂
    backgroundColor: '#F3FAEF',
    // ⚠️ 遗留项（本包只报告不改）：'light' 表示下拉 loading 的点用浅色，在 #F3FAEF 这种近白底上
    // 几乎看不见；但它在 '#FFF6EE' 时代就已是这个值，属既存状态，不在本次收尾范围内。
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
        'anniversary/index',
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
        'hospital/index',
        'chronic-tracking/index',
        'feeding-advice/index',
        'naming/index',
        // 家庭看板页（family/dashboard）已于 2026-09-12（IA 第 3 批）整页并入 pages/family/index：
        // 宠物角色/加入移出家庭/全家福生成/全家福相册搬进家庭页，故此路由不再注册。
        'family/calendar/index',
        'family/lineage/index',
        'share-card/index',
        'weekly-report/index',
        'yearly-review/index',
        // 家族树页（family-tree）已于 2026-09-12（IA 第 3 批·收口）下线：
        // 它与 family/lineage 导航标题逐字相同（都叫「家族图谱」），而它独有的「家庭成员（人）
        // 关系管理」（8 种关系，familyStore.fetchRelations/createRelation/removeRelation）已搬进
        // pages/family/index 的「共同养宠 → 设置关系」，能力无遗失，故此路由不再注册。
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
    // 「团团」全屏态（IA 第 4 批，2026-09-12）：AI 对话从首页整体搬到这里，成为全站 AI 能力的
    // **唯一入口**（首页转向「今天要做什么」的看板，不再承载对话）。
    // 单开一个分包的两条理由：① 别把 AI 对话那一套（useChatCore / 语音输入 / 四个弹层）压进主包；
    // ② 它由底部导航中心圆钮 navigateTo 打开，不需要在首屏就加载。
    // ⚠️ 它是**普通页面**（不是 tabBar 页），跳转一律用 navigateTo —— switchTab 会静默失败。
    {
      root: 'pagesYuantuan',
      pages: ['agent/index'],
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
  // 【2026-09-12 更新】新增 `pagesYuantuan`（团团全屏页）后按微信 IDE 口径实测：
  // pagesUser 565.3KB + pagesYuantuan 428.2KB = 993.5KB ≤ 2MB ✓，所以把团团也加进预拉，
  // 让首次点底部中心圆钮不用现场等分包下载（它是全站最容易被连点的入口）。
  // pagesPet 仍不加：pagesPet 单包 1.7MB + pagesUser 已超 2MB（见上一段实测）。
  preloadRule: {
    'pages/index/index': { network: 'wifi', packages: ['pagesUser', 'pagesYuantuan'] },
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
