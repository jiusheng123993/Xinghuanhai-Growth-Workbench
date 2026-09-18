/**
 * 向项目记忆 progress.md 追加本次记录
 * （用 node 写：PowerShell 处理 UTF-8 中文会乱码）
 */
const fs = require('fs')

const FILE = 'E:/星河宠记/项目记忆/progress.md'

const entry = `
2026-09-10 22:05 : [已完成·未提交] [⭐️ 星河宠记·「底部导航栏太丑」+「快捷功能宫格太丑」→ 挖出全 App 级 CSS 失效 bug（380 处）] — 用户连续反馈两处"太丑"。**表面是审美问题，实际挖出两个真 bug 和一个系统性缺陷**，价值远高于改样式本身。

**① 快捷功能宫格「丑」的真根因 = 双重失效（所以只剩干巴巴的文字）**
- **图标不可见**：全项目 **194 处** 用了 \`size='1em'\`。小程序 \`<Image>\` 的 style 会渲染成 \`width:1em;height:1em\`，微信对 image 上的 em 解析不可靠 → 图标**塌成 0 完全不可见**。写脚本 \`fix-icon-em-size.js\` 按所在类的 font-size 反推具体 px（rpx÷2，兜底 18px）逐处替换，194 → 0。
- **圆圈底色也是透明的**：\`rgba($color-primary, 0.12)\` 编译成 \`rgba(var(--primary,#FF6B3D),.12)\` —— **非法 CSS**（rgba 逗号语法只接受数值通道），整条声明被浏览器静默丢弃。实测（Edge 无头 + getComputedStyle）：\`rgba(var(--primary),.12)\` → \`rgba(0,0,0,0)\`；改用 \`rgba(var(--primary-rgb),.12)\` → \`rgba(255,107,61,0.12)\` ✅。
- 顺带修掉语义问题：食物查询原本用**放大镜**（只表达"搜索"，看不出是查食物）→ \`bowl-food\`；慢性病追踪与症状初筛**撞了同一个听诊器图标** → 慢性病改 \`heartbeat\`；卡片文案 "查一查毛孩子能不能吃"（10 字）在 3 列布局下每行只放得下 9.4 字会**换行导致 6 张卡高度不齐** → 缩短为单行。

**② 全 App 级缺陷：380 处 CSS 声明被静默丢弃（本次最重要的发现）**
- 审计 \`audit-rgba-var.js\`：同一失效写法出现 **380 次、横跨 34 个 SCSS 文件**（首页 54、慢性病追踪 32、家族谱系 32、时光 20…）→ 意味着**大量卡片的浅色底 / 边框 / 阴影 / tint 圆圈全都没渲染出来**。这是"整体看起来不够精致"的一大隐藏来源。
- 修复两步：\`add-rgb-vars.js\` 为 18 个色板变量在 **6 套主题**里补齐配套 \`--xxx-rgb\` 数值通道变量（**80 个**；深色主题 starry 的 \`--text-secondary\` 等用 \`rgba()\` 定义的，脚本同时解析 rgba 形式推出通道 \`255,255,255\`，否则深色主题会退回浅色兜底变成深棕压深蓝看不见）；\`fix-rgba-vars.js\` 重写 380 处调用点为 \`rgba(var(--xxx-rgb, R,G,B), α)\`（带 fallback 三元组，将来某主题漏定义也不会退回透明）。
- **教训固化**：\`rgba(var(--x), α)\` 是**必失效**写法，项目其实早就定义了 \`--primary-rgb\` 等 9 个配套变量（说明踩过），但调用点仍写错变量。凡 SCSS 变量定义为 \`var(--x, #hex)\`，**一律不能进 rgba() 逗号语法**。

**③ 底部导航栏「丑」= 图标颜色三重不匹配**
- 实测像素取证：**创作**图标颜色与其余 4 个都不同（未选中 \`#8080A0\` 偏紫 vs 其余 \`#8A99AA\`；选中 \`#E0A020\` vs \`#E8A838\`）；且所有图标与 tabBar **文字色冷暖冲突**（图标冷灰蓝 \`#8A99AA\` ↔ 文字暖棕褐 \`#B69B83\`；图标金黄 \`#E8A838\` ↔ 文字珊瑚橙 \`#FF6B3D\`）；**宠物是面性实心、其余是线性**，风格混搭；创作画的是"圆+3点"语义模糊。
- **最关键**：\`applyNativeBars\` 只设了 tabBar **文字色没设图标**，而文字色是**逐主题变化**的（spring \`#9BB494/#54B460\`、summer \`#8FA6B8/#2FA8E8\`、winter \`#929CBA/#6C7CF0\`、starry 白55%/\`#FFD068\`）。PNG 图标颜色烘焙在文件里，\`setTabBarStyle\` 改不到 → **固定一套图标必然只对默认主题正确**，只修一套等于修一个坏五个。
- 改造：换 Phosphor 图标族（MIT），未选中=regular 线性 / 选中=fill 面性（线→面区分状态是 Apple HIG / 主流 App 做法）；颜色不再硬编码，**从 \`themeStore.ThemeMeta.tabBarColor\` 解析**后由 \`gen-tabbar-icons.js\` **成套生成 5 套 × 10 张 = 50 张**（默认 autumn/grid 共用一套写在 \`assets/icons/\`，spring/summer/winter/starry 各一套落在 \`assets/icons/tabbar/<key>/\`）；\`themeStore\` 新增 \`tabBarIconDir\` 字段 + \`applyTabBarIcons\`，切主题时 \`setTabBarItem\` 逐个换。实测 5 套主色**逐像素等于**各自 tabBar 文字色（starry 的 \`#FFFFFF a=140\` = 55% 白也对）。
- **踩坑**：Taro 只打包被静态引用的资源，分主题图标是用运行时字符串拼路径 → **不进 dist**（首轮 0 张）。需在 \`config/index.js\` 的 \`copy.patterns\` 显式声明 \`{ from: 'src/assets/icons/tabbar', to: 'dist/assets/icons/tabbar' }\`，加后 40 张全部入包。

**④ 连带修复：tone 体系补全，让 App 内图标也跟随主题**
- 修好 ② 后 tint 底色开始跟随主题，但图标颜色写死 → 会在非默认主题下**新出现**"图标色≠底色"的违和（等价于挖了新坑）。故扩展 \`IconTone\` 新增 \`gold / gold-deep / sage / teal / danger / success\`，取色源为 \`ThemeMeta.palette\`（新增字段，与 \`_theme.scss\` 一一对应）；同时把散落的 **13 处硬编码色值**调用点（\`#E8920A\`×5、\`#2FC98E\`×4、\`#FF5A5F\`×2、\`#4FA3E3\`、\`#FFB020\`）改为语义 tone（脚本 \`fix-icon-tones.js\` 带逐条原文校验，不符即中止不写半个文件）。现状：全项目 243 处 \`<Icon>\` 已有 219 处走 tone。

**⑤ 回归与修复**：改 \`applyNativeBars\` 后 \`pagesUser/invite\` 测试整页崩（\`Taro.setTabBarItem is not a function\`，\`useThemeClass\` 挂载即调）。这暴露**真实生产风险**：单个 API 缺失不该让页面白屏 → 在 \`applyTabBarIcons\` 加 \`typeof Taro.setTabBarItem !== 'function'\` 守卫 + try/catch（同步 TypeError 不会被 \`.catch\` 兜住）；并给该测试补全 mock。

**验证**：小程序 typecheck 仅余 1 处既有错误（\`index.test.tsx(538,43)\`，属并行会话 chat-session WIP 的 vi.hoisted 类型推断问题，改动前后同源）；\`build:weapp\` Compiled successfully；**全量 2609 passed / 44 skipped / 0 failed（151 文件）**，其中新增 themeStore 测试 4 例（palette 完整性、非默认主题必须配 \`tabBarIconDir\`、切主题调 5 次 \`setTabBarItem\` 且 index 顺序对齐 app.config、切回默认回落路径）；编译产物失效写法残留 **0**；主包 **1.84MB / 2MB（91.8%）**。交付效果对比图 \`02-UI设计/首页优化预览/visual-preview/效果对比.html\` + \`.png\`（含 6 套主题 tabBar 前后对照 + 宫格前后对照 + 失效 CSS 原理说明）。

**待办（用户侧）**：微信开发者工具**重新编译**后查看 — ①底部导航栏图标；②首页快捷功能宫格；③顺便看其他页面（380 处修复会让大量卡片的浅色底/边框/阴影首次显形，视觉会有可见变化，属预期修复）；④设置页切换 6 套主题，确认 tabBar 图标跟着文字一起变色。

**遗留（已记录，非缺陷）**：\`assets/icons/{chat,chat-active,member,member-active,family,family-active}.png\` 共 6 个文件**全项目零引用**（其中 chat/member 是 32×32 / 48×48 的空白图，70~127 字节），属历史死资源，本次未删（无引用不影响包体积判断，删除收益仅 ~2.7KB）；主包已到 91.8%，若后续再加资源需先优化（可选方案：PNG 转调色板压缩省 ~40KB，或改自定义 tabBar 用 SVG 彻底省掉 82KB）；\`.bak\` 备份 40 个已从 src 移到 \`02-UI设计/首页优化预览/backup/\` 避免污染 git status。

**阻塞**：无。
`

fs.appendFileSync(FILE, entry, 'utf8')
const lines = fs.readFileSync(FILE, 'utf8').split('\n')
console.log(`✅ 已追加到 ${FILE}`)
console.log(`   当前总行数: ${lines.length}`)
console.log(`   新增 ${entry.split('\n').length} 行`)
