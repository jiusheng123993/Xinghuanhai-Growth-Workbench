## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

When the user types `/graphify`, use the installed graphify skill or instructions before doing anything else.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- Dirty graphify-out/ files are expected after hooks or incremental updates; dirty graph files are not a reason to skip graphify. Only skip graphify if the task is about stale or incorrect graph output, or the user explicitly says not to use it.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).

## 平台范围（用户 2026-09-12 定规，优先级最高，先于本文件其余所有节）

> 用户原话：「**先做小程序。小程序做成功了，能有回报再去做 App。**」

- **本项目当前只做微信小程序**。所有开发、改造、发版、验收，**目标平台只有小程序**。
- **`03-源代码/小程序/miniapp/` 里有 Capacitor + Android 一套（`capacitor.config.*`、`android/` 目录、
  `cap:sync` / `cap:open` / `cap:copy` 脚本），那是把同一份前端代码再打包成安卓 App 用的 ——
  **暂缓，不要动**：不要跑 `cap:*` 脚本、不要改 `android/`、不要为它做兼容取舍、不要重新打包 APK。
- **发版口径**：`npm run build:weapp`（产物 `dist/`）→ 微信开发者工具 CLI `upload`。**不涉及 `build:h5`**。
- **等小程序跑出回报（有真实用户/收入等）之后，再由用户决定是否回头做安卓 App。**
  在那之前，若某处为"安卓也能用"而纠结，**按小程序优先取舍并记录**，不要为它增加复杂度。

## AI 能力配置（用户明确要求）

本项目的 AI 相关密钥已配置在 `03-源代码/server/.env`（如 DeepSeek `AI_API_KEY`、百炼 `BAILIAN_API_KEY`、Seedream/Seedance、微信等），统一从 `src/config.ts` 读取。

- 需要大模型对话、图像生成等 AI 能力时，直接读取这些配置并调用，不要询问用户，也不要当作未配置跳过。
- 密钥只允许存在于 .env / 环境变量中，禁止写进代码、文档或提交到 git。
- 对外调用时同样遵守"中文注释、图谱优先"等既有规则。

## 提示词技能（用户明确要求：所有提示词任务先加载）

- **`pet-prompt-engine` 技能**：`E:\星河宠记\.dsh\skills\pet-prompt-engine\SKILL.md`（提示词库《宠物回忆录-提示词库.md》的可执行固化版）。
- **凡是涉及 AI 提示词的任务（生图/头像/全家福/表情包/回忆录视频分镜/写提示词测试）必须先加载该技能**，按公式完整组装，禁止各写各的、禁止遗漏环节（主体+外貌+表情+画风+氛围+画质+角色锁定+主体锁定）。
- 代码调用点索引见技能 §三/§九：公共约束 `petPrompt.ts`、画风/表情/外貌提取 `avatarService.ts`、全家福 `familyPhotoService.ts`、回忆录 `promptTemplates.ts`、前端模板 `avatar-customize/index.tsx`。
- 金科玉律：宠物名字绝不进提示词（「烧鸡」事故）、外貌写具体（§0.9，有照片自动提取）、数量锁定、参考图一致性、清洗兜底。

## UI 技能（用户明确要求：所有 UI 任务先加载）

> **背景（2026-09-11 复盘）**：做完整站视觉优化后，用户问「这些 skill 都不会自动调用吗？为什么我们都没用到」。
> 原因是 **skill 不会自动加载，判断"该调哪个"是 AI 的责任**；而当时 AGENTS.md 里没有这条规则，所以被忽略了。
> 反观 `pet-prompt-engine` 每次都遵守——差别不在"有没有 skill"，而在"有没有人写明必须用"。故补此节。

- **`miniapp-ui-polish` 技能（用户级，跨项目可用）**：`C:\Users\zhang\.dsh\skills\miniapp-ui-polish\SKILL.md`
  —— 微信小程序 / Taro 的 UI 优化**机制与验收**：小程序样式陷阱（`rgba(var(--x),α)` 是非法 CSS、`<Text>` 折叠换行、`aspectFit` 裁切、主包 2MB、tabBar 图标是 PNG、CORP 拦图）、无登录态下的真实渲染验收链路、13 条设计原则、AI 素材生成注意事项。
- **凡是涉及 UI / 视觉的任务必须先加载该技能**：用户说「页面太丑」「帮我优化界面」「这里看着很奇怪」「和别人比差远了」「改了怎么没变化」，或需要加空态插画 / 页头 / 图标体系 / 主题色 / 改造页面观感。
- **设计 craft 层另配**：视觉方向与审美决策 → `impeccable`；查风格库/配色/字体 → `ui-ux-pro-max`；做有辨识度的视觉 → `frontend-design` / `design-taste-frontend`；动效 → `animate` / `review-animations` / `apple-design`。**本技能管小程序机制与验收，craft 交给它们，别重复劳动。**
- 方法论文档（给人看的版本）：`02-UI设计/UI优化方法论.md`。
- **铁律复述**：① 先做风格诊断，别急着加元素 ② 改"始终可见"的区域（空态只有新用户看得到）③ 布局问题**必须用 `getBoundingClientRect` 量，不能看截图** ④ 汇报时把"修复"与"美化"分开说。

## 部署配置规范（用户明确要求，以后所有项目都要）

- **每个项目的部署配置统一记录在各自仓库的 `05-部署配置/部署配置.md`**（服务器信息/应用路径/PM2 进程/数据库/环境变量清单/依赖/部署步骤/监控/部署记录）。
- **密钥/密码/数据库连接串的值永不写入部署配置文档**（安全红线），只记键名与获取方式，值见服务器 `.env`。
- 部署（数据库迁移/重启/上线）后必须：①更新部署配置文档的"部署记录"表；②冒烟验证（表/接口/进程）。
- 项目服务器信息（IP/账号/路径/进程名）以部署配置文档为准，不臆造（如星河宠记 PM2 进程实际是 `xinghuanhai-server`）。
- 迁移遇 "must be owner of table"：用 `sudo -u postgres psql -d <库名>` 执行，并 `ALTER TABLE ... OWNER TO <应用用户>`。

### 生产数据安全红线（2026-09-10 事故后新增，强制执行）

> 事故背景：2026-09-10 多会话改造部署时，冒烟脚本用**真实用户**做测试 fixture，其 MERGE（`UPDATE ... WHERE user_id AND pet_id AND session_id IS NULL`）把该用户 43 条存量消息归并到测试会话，紧接着 `DELETE ... WHERE session_id` 级联删除，**32 条真实对话永久丢失**（`archive_mode=off` 无 PITR）。以下三条为强制规则：

- **① 生产冒烟/验证脚本禁止触碰真实用户数据**：fixture 必须用专用测试账号 + 测试宠物（无数据或可丢弃），禁止 `SELECT ... FROM <业务表> LIMIT 1` 直接拿真实用户当样例，禁止对真实 `user_id`/`pet_id` 执行任何写操作。
- **② 任何 UPDATE / DELETE 验证必须在事务内且以 ROLLBACK 结束**：`BEGIN; ...验证...; ROLLBACK;`，禁止 COMMIT。确需落库的验证数据必须可识别（如 `title='__smoke_test__'`）且验证后立即清理，清理动作本身也需在事务中确认影响行数。
- **③ 写操作前先报告影响行数并核对预期**：执行 destructive SQL 前先跑同条件 `SELECT count(*)` 核对，脚本必须打印 `rowCount` 并对超出预期的行数**中止**而非继续。
- 生产库只读排查优先：能用 `SELECT` 验证的不要用写操作；需要验证写入链路时优先在测试库/临时库进行。
- 数据库备份现状（2026-09-10 事故后加固）：①每日 03:00 逻辑备份（`/var/backups/xinghuanhai/`，保留 15 份）+ 本地 07:00 拉取（`E:\Backups\xinghuanhai\`，保留 30 份）；②**已开启 WAL 归档（`archive_mode=on`，归档目录 `/var/backups/pg_wal_archive`）** + 首个基础备份（`/var/backups/pg_basebackup/`），维护脚本 `05-部署配置/monitor/pg-pitr-maintenance.sh`（cron：每周日 04:10 基础备份保留 4 份、每日 04:30 清理 7 天前 WAL）→ **已具备 PITR 能力**，可恢复到任意时间点，最坏损失从"一天"降到"分钟级"。

## 项目记忆

> 📌 **本项目的历史项目记忆已迁至独立文件**：`项目记忆/AGENTS-历史记忆.md`
>
> **迁出原因（2026-09-11）**：本节曾占 AGENTS.md 全文 86%，导致文件达 114 KB、
> 超出工作区指令 64 KB 的注入预算，**末尾约 50 KB 每次会话都被截断**；
> 而记忆按时间追加、最新的在最末，正好全在被截断的部分。
>
> 现在的分工：
> - **AGENTS.md（本文件）** = 规则，必须完整可见 → 新增规则**加到靠前位置**，不要追加到末尾。
> - **`项目记忆/AGENTS-历史记忆.md`** = 历史项目记忆（迁出前的内容）。
> - **`项目记忆/progress.md`** = 近期会话进度日志（与上者是两套记录，不是重复）。
>
> 需要项目历史时主动读这两个文件，不要假设它们已在上下文里。
