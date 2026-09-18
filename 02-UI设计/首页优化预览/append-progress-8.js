/**
 * 追加「页头合并 + 去宠物名」到项目记忆。模板字符串内不能用反引号。
 */
const fs = require('fs')
const FILE = 'E:/星河宠记/项目记忆/progress.md'

const entry = `
2026-09-11 05:45 : [已完成·未提交] [星河宠记·页头合并（时光/家庭）+ 页头不再写死宠物名] — 用户：「上面的可乐的时光线和这个冲突了 融合一下 而且我们有多宠物 这个不适合直接挂名字」。

**① 问题确认**：时光页出现**两套标题**叠着 —— 旧的 timeline-header（「{宠物名}的时光线 + 记录每一刻温暖时光 + 记录按钮」）在上，新加的 PageHero（「时光 / 一路走来的每一个瞬间」）在下。并行会话加 PageHero 时的注释还写着「固定页头已经有宠物名+记录按钮，再叠会压掉列表高度」，说明当时就意识到重叠但选择了叠放，实际观感就是重复。

**② 修法：合并成一个页头**
- 给 PageHero 增加可选的 actionText / onAction（渐变胶囊按钮 + 按压反馈），让它能同时承担「标题 + 说明 + 主操作」。
- 时光页：删掉整个 timeline-header，固定顶部只放 PageHero（illustration=page-timeline / title='时光线' / subtitle='一路走来的每一个瞬间' / actionText='记录'）；滚动区里那份 PageHero 同时移除。
- 清理随之废弃的 .timeline-header / -header-left / -title / -subtitle / -add-btn / -add-btn-icon / -add-btn-text 七组死样式（tsx 残留 0 处）。
- .timeline-fixed-top 原来是配合全宽页头的（不设左右 padding），改由带圆角的 PageHero 承担后补上 padding: 16rpx 28rpx 0，并压掉卡片自带 margin-bottom。

**③ 页头不再写死名字（多宠物/多家庭）**
用户指出的更根本问题：**本 App 支持多宠物**，页头挂某一只的名字，切换宠物后立刻失效。
- 时光页：「可乐的时光线」→「时光线」（具体是哪只由内容与切换器体现）。
- 宠物档案：「{宠物名} 的健康档案与日常」→「健康数据与日常，都在这里」。
- 家庭页：顺手发现同一问题 —— PageHero 写「{家庭名}」而下方 family-head 又写一遍，**名字重复**；改为「宠物家庭 / 和家人一起，记录毛孩子的每一天」，家庭名只在下方的 head 展示（且那里带编辑入口）。
- 全项目扫描确认：已无任何 PageHero 挂具体宠物名/家庭名。
- **判据固化：页头只写"页面名"，对象名交给页面内的切换器/卡片。** 否则多对象场景必然失效。

**验证**：typecheck 仅余 1 处既有错误（useNamingFlow.ts(644,51)，并行会话在改）；build:weapp Compiled successfully；**全量 2680 passed / 44 skipped / 0 failed（157 文件）**；主包 **1.81MB / 2MB**；H5 真实渲染确认：时光页只剩一个页头（插画+时光线+说明+记录按钮）、无重复标题、无宠物名；家庭页页头与下方 head 不再重复家庭名。

**并行会话提醒**：本轮发现 PageHero.scss 也被另一会话改过（字号从 38/22rpx 调为 32/20rpx），我的按钮样式是在其最新版基础上追加的。**同一批文件被两个会话同时改，存在互相覆盖风险**，动共用文件前先看 git status 与文件修改时间。

**待办（用户侧）**：微信开发者工具重新编译看时光页与其余页面。
**阻塞**：无。
`

fs.appendFileSync(FILE, entry, 'utf8')
const lines = fs.readFileSync(FILE, 'utf8').split('\n')
console.log(`✅ 已追加到 ${FILE}（当前 ${lines.length} 行）`)
