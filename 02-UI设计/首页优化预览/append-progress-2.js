/**
 * 追加本次「时光页优化 + 回忆录入口收口」到项目记忆
 * （用 node 写：PowerShell 处理 UTF-8 中文会乱码）
 */
const fs = require('fs')

const FILE = 'E:/星河宠记/项目记忆/progress.md'

const entry = `
2026-09-10 23:10 : [已完成·未提交] [⭐️ 星河宠记·时光页优化 + 回忆录入口收口（与创作重复的入口全去除）] — 用户：「这个界面也要优化」+「像回忆录这些都冲突了 和创作里面 都去除」。先做重复性核查再动手，避免误删功能。

**① 重复关系核查（关键前置，直接决定动手范围）**
- 时光页顶部「回忆精选」三张卡：年度回忆 / 日常回忆录 / 纪念Vlog。
- 创作页「🎨 创作」区已有：形象工坊 / **回忆录馆**（\\\`/pagesMemoir/memoir-center/index\\\`）。
- 回忆录馆内是 light/standard/full 三档，分别跳 \\\`memoir-daily\\\` / \\\`memoir-vlog\\\` / \\\`memoir-full\\\`。
- **结论**：时光页的「日常回忆录」「纪念Vlog」跳转目标正是回忆录馆的轻纪念档与标准档 → **真重复**；
  但「年度回忆」全项目仅此一处能生成年度图集，而回忆录馆里同名的「年度回顾」当时只是
  \\\`Taro.showToast('年度回顾即将上线')\\\` 的**假占位** → **不重复，不能一删了之**。
- 经用户确认选「三张全从时光页删掉，同时把年度回忆搬到回忆录馆」，避免把一个能用功能删成孤儿
  （\\\`pagesPet/yearly-review\\\` 页面本就只在 app.config 注册、无任何引用）。

**② 年度回忆迁移（时光页 → 回忆录馆）**
- 整体搬迁：\\\`generateYearlyReview/renderYearlyReview/saveYearlyReview\\\` 三件套 + 5 个 state
  （yearlyReview/reviewLoading/reviewImageUrl/showReviewModal/reviewCanvasRef）+ 3 个 handler
  （handleYearlyReview/handleSaveReview/handleCloseReview）+ 离屏 Canvas + 预览弹窗 JSX + 弹窗样式。
- **渲染时序必须保留**：先 \\\`reviewCanvasRef.current = true\\\` 让 Canvas 真正挂载，等 300ms 再让 service
  取上下文绘制 —— 顺序反了会拿到 null 上下文，表现为「点了没反应」。迁移后补了注释说明。
- 顺手改进：原实现 \\\`if (reviewLoading || !currentPet || !userId) return\\\` 是**静默返回**，无宠物时点了没反应；
  改为弹 toast「请先添加宠物」。
- 样式迁移：原 \\\`timeline-review-*\\\` 前缀改为 \\\`mhall-review-*\\\`（WXSS 页面级隔离，样式不会跨页生效，
  必须在本页重新定义），配色沿用回忆录馆自成一套的暖色硬编码语言；动画改用全局 \\\`fadeInScale\\\`
  （原来的 \\\`modalSlideUp\\\` 是时光页私有 keyframes，不重复定义）。
- 「年度回顾」mini 卡由假占位改为真入口，并带生成中态（\\\`mhall-mini--loading\\\`，文案切「生成中...」）。

**③ 时光页清理（删净，无残留）**
- 删除：回忆精选整个区块 + 年度回忆弹窗 + 离屏 Canvas；5 个 handler；5 个 state；
  \\\`yearlyReviewService\\\` 两个 import；\\\`Canvas\\\`/\\\`useCallback\\\`/\\\`useRef\\\` 三个已无引用的 import。
- 样式删除：\\\`.timeline-featured*\\\`（含 card/glow/icon/text/title/desc 与 \\\`--coral/--gold/--sage\\\` 变体）、
  \\\`.timeline-func-card--loading\\\`、\\\`.timeline-add-round-btn/icon\\\`、\\\`.timeline-photo-dashed/photo-add-*\\\`、
  \\\`.timeline-review-modal/image-wrap/image/canvas\\\`。
- **保留的共享样式**（三个弹窗共用，误删会连带打坏新增回忆弹窗与详情弹窗，已逐一核对）：
  \\\`.timeline-review-overlay/header/header-title/header-close/actions/btn*/btn-text\\\`。
- 文件头注释同步改写：职责收窄为「看时光线 + 记一条回忆」。

**④ 时光页视觉优化（用户要的「也要优化」）**
- **悬空裸「+」→ 渐变胶囊「+ 记录」**：原 \\\`.timeline-add-round-btn\\\` 是 88rpx 橙色圆圈，靠
  \\\`align-items: flex-end\\\` 底对齐挂在标题下方留白里，像个没有归属的浮标；改为 64rpx 高胶囊
  （渐变 + \\\`$shadow-button\\\` + 按压缩放 + Phosphor \\\`plus\\\` 图标 + 文字），
  \\\`.timeline-header\\\` 的 \\\`align-items\\\` 由 flex-end 改 center 并把间距交给 gap。
- **新增「时光速览」**：回忆精选撤掉后顶部会塌出大段空白，这里换成**真实数据**摘要
  （陪伴天数〔出生日至今，无生日则不显示该格〕/ 时光记录数 / 珍藏照片数），而不是拿装饰硬填。
  放在滚动区首位（可随滚动移出），页头保持纤细，「时光足迹」列表获得更大空间。
- **修复一个假按钮**：卡片的「＋ 添加照片」是虚线按钮样式 + 按压反馈，但整张卡点击只打开详情弹窗、
  并不支持给这条记录补照片 —— 点下去得不到预期结果。改成不带按钮感的纯提示
  （相机图标 + 「这条记录还没有照片」），不再误导点击。
- 空态文案同步：「点击上方「新增回忆」按钮」→「点右上角「记录」，写下{petName}的第一个珍贵瞬间」
  （原文案指的按钮已不存在）。

**验证**：小程序 typecheck 仅余 1 处既有错误（\\\`pages/index/__tests__/index.test.tsx(538,43)\\\`，属并行会话问题）；
\\\`build:weapp\\\` Compiled successfully；**全量 2615 passed / 44 skipped / 0 failed（152 文件）**；
编译产物核验：时光页 \\\`yearly-review-canvas\\\` 引用 **0** 处、回忆录馆 **1** 处（迁移到位）；
全项目对 \\\`timeline-featured|timeline-add-round|timeline-func-card|timeline-photo-dashed|timeline-photo-add-\\\`
的引用 **0** 处（已清干净）；主包 **1.82MB / 2MB**（迁移后比之前 1.84MB 略降，因年度图集代码移入分包）。
交付效果对比图 \\\`02-UI设计/首页优化预览/timeline-preview/时光页优化对比.html\\\` + \\\`.png\\\`（两屏并排 + 回忆录馆前后）。

**待办（用户侧）**：微信开发者工具重新编译后查看 ①时光页（页头胶囊按钮 / 时光速览 / 回忆精选是否已消失）；
②创作页 → 回忆录馆 → 「年度回顾」应能直接生成年度图集并可保存到相册。

**遗留（已记录，非缺陷）**：\\\`pagesPet/yearly-review/index\\\`（10.7KB 页面）在 app.config 注册但全项目无任何引用
—— 是当初做年度回忆时另开的一套页面，与时光页内嵌的年度图集功能重复且更早失联；本次未动（删除会影响分包页面清单），
建议后续确认无用后一并清掉；回忆录馆「我的回忆录」仍是「生成记录即将上线」占位，属后续需求。

**教训（本次踩到，值得固化）**：用 edit 工具做「删除一段代码」时，把 old_string 写成了要保留的那一行、
new_string 写成了「被删内容 + 保留行」，结果**把删除做成了复制**，代码重复两份。所幸随后按 "const handleXxx" 计数
发现次数为 2/3 才察觉。→ **批量/结构性编辑后一定要用计数或 grep 复核，不能只看 edit 是否成功返回**；
另外本仓库 .tsx 是 **CRLF**，写正则脚本做行级删除时 \\\`$\\\` 会因行尾 \\\`\\r\\\` 匹配不上，
必须先 \\\`split(/\\r?\\n/)\\r?\\n/\\\` 再 \\\`join(eol)\\\(\\)\\\` 回写（本次脚本的边界校验正是因此拦下了一次误删）。

**阻塞**：无。
`

fs.appendFileSync(FILE, entry, 'utf8')
const lines = fs.readFileSync(FILE, 'utf8').split('\n')
console.log(`✅ 已追加到 ${FILE}`)
console.log(`   当前总行数: ${lines.length}`)
