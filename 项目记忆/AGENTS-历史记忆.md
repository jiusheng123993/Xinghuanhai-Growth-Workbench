# 星河宠记 · AGENTS.md 历史项目记忆

> 本文件由 `AGENTS.md` 的「## 项目记忆」节整段迁出（2026-09-11）。
>
> **迁出原因**：AGENTS.md 长到 114 KB，超过工作区指令 64 KB 的注入预算，
> 末尾约 50 KB 每次会话都被截断；而记忆是按时间追加的，**最新的恰好被砍掉**。
> 迁出后 AGENTS.md 只留规则，永远完整可见；记忆改为按需读取本文件。
>
> 新增记忆请**追加到本文件末尾**。规则类内容仍写在 AGENTS.md 靠前位置。

---
## 项目记忆

> ⚠️ **本文件会被截断，读之前先看这里（2026-09-11 实测）**
>
> - 本文件 114 KB，但工作区指令注入预算是 **64 KB** → **末尾约 50 KB（436 行里的后 155 行）AI 根本看不到**。
> - 规则类内容（graphify / AI 能力 / 提示词技能 / UI 技能 / 部署配置规范）都在**前 60 行**，安全。
> - 但**记忆是按时间追加的，最新的在最末** → 恰好是会被砍掉的部分。
> - 因此：**新增规则一律加到文件靠前的位置**（不要追加到末尾）；**最近的项目记忆请直接读 `项目记忆/progress.md`**（与本节是两套并存的记录，不是重复）。
> - 待办（建议尽快做）：把本节 86% 的历史记忆迁到独立文件，本文件只留规则 + 指针，否则会继续恶化。

### 2026-08-08 · 运营应急准备（与情侣消消乐同步）

- 安全与稳定现状（勿重复建设）：helmet、脱敏请求日志、分层限流（全局 60/分钟；AI 生成 5/分钟；对话 30/分钟；回忆录 3/分钟；上传 10/分钟）、JWT 启动校验、PM2 自动重启 + 内存保护、zod 校验、CORS 白名单、微信支付回调 raw body 验签。
- 新增文档：`01-产品文档/运营应急预案.md`（风险全景 + 上线前检查清单 P0/P1/P2 + 按场景应急流程 + 联系人表待填）。
- 服务器监控：与情侣消消乐共用一台服务器，监控脚本由情侣消消乐仓库维护：`E:\情侣消消乐\05-部署配置\monitor.sh`（健康/磁盘/证书/内存 + 微信告警，cron 每 5 分钟）。
- 待办（P0 级）：AI 算力余额告警、数据库备份异地副本 + 恢复演练、支付订单每日对账、上传目录容量监控。
- 用户明确要求：两个项目（情侣消消乐、星河宠记）均为用户所有，运营应急准备要同步推进；本条目即项目记忆，后续新进展继续追加在这里。

### 2026-08-23 · 知识图谱全流程 + 监控备份体系（重要里程碑）

**功能落地（三阶段设计全部实现，服务端已部署）**
- Phase1 医学知识图谱 + 置信度（`miniapp/src/data/petKnowledge/medicalGraph.ts`，前端静态兜底）；Phase2 会员 AI 深度分析 + 记忆闸门召回（服务端 `symptomAiService.ts`）；Phase3 图谱热更新（服务端权威 + `setActiveGraph` 切换）+ 用户纠错 + 审核后台（`/admin`，ADMIN_TOKEN）；恢复事件记忆闭环；聊天 `check_symptom` 消费权威图谱（`graphEvaluator.ts`）。设计文档：`01-产品文档/宠物医学知识图谱与置信度-设计方案-2026-08-22.md`。
- Agent 对话成本日志（AI 算账）：`agent_conversation_logs` 表记录每轮对话意图/工具链/token/耗时（try/finally 兜底客户端断开），可回答"每用户每天烧多少 AI 钱"。

**监控与备份（2026-08-23 补齐 P0 缺口，服务器 49.232.203.85）**
- 监控（5 分钟 cron + 微信告警，`/srv/ops/monitor.sh`）：双 API 健康/PostgreSQL/磁盘/内存/证书。
- 数据库备份（每日 3 点）：`backup-xinghuanhai.sh` 备份 xinghuanhai 库（**此前只有 qinglv 库有备份，xinghuanhai 无备份是 P0 缺口，已修复**），保留 15 份，失败告警。
- 异地备份（每日 7 点本地计划任务 `XHH-Backup-Pull`）：`05-部署配置/backup-local-pull.js` 免密 SSH 拉取到 `E:\Backups\xinghuanhai\`（保留 30 份）；已校验 checksum 与服务器一致。
- AI 余额告警（每日 9 点）：DeepSeek <¥10 告警（当前 ¥73.21）；支付对账（每日 9:30）：异常告警。
- **恢复演练已验证**：备份还原临时库成功（56 表 + 关键表数据完整）。
- 运维脚本唯一事实源：`05-部署配置/monitor/`（git 管理），服务器 `/srv/ops/` 为生产副本。
- 待补：恢复演练已做一次（建议定期复演）；ARK/百炼/Seedream 余额告警需控制台 AK/SK；**root 密码曾暴露于聊天记录，建议尽快改密**。

### 2026-08-23 · 修复"点击 AI 周报报错"（前后端契约不匹配）

- **根因**：后端 `/api/families/:id/weekly-reports/latest` 等返回表行结构 `{id, family_id, week_number, year, report_data(JSONB), ai_insight, share_card_url, created_at}`，而周报详情页 `pagesPet/weekly-report/index.tsx` 此前按扁平视图结构 `{report_date, overall_mood, summary, highlights, concerns, pet_summaries}` 消费，`report.highlights.length` 访问 undefined → 前端渲染 TypeError，点击入口白屏。线上佐证：接口 200/304 无 500（库内 1 条周报，family 5f7f693d…，2026 第 32 周）。
- **修复（纯前端）**：`services/weeklyReportService.ts` 新增 `BackendReportRow` 接口 + `mapBackendReportRowToView()` 映射（ISO 周计算与后端同算法；highlights/concerns/overallMood 由 report_data 生成；缺 report_data 容错全 0），三个 service API 内部统一映射；周报页改用映射后结构，2x2 取后端真实聚合，成员小结卡空时隐藏；补 5 单测。
- **验证**：小程序 typecheck ✅、周报 46 测试 ✅、全量 2330 passed（仅余既有 avatarPresets 无关失败）✅、eslint 0 error ✅。改动未提交。
- **遗留建议**：后端聚合扩展 per-pet 明细（report_data 加 pets 数组）后前端自动显示"成员健康小结"；首页 family 周报预览 state 未渲染可后续接入。

### 2026-08-24 · 修复"添加宠物选择照片无反应"（隐私授权双机制冲突）

- **根因**：`miniapp/src/utils/privacy.ts` 手动调用 `Taro.requirePrivacyAuthorize`（主动隐私授权方案），与 `app.js` 已注册的 `Taro.onNeedPrivacyAuthorization`（被动方案，全局 PrivacyPopup）混用——微信官方规定两种方案**二选一**。未授权用户点击选图时授权流程被干扰，失败错误未命中代码里仅有的 errno 112 / 含 privacy 两个识别分支，被 `pagesPet/add/index.tsx` 的静默 catch（仅 console.warn）吞掉 → 表现为"点击选择照片无反应"。
- **修复（纯前端 2 文件 + 1 新测试）**：①`privacy.ts` 去掉 `requirePrivacyAuthorize`，统一走被动机制（chooseImage 在用户未授权时自动触发 `onNeedPrivacyAuthorization` → 全局 PrivacyPopup → 用户同意后微信自动放行并继续选图），并补全失败反馈（用户取消静默 / errno 112 弹 modal 提示开发者 / 拒绝隐私授权 toast / 其他失败 toast「选择照片失败，请重试」，杜绝静默无反应）；②`add/index.tsx` `handleChooseAvatar` 补 `tempFilePaths` 空数组保护；③新增 `src/utils/__tests__/privacy.test.ts` 6 用例（正常/取消/112/拒绝/其他失败/异常错误对象）。
- **验证**：tsc 0 错误 ✅、privacy 6 测试全过 ✅、全量 2361 passed（唯一失败为既有 avatarPresets 数据资产问题，与本次无关）✅、改动文件 eslint 无新增错误（add/index.tsx 的 2 个 import/first error 为既有问题，stash 证实）✅、graphify 图库已更新 ✅。改动未提交。
- **遗留**：avatarPresets 既有失败（品牌头像库 URL 断言）待后续排查；`add/index.tsx` 既有 lint error 待清理。

### 2026-08-24 · 体验版图片不显示/上传失败（webp 真机兼容 + nginx 静态资源 404 + 隐私声明）

**现象**：体验版登录主图/品牌 logo/宠物预选头像不显示（模拟器正常、安卓真机空白）；"所有照片都无法上传"（实际是选图阶段被拦）。同时挖出隐藏 bug：已上传照片（jpg/png）公网一直 404。

**根因链（三个独立问题）**：
1. **webp 真机兼容性**：微信安卓真机对 webp（尤其 VP8X+ALPH 带透明通道）解码兼容性差，模拟器（Chromium 内核）正常、真机空白。本地 23 张 webp（登录主图 VP8 / logo+预选头像 VP8X+ALPH）+ 服务器 home-style 20 张全受影响。
2. **nginx 静态资源 404（隐藏 bug，本次最严重发现）**：`nginx-xinghuanhai.conf` 的 `location ~* \.(jpg|jpeg|png|gif|ico|css|js|svg|woff2?)$` 只加缓存头、**无回退**，/uploads/** 实际由 Express 托管（磁盘 /opt/xinghuanhai/server/uploads），nginx 正则拦截后只在 /var/www/xinghuanhai 找 → 公网 404；webp 不在该正则内走 `try_files → @backend` 反而正常——解释"webp 能加载、png 404"的怪象。**修复**：静态资源 location 加 `try_files $uri @backend;`（官网磁盘文件优先，/uploads 回退后端）。⚠️ 此 bug 意味着**此前所有用户上传的 jpg/png 照片公网都加载不出来**，本次一并修复。
3. **隐私声明 errno 112**：`chooseImage:fail api scope is not declared in the privacy agreement`（errno 112）= 微信后台《用户隐私保护指引》未声明选图接口，真机/体验版强制拦截（模拟器不校验）。前端 `privacy.ts` 已正确捕获并弹 modal 提示开发者；需用户在 mp.weixin.qq.com「设置 > 隐私保护设置」声明相册/相机权限——用户已确认配置完成。

**修复（前端 23 图转 PNG + 服务器传 PNG + nginx 修复）**：
- 本地 23 张 webp → PNG（Pillow，保留 alpha；预选头像 160px + 256 色调色板，20 张 1736KB→175KB，分包 pagesPet 1.80MB 保持微信 2MB 限内；登录主图 322KB 警告仅 webpack 提示不影响）
- `homeStyleAvatars.ts` URL 后缀 .webp→.png；`avatarPresets.ts`/`AiAvatar.tsx`/`LogoLoading.tsx`/`login/index.tsx` import 全改；webp 源文件删除
- 服务器 home-style 20 张补传 PNG（备份 home-style.bak-20260824024517），nginx 配置已修并 reload
- 测试断言同步（homeStyleAvatars.test / PresetAvatar.test / avatarPresets.test——后者原"服务端 https URL"断言与本地资源实现脱节，修正为本地 preset-home png 断言，全量 2361 passed 唯一既有失败消除）

**验证**：构建成功 ✅、主包 1.47MB/pagesPet 1.80MB/pagesUser 0.85MB ✅、公网 png 头像 200 ✅、官网/管理后台回归 200 ✅、webp 旧链接兼容 ✅、前端 2361 测试全绿 ✅。改动未提交。

### 2026-08-24 · 修复"兑换码兑换不成功"（前端路径缺 /api 前缀）

- **根因**：`pagesUser/member/index.tsx` 兑换调用 `api.post('/redeem', ...)`，但服务端所有业务路由挂在 `/api` 前缀下（`app.use('/api', redeemRoutes)` → 真实路径 `/api/redeem`）→ 生产请求 `https://api.xinghuanhai.com/redeem` 返回 nginx 层 404 → 被 `handleRedeem` 的 catch 吞成「兑换失败，请检查兑换码」，掩盖真实原因。用户输入合法码（如 XHH-L7GA-BX85-SA9E，格式符合生成器且无 I/O/0/1）也必然失败。生产探测实证：POST /redeem → 404，POST /api/redeem → 401（路由存在，auth 拦截）。
- **修复（纯前端 1 文件）**：`member/index.tsx` 兑换路径 `/redeem` → `/api/redeem`；catch 透传服务端错误信息（区分「兑换码不存在或已被使用」/「兑换码已被使用」/网络异常），不再笼统提示。
- **顺带排查**：`services/api.ts` 的 `getPets/getMembership/createPet/updatePet/deletePet` 同样缺 `/api` 前缀，但全仓无调用方（死方法，实际走 petService/membershipService 的 `/api` 前缀路径），不影响线上，待清理。
- **验证**：tsc 0 错误 ✅、全量 2362 passed / 0 failed（exit 0，含此前 avatarPresets 既有失败已修复）✅、graphify 图库已更新 ✅。改动未提交。
- **待办（用户侧）**：微信开发者工具重新编译后再试兑换码；若仍失败需查生产 `redeem_codes` 表该码状态（unused/used/不存在）。

### 2026-08-24 · 家庭图谱新增"人关系"（情侣/父女等）+ 「我的」页家庭卡

- **需求**：养宠人多（情侣/父女/母子等），家庭图谱应体现"人"的家庭角色关系。方案确认=8 种标准关系（couple 情侣/father_daughter 父女/father_son 父子/mother_daughter 母女/mother_son 母子/siblings 兄弟姐妹/friends 朋友/other 其他）+ 任意两人之间可设（有向：user_id_a 是关系主体）。
- **实现**：①迁移 027 新建 `family_user_relations`（UNIQUE(family_id, LEAST(a,b), GREATEST(a,b)) 防同一对重复）；②后端 `FamilyUserRelationRepository`（listRelations JOIN 双方昵称头像 / createRelation ON CONFLICT 防重 / removeRelation 归属校验）+ families.ts 3 路由（GET/POST/DELETE /:id/user-relations，读=成员、写删=仅 owner）+ schema 枚举 + 11 接口测试；③前端 familyTypes/familyService/familyStore 扩展关系 CRUD；④图谱页新增「👥 家庭成员（人）」卡（人节点带创建者/成员徽章 + 关系列表 emoji/方向箭头，owner 可添加/删除）；⑤「我的」页新增家庭信息卡（家庭名/成员数/我的角色，无家庭引导创建，useDidShow 切回刷新）。
- **验证**：服务端 tsc 0 错误 + 新测试 11/11 + 全量 915 passed ✅；前端 tsc 0 错误 + 全量 2362 passed + build:weapp 成功 + dist 确认含新功能 ✅；graphify 已更新 ✅。
- **待部署（用户确认后）**：迁移 027 + 后端代码需部署生产；前端已在 dist 但需微信开发者工具重新编译预览。

### 2026-08-24 · 修复家庭图谱"指向父母却指向自己"（前后端契约不匹配）

- **现象**：点击可乐，烧鸭（可乐的妈妈）不显示，连接线指向可乐自己。
- **根因**：前端 `familyTreeService.getLineageTree` 的 `LineageTreeResponse` 期望 `{pet_id, ancestors, descendants, siblings}`，后端 `getLineage` 实际返回 `{pet, parents, children, siblings, mates, ancestors_levels, descendants_levels}` → 前端 `lineage.ancestors/descendants` 为 undefined（祖辈/后代行空），同代行又被旧代码 `isCurrentRow && selectedNode` 强制只渲染选中宠物 → 图谱只剩可乐自己，父母根本没渲染，连接线视觉上指向可乐。
- **修复（纯前端 2 文件）**：①`familyTreeService.ts`：`LineageTreeResponse` 对齐后端契约 + `toTreeNode` 统一映射（pet_id/pet_name/pet_avatar_url/pet_species）+ `getLineageTree` 全量转换；②`family-tree/index.tsx`：TREE_ROWS 改「第一代·父母 / 第二代·同代 / 第三代·子女」，渲染按行组装（父母行=parents、同代行=选中宠物自己+兄弟姐妹去重、子女行=children），删除强制自渲染逻辑。
- **验证**：tsc 0 错误 ✅、全量 2362 passed ✅、build:weapp 成功 ✅、graphify 已更新 ✅。改动未提交。
- **效果**：点击可乐 → 第一行显示父母（含妈妈烧鸭），连接线指向正确。

### 2026-08-24 · 家族图谱"指向父母却指向布丁"= 数据库脏数据（已删）

- **现象**：用户点击可乐，本该指向父母（烧鸭）的手势/连线却指向了布丁（布丁出现在可乐"配偶"层、总览视图多一条"💞 配偶"连线）。
- **排查（SSH 生产只读查询）**：血缘正确（pet_lineage：烧鸭 7c0468be → 可乐、烧鸭 → 布丁，可乐布丁同窝兄妹）；但 pet_relationships 存在**错误 mate 关系**（93b95cf5…，可乐↔布丁，2026-08-23 00:35 创建，疑为当时测试添加关系误选"伴侣"）→ "配偶"层/连线错误指向布丁。
- **处置（用户确认后执行）**：`DELETE FROM pet_relationships WHERE id='93b95cf5…'`（DELETE 1）→ 复查涉及可乐/布丁的关系 0 条、血缘 2 条不受影响；无代码改动、无重启；部署记录已更新。
- **验证**：数据复查通过 ✅。用户前端重新编译/刷新即可见：可乐/布丁配偶层清空，布丁只出现在"手足"层（兄妹），"父母"手势正确指向烧鸭。
- **遗留建议**：产品层可加防御——添加关系时禁止把血缘兄弟姐妹设为配偶（防止同类脏数据）；"添加关系"面板可加确认弹窗提示所选双方已有血缘关系。

### 2026-08-24 · 家庭图谱无父母时指向铲屎官（动态行渲染）

- **现象**：点击烧鸭（无父母/无子女数据）时，图谱顶部仍渲染固定「第一代 · 父母」标题行 + 连接线，指向上方空气。
- **修复（纯前端 1 文件 + 样式）**：`pagesPet/family-tree/index.tsx` 三代行改为**动态组装**（删除固定 TREE_ROWS 常量）——父母行有数据显示父母、**无数据（无祖先）→ 显示「🏠 铲屎官」根节点**（复用 ft-node 结构 + 金色渐变头像 `ft-avatar--owner` + 昵称 + "家长"徽章，连接线指向下方宠物）；同代行=选中宠物自己 + 兄弟姐妹去重；子女行无数据不渲染；空数据行不再显示标题/手势。
- **验证**：tsc 0 错误 ✅、全量 2376 passed / 0 failed ✅、build:weapp 成功 ✅、graphify 已更新 ✅。改动未提交。
- **效果**：点击烧鸭 → 图谱顶部显示"🏠 铲屎官"（主人）并指向烧鸭，不再有指向空气的"父母"手势。

### 2026-08-24 · 全家福 AI 生成"四只猫生成一只鸡"修复 + 全量生图提示词接入提示词库（已提交已部署）

- **现象**：用户全家福生成的照片奇怪——四只猫生成一只鸡（其中一只猫名叫「烧鸡」），并质疑提示词未按提示词库做（判断正确）。
- **根因**：`familyPhotoService.ts` 的 `buildPrompt` 把宠物**名字**拼进英文提示词（`a ${breed} 猫咪 named ${name}`）——「烧鸡」在文生图模型里就是烧鸡（roast chicken），且会把 4 张参考猫图覆盖成只画一只鸡；同时 `STYLE_PROMPTS` 是硬编码简版英文模板（注释声称"参考项目提示词库"但实际未接入《宠物回忆录-提示词库.md》），且提示词无数量、无角色一致性、品种为空会出空串。
- **修复**：①新增 `server/src/services/petPrompt.ts` 提示词公共模块（固化提示词库 §0.6 全局角色锁定表 / §四 角色一致性模板：`petSubjectText` 品种兜底+清洗截断 20 字+**绝不写名字**、`PET_IDENTITY_KEEP` 毛色/花纹/体型/五官锁定参考图、`PET_ONLY_ONE` 只出现一只防加戏）；②`familyPhotoService.ts` 重写 `buildPrompt`：名字退出提示词（只存入库 member_names）、中文"品种+物种"逐只描述、明确数量（如"4只猫咪"）、参考图一致性+主体锁定、"以参考照片为准"仅在真有参考图时才写（修掉"无图却要求完全一致"的说谎）；`STYLE_PROMPTS` 六风格关键词改为基于提示词库 §六 官方风格关键词；③`image2DService.ts`（96 张表情包）与 `avatarService.ts`（多风格候选+旧单张）统一改用 petPrompt；④测试：新增 `familyPhotoService.test.ts` 8 用例 + `petPrompt.test.ts` 7 用例（「烧鸡」/chicken/roast/named 均禁止进 prompt、数量明确、品种兜底、猫狗混合计数、images 数组透传断言），修正"所有合法风格"用例补全 mock 断言 200（消除对"恰好500≠400"脆弱依赖与日志噪声）；⑤双 Agent 审查通过（无阻塞），5 条建议全部处理（注释措辞/参考图条件化/品种清洗/用例加固/images 断言）。
- **验证**：服务端 tsc 0 错误 ✅、全量 931 passed / 62 文件 ✅、相关 50 测试全过 ✅、graphify 已更新 ✅。
- **提交**：`32f0c7e fix(全家福): 宠物名字退出生图提示词，全量生图接入提示词库`（7 文件 +369/-42，分支 develop）。
- **部署（已完成，无数据库迁移）**：上传 4 文件（petPrompt + familyPhoto/avatar/image2D）→ 备份 3 旧文件到 `/opt/xinghuanhai/src.bak.promptfix-*` → PM2 重启 `xinghuanhai-server` → 冒烟全绿（health 200、日志无 error、生产实测 buildPrompt：四只猫含「烧鸡」→ 名字/鸡类词不进提示词、数量/风格/一致性约束生效）；部署记录已更新 `05-部署配置/部署配置.md`；回滚=恢复 src.bak.promptfix-* 后重启。
- **待办（用户侧）**：小程序重新生成全家福验证（旧"鸡"图可在相册删除）；前端无改动无需重新编译。

### 2026-08-24 · 添加宠物"不确定品种"兜底 + 品种搜索面板浮于键盘上方

- **需求**：①用户可能不知道自家小猫/小狗品种（混血/串串/流浪猫狗/领养）——品种是必填，不知道就卡住；②实测添加宠物时品种搜索面板被键盘盖住，搜完结果在键盘下面，必须收起键盘才能看到。
- **实现（纯前端 5 文件 + 1 测试）**：①`data/petKnowledge/breeds.ts` 新增 `UNKNOWN_BREED_ID='unknown_mix'` / `UNKNOWN_BREED_NAME='不确定品种'` / `UNKNOWN_BREED_KEYWORDS` / `isUnknownBreedKeyword()` 关键词匹配助手——**刻意不放进 BREED_DATA 数组**，避免污染品种知识库统计（breed 列表页计数/breed-detail/趋势页均遍历 BREED_DATA），仅作表单特殊值落库（后端 breed_id 无外键无枚举，各消费方对未匹配品种均有兜底：疫苗默认方案/头像物种兜底/饮食 unknown/趋势 null）；②`pagesPet/add/index.tsx` 品种面板顶部固定「不确定品种」高亮行（初始态常显；搜索时仅当关键词命中"不确定/混血/串串/不知道/mix/unknown"才展示，空态文案联动），选中后 breedId 落 unknown_mix、不展示品种特征卡；**键盘修复**：搜索 Input `adjustPosition={false}` + `Taro.onKeyboardHeightChange` 监听键盘高度 + 弹层 overlay 内联 `paddingBottom` 抬升面板，关闭/选中时 `Taro.hideKeyboard()`（原方案靠微信自动上推不可靠）；顺带把 `updateField` 包成 useCallback 消除既有 exhaustive-deps 告警；③`pagesPet/edit/index.tsx` 品种原生 Picker 追加「不确定品种（混血/串串）」选项（index 越界分支处理），已存 unknown 宠物可回改；④`pagesPet/add/index.scss` 不确定品种行样式 + 列表 `min-height:0` 修复键盘弹起时滚动边界；⑤新增 `data/petKnowledge/__tests__/breeds.test.ts` 8 用例（不在 BREED_DATA/空词 false/关键词命中/未命中/单字部分匹配）。
- **验证**：typecheck 0 错误 ✅、全量 2371 passed / 0 failed（含新增 9 个）✅、改动文件 eslint 0 新增问题（仅余 4 个既有 import/first 错误，git diff 证实非本次引入）✅、build:weapp 成功 ✅、dist 确认含 onKeyboardHeightChange 与 unknown_mix ✅、graphify 已更新 ✅；双 Agent 审查通过（P0/P1=0，详见下）；改动未提交。
- **双 Agent 审查结论**：**通过**。审查发现并已修复：①P2 关键词缺口——除「不确定/混血/串串/不知道/mix/unknown」外补「流浪/土狗/土猫/田园/领养」到 `isUnknownBreedKeyword`（否则用户搜「流浪」时兜底行不显示、空态提示也无兜底，正好卡住目标用户）+ 补单测；②P3 edit 页选「不确定品种」补 `trackEvent('select_breed_unknown')` 与 add 页口径一致；③P3 服务端 `petPrompt.ts` 的 `petSubjectText` 把「不确定品种/混血/串串」映射为 `PET_BREED_FALLBACK`（防文生图把「不确定」当指令词，与「烧鸡」同类风险的低危版）+ 补 4 断言。P2 真机验证（键盘抬升方案安卓/iOS 实测）为待办非缺陷。
- **遗留建议**：edit 页品种 Picker 与 add 页搜索面板交互不一致（后续可统一为搜索面板）；breed-detail「我的宠物是这个品种」跳转 edit 页的 breedId/breedName/species 参数 edit 页未消费（既有问题，本次未动）；键盘高度方案需真机验证（模拟器/安卓/iOS）。

### 2026-08-24 · 添加宠物"拍照识别品种"（AI 帮用户认品种，用户需求正解）

- **需求澄清**：用户真正想要的是"**怎么帮助宠物判断品种**"（识别），不是只给一个"不确定品种"兜底选项。项目里品种百科页本就有 AI 拍照识别（后端 `/api/ai/breed-recognize`，authMiddleware + 全局限流，已上线），只是添加宠物时没有入口。
- **实现（纯前端 2 文件 + 1 新测试）**：`pagesPet/add/index.tsx` 品种面板顶部新增「📷 拍照识别品种」入口（搜索框上方、主色渐变卡片）——点击 → 未登录先 `ensureLoggedIn` 引导（识别接口需登录）→ `chooseImageWithPrivacy` 拍照/相册 → `recognizeBreed`（复用 breedService，识别失败/取消不打扰流程）→ `matchBreedInData` 在品种库三级匹配 → 面板内展示识别结果卡：匹配到库内品种 → 「✅ 就用这个」复用 `handleSelectBreed` 一键选中（含**物种联动**：识别物种与表单不符时自动切换并清空旧品种，照片是权威）；未收录 → 「按识别名填写」（breedId=unknown_mix、breedName=识别名，展示可读/功能走默认）或「选不确定品种」；识别中面板内遮罩防误触（spinner，复用品种百科页视觉语言）；重新打开面板重置识别结果；埋点 breed_recognize_start/success（source: add_pet）+ select_breed_recognized_unmatched。`add/index.scss` 新增识别入口/结果卡/遮罩样式。新增 `services/__tests__/breedService.test.ts` 5 用例（名称/别名/包含匹配、物种过滤、空输入）——此前 matchBreedInData 无任何测试。
- **验证**：typecheck 0 错误 ✅、全量 2376 passed / 0 failed（含新增 5 个）✅、eslint 0 新增问题 ✅、build:weapp 成功 ✅、dist 确认含 breed-recognize（breedService 在 sub-vendors 共享 chunk）✅、graphify 已更新 ✅；双 Agent 审查通过（P0=0，P1×2/P2×3 全部修复，见下）；改动未提交。
- **交互闭环**：不知道品种 → 拍照识别 → 一键选中（物种自动联动）→ 识别不出 → 不确定品种兜底 → 面板键盘抬升始终可见。与品种百科页识别共用同一接口与匹配逻辑。
- **双 Agent 审查结论**：**需修改 → 已全部修复**。①P1-1 后端 `/breed-recognize` 原只有全局限流（120/分），每次=1 次付费视觉 LLM → 新增 `aiRecognizeLimiter`（5 次/分，rateLimit.ts + ai.ts 挂载）；②P1-2 识别期间遮罩外 overlay 仍可关面板（付费请求发出但结果静默丢弃）→ `handleCloseBreedPanel` 加 `isRecognizing` 守卫；③P2-1 选图阶段防连点依赖平台失败不可靠 → `recognizingRef` 同步 ref 防连点（setIsRecognizing 提前到选图前）；④P2-2 AI 识别名自由文本落库无长度上限 → `createPetSchema.breed` 补 `.max(50)`；⑤P2-3 breedService 401/非 JSON 响应误提示"照片不清晰"→ 区分登录过期/服务异常文案。服务端 tsc + 938 测试全绿、小程序 tsc + 2376 测试全绿、build 成功。
- **遗留建议**：「按识别名填写」的 breedName 是 AI 自由文本，喂 AI 对话/生图时注意清洗（petPrompt 已兜底"不确定品种/混血/串串"）；识别入口与品种百科页共用接口，滥用面由 aiRecognizeLimiter 统一兜住。

### 2026-08-24 · 全家福生图参考图分级 + 默认头像去品种名（已提交已部署）

- **需求（用户）**：①全家福生图要分级——参考图必须是"真实形象"（用户上传的真实照片 avatar_photo_url / 基于真实照片生成的 AI 形象 avatar_cartoon_url），只有品牌默认头像（home-style 预设/兜底图）或没头像的成员，要先引导用户去生成真实形象，不能硬生成；②小猫默认头像不要标品种名字（那只是默认头像）。
- **根因**：全家福 `collectMemberPhotos` 用 `COALESCE(avatar_photo_url, avatar_cartoon_url)` 取参考图，不区分真实/默认——形象定制页"预设形象"保存时把品牌头像（本地 preset-home 资源）写进 avatar_cartoon_url，全家福会拿默认头像当参考图（生成的是默认卡通图而非真实小猫）；且 `avatar_style` 无法区分预设/文字生成/照片生成（都是画风 key，styleVariant 未落服务端）。
- **修复（后端权威分级 + 前端引导）**：①`familyPhotoService.ts` 新增 `isBrandPresetUrl`（URL 含 `/home-style/` 或 `/preset-home/` 判定为品牌默认头像）；`collectMemberPhotos` 分级过滤（photoUrl 只留真实形象，品牌 URL 置 null + `hasRealImage` 标记）；`generateFamilyPhoto` 校验：有成员无真实形象 → 400 + `code:'MEMBER_NO_REAL_IMAGE'` + `missingMembers`（不调用 Seedream 不浪费配额）；②`routes/familyPhotos.ts` 失败响应透传 code/missingMembers；③前端链路打通：`api.ts` 把 code/missingMembers 挂到 Error → `familyStore.generateAiPhoto` catch 透传 → `dashboard` 识别 MEMBER_NO_REAL_IMAGE 弹窗"去生成形象"（先 `switchPet` 切到缺形象宠物再 navigateTo avatar-customize，**不降级 Canvas**）；④预设形象卡 label 由品种名改为"预设 N"；⑤顺带修**「保存到相册」必失败既有 bug**：store 默认 `photoType='generated'` 与后端 schema（仅 canvas_fallback|uploaded）冲突 → 默认改 `canvas_fallback` + PhotoType 类型/mockApi 同步。
- **验证**：服务端 tsc 0 + 全量 938 passed（新增 isBrandPresetUrl 4 例 + 分级集成 2 例）；前端 tsc 0 + 全量 2371 passed + build:weapp ✅ + eslint 无新增；双 Agent 审查通过（P0=0，P1=2 已处理其一，见遗留）；graphify 已更新。
- **提交**：`e53ca17 feat(全家福): 生图参考图分级校验，无真实形象引导生成形象`（7 文件 +167/-9，分支 develop）。⚠️ 混改文件未提交：`familyStore.ts`/`familyService.ts`/`familyTypes.ts`/`mock.ts` 含本次改动（generateAiPhoto 透传、savePhoto 修复）与"家庭图谱人关系"未提交改动混在同一文件，留在工作区；`petPrompt.ts` 含并行会话"不确定品种"改动。
- **部署（已完成，无数据库迁移）**：上传 familyPhotoService.ts + familyPhotos.ts → 备份 `/opt/xinghuanhai/src.bak.photograde-*` → PM2 重启 → 冒烟全绿（health 200、日志无 error、生产实测 isBrandPresetUrl 品牌 true/真实 false + buildPrompt 回归）；部署记录已更新；回滚=恢复 src.bak.photograde-* 后重启。
- **遗留（用户已确认口径 2026-08-24）**：**真实形象 = 照片上传（avatar_photo_url）或 照片生成的专属形象（avatar_cartoon_url 且来源为照片生成）**；文字描述生成的 AI 形象不算真实形象。当前实现"非品牌 URL 即真实"会放行文字生成形象 → **下一轮实现严格化**：pet_profiles 加 `avatar_source` 列（text|photo|preset，迁移 028）或复用 avatar_generations 来源，前端保存形象时写入来源标记，collectMemberPhotos 按 avatar_source 判定。**待办（用户侧）**：微信开发者工具重新编译小程序（前端改动：dashboard 引导、预设卡去品种名、savePhoto 修复）→ 重新生成全家福。

### 2026-08-24 · 形象定制"文字描述生成"补输入框并接入生图（已提交 6966e99 已部署）

- **现象（用户）**：①形象生成为什么无法生成（免费用户文字生成为会员专享，页面只显示会员引导卡，且用户不知道免费路径）；②"文字描述生成"没有地方输入文字（确认 UI 缺失——Tab 名不副实，生成全程用宠物档案自动拼提示词，无用户描述参与）；③提示生成了但看不到在哪（候选列表"选择你喜欢的形象"在生成面板最底部，需滚动才可见，生成后无自动定位）。
- **修复**：①服务端 `avatarService.generatePetImageOptions` 新增 `description` 参数（清洗换行/截断 100 字后拼进各画风提示词：`${petSubjectText(...)}的头像，${用户描述}，...`）+ `routes/avatar.ts` generate-options 接收透传（生成记录 prompt 含描述）；②前端 `avatar-customize` 文字生成 Tab 新增描述 Textarea（placeholder 引导如"橘色英短，圆脸胖乎乎的"+ "只写外貌特征，不要写宠物名字"防「烧鸡」风险），`handleTextGenerate` 传描述；③生成成功后 `Taro.pageScrollTo` 滚动到候选列表（"生成成功，请选择喜欢的形象"后用户一眼看到 5 选 1）；④免费用户会员引导卡文案补免费路径提示（预设形象 / 照片生成 Tab 上传照片作头像）；⑤测试：后端新建 `avatarService.test.ts` 3 用例（描述拼提示词+清洗、无描述回退档案、全失败 null）+ 前端 `avatarService.test.ts` 3 用例（描述透传、无描述 undefined、失败 null）。
- **验证**：后端 tsc 0 + 全量 941 passed（新增 3）；前端 tsc 0 + 全量 2379 passed（新增 3）+ build:weapp ✅；graphify 待更新。
- **提交**：`6966e99 feat(形象): 文字描述生成补输入框并接入生图，候选结果自动定位`（7 文件 +187/-9，分支 develop）。
- **部署（已完成，无数据库迁移）**：上传 avatarService.ts + routes/avatar.ts → 备份 `/opt/xinghuanhai/src.bak.avatardesc-*` → PM2 重启 → 冒烟 health 200、进程 online、文件校验通过；回滚=恢复 src.bak.avatardesc-* 后重启。
- **待办（用户侧）**：微信开发者工具重新编译小程序后体验（AI 文字/照片生成均需会员；免费用户可走预设形象或照片 Tab 上传照片作头像）。

### 2026-08-24 · 形象定制页重构 + 形象库（已提交 4c19fe0 已部署，含迁移 028）

- **需求（用户）**：①删除页面冗余的"风格切换/表情系统"展示卡；②文字生成时让用户手动选择画风+表情，给参考提示词模板指引；③做"形象库"保存多次生成的形象，按风格/表情分类管理（用户确认：生成 1 张、服务端存储、12 种表情）。
- **实现**：①迁移 028 `pet_avatar_library`（**审查 P0：user_id 必须 UUID 对齐 users.id，TEXT 建外键必失败**——本地 PG18 实证；UNIQUE(pet_id,image_url) 防重复收藏）；②服务端 `generatePetImageOptions` 支持 `styleKey`（单画风生成 1 张）+ `expression`（`EXPRESSION_PROMPTS` 12 表情中文提示词）；generate-options 接收 styleKey/expression（白名单校验）+ **文字/照片配额口径拆分**（文字 style=`options-*-text-*` 不计入照片 3 次/月，`countMonthlyOptionsByUser` 排除 `%-text-%`）；新增 `/library` 三接口（POST 保存 / GET 查询 / DELETE 删除：宠物归属 `findByIdAndUser` + style 白名单 + imageUrl http(s) + expression 白名单）；③前端：删冗余卡；文字 Tab = 描述 + 参考模板 + 画风单选 + 表情单选 + 生成 1 张；结果区单张（存入形象库 / 设为当前 / 重新生成）；形象库卡（画风/表情筛选、点击设为当前、删除二次确认）；照片 5 候选补"存入形象库"；**`getAvatarLibrary` snake→camel 映射**（审查 P0：否则 imageUrl undefined → 图片空白 + 设为当前传 undefined 清空照片）；清理死样式/死代码/过时文案；④测试：服务端 avatarService.test.ts 6 例 + avatar.library.test.ts 10 例、前端 avatarService.test.ts 27 例。
- **验证**：后端 tsc 0 + 全量 954 passed；前端 tsc 0 + 全量 2385 passed + build:weapp ✅ + eslint 0 error；**双 Agent 审查：2 P0（迁移外键/字段契约）+ 3 P1（expression 白名单/配额口径/照片候选存库入口）全部修复**；graphify 已更新。
- **提交**：`4c19fe0 feat(形象): 形象库分类保存 + 文字生成选画风/表情生成单张`（10 文件 +1083/-362，分支 develop）。
- **部署（已完成，含迁移 028）**：迁移 028 建表成功（user_id uuid、索引、owner 移交 xinghuanhai）→ 备份 `/opt/xinghuanhai/src.bak.avatarlib-*` → 替换 3 文件（avatarRepository/avatarService/routes avatar）→ PM2 重启 → 冒烟 health 200、日志无 error、表行数 0；回滚=恢复 src.bak.avatarlib-* 后重启（表可留着）。
- **遗留**：①**avatar_source 严格化**（文字生成形象设当前后会被全家福当"真实形象"参考图，与已确认口径"文字生成不算真实形象"冲突——建议 028 下轮加 source 列或统一 avatar_source 迁移）；②形象库存的是 Seedream CDN 临时 URL（长期有效性问题待评估）；③归属口径：/library 与 generate-options 用 findByIdAndUser（仅主人），photo/upload 用 canAccess（家庭成员可用）——形象库对共管成员不可用（产品可接受则补注释）。**待办（用户侧）**：微信开发者工具重新编译小程序体验。

### 2026-08-24 · 画风扩展至 15 种 + 参考提示词模板公式化（已提交 e8c41b8 已部署）

- **反馈（用户）**：①画风应该不止这一点（提示词库有哪些）；②提示词参考模板太简约（对比视频生成提示词的复杂度）。
- **实现**：①服务端 `AVATAR_STYLE_OPTIONS` 5 → **15 种**（新增吉卜力/皮克斯3D/像素/水墨/油画/赛博朋克/极简北欧/低多边形/线稿/暗黑奇幻 10 种，每风格猫/狗描述融合《宠物回忆录-提示词库.md》§6/§7.1 风格关键词；VHS 复古/故障艺术对宠物头像效果难保证暂不收，需要可再加）；新增 `DEFAULT_STYLE_KEYS`（默认 5 画风池——照片生成等批量候选仍 5 张不放大成本，15 种只用于文字生成单画风选择）；②前端画风 chips 15 种 + 参考模板改为**提示词库式公式**：五字段说明（主体/外貌/表情/画风/氛围）+ 实时完整示例（拼接宠物品种+描述+表情提示词+画风关键词+`GEN_STYLE_ATMOS` 每画风光影氛围词+画质词）+ 「填入外貌+表情」一键按钮。
- **验证**：后端 954 + 前端 2385 测试全绿、tsc 双 0、build:weapp ✅。
- **提交**：`e8c41b8 feat(形象): 画风扩展至15种对齐提示词库，参考模板公式化引导`（3 文件 +170/-7，分支 develop）。
- **部署（已完成，无数据库迁移）**：上传 avatarService.ts（备份 `/opt/xinghuanhai/src.bak.styles15-*`）→ PM2 重启 → 冒烟 health 200、日志无 error。
- **待办（用户侧）**：微信开发者工具重新编译小程序体验（文字生成可选 15 种画风）。

### 2026-08-24 · 照片自动提取详细外貌进生图提示词（已提交 5758bcf 已部署）

- **反馈（用户）**："提示词描写怎么不详细，怎么就用橘色虎斑草草描述"——提示词库 §0.9 明确要求"每一个细节都描写，具体到眼神、身体动作"（§0.6 范例粒度：`成年金毛，金黄色卷毛，胸口白色斑块，戴红色皮质项圈+铜铃铛`）。
- **根因**：生图提示词的外貌信息只来自宠物档案品种 + 用户可选描述——档案里没有毛色/花纹等细节数据，用户不写就没有具体样貌。
- **实现**：①服务端 `extractPetAppearance`（复用 `visionService.analyzeImage` 的 DeepSeek 视觉模型，prompt 强制输出毛色/花纹/体型/脸型/眼睛颜色/鼻子/胡须/特殊标记，清洗去换行/截断 100 字）；`generate-options` 集成：**用户未写描述且宠物有真实照片（avatar_photo_url）时自动提取外貌**拼进提示词——只"读照片描述外貌"，不传参考图、不触发照片生成的会员配额（文字生成口径不变），提取失败降级档案描述；②前端：输入框 placeholder 改为详细示范（橘色虎斑英短，橙底深棕条纹，额头M纹，圆脸，琥珀色大眼睛，粉色鼻头，白色下巴胸毛）、公式区"外貌"字段多维引导、模板示例 fallback 详细化、提示"有真实照片留空自动提取"；③测试：`extractPetAppearance` 3 例（提取清洗/null 降级/抛错）+ 路由自动提取 4 例（有照片提取/用户描述优先/无照片跳过/提取失败降级）。
- **验证**：后端 961 + 前端 2385 测试全绿、tsc 双 0、build:weapp ✅。
- **提交**：`5758bcf feat(形象): 照片自动提取详细外貌进生图提示词，模板示例细节化`（5 文件 +144/-14，分支 develop）。
- **部署（已完成，无数据库迁移）**：上传 avatarService.ts + routes/avatar.ts（备份 `/opt/xinghuanhai/src.bak.appearance-*`）→ PM2 重启 → 冒烟 health 200、日志无 error。
- **待办（用户侧）**：微信开发者工具重新编译小程序体验（有真实照片时描述留空，系统自动提取毛色花纹等详细外貌进提示词）。

### 2026-08-24 · pet-prompt-engine 提示词技能（已提交）

- **需求（用户）**："把提示词库整理成一份标准的技能每次都能完整调用，无论是生图还是回忆录"。
- **实现**：①新建 `.dsh/skills/pet-prompt-engine/SKILL.md`——提示词库《宠物回忆录-提示词库.md》v5.0 的**可执行固化版**：触发条件（生图/全家福/表情包/回忆录必须加载）+ 六条金科玉律（名字不进提示词/外貌写具体 §0.9/数量锁定/参考图一致性/清洗兜底/中英混排）+ 生图公式八环节（每环节标注代码位置：petPrompt.ts / avatarService.ts / familyPhotoService.ts / promptTemplates.ts / avatar-customize）+ 四场景模板 + 15 画风/12 表情/角色锁定表/避坑清单（烧鸡事故沉淀）+ 修改指引 + 验证清单；②AGENTS.md 注册「提示词技能」小节：**凡是提示词任务先加载该技能，禁止各写各的**；提示词库原文仍为唯一事实源。
- **提交**：`docs(提示词): 新增 pet-prompt-engine 技能，提示词任务统一加载`（SKILL.md + AGENTS.md，分支 develop）。无部署。

### 2026-08-24 · 修复"邀请对方养宠点击没反应"（showModal 按钮文案超 4 字 + 剪贴板隐私拦截）

- **现象（用户）**：家庭页「邀请 TA」卡点击完全无反应（体验版+模拟器均复现，无弹窗无 toast）。用户 Console 提供决定性报错：`showModal:fail confirmText length should not larger than 4 Chinese characters`。
- **根因（两个独立问题叠加）**：①`handleInvite` 的 `Taro.showModal({ confirmText: '复制邀请码' })`——**5 个字超出微信 4 字上限**，参数校验直接 fail 且**弹窗不渲染**；此时邀请码其实已成功生成，只是展示环节炸了 → 表现为"点击无反应"。②工作区此前加的 fail 降级调 `setClipboardData` 又撞 **errno 112**（微信后台《用户隐私保护指引》未声明「剪贴板」权限，真机/体验版强制拦截、开发者工具不校验）→ 降级也静默失败。
- **修复（纯前端 2 文件）**：①`pages/family/index.tsx`：confirmText 改 `'复制'`（2 字）；抽出 `copyInviteCode` 统一复制入口并补 fail 处理（errno 112 时 toast 引导"长按邀请码手动复制"，弹窗 content 本身含完整邀请码，流程不中断）；②`pagesPet/family/dashboard/index.tsx`：全家福 MEMBER_NO_REAL_IMAGE 引导弹窗 confirmText `'去生成形象'`（5 字）同样会弹不出来 → 改 `'去生成'`（隐藏 bug 一并修）。
- **全局排查**：全项目 47 处 showModal confirm/cancelText 全部复查，其余均 ≤4 字合规 ✅；另有 7 处 setClipboardData 调用（settings/profile/feedback/product/invite/首页）在剪贴板权限声明前真机也会 errno 112，属同类隐患由后台声明一次性解决，未扩散修改。
- **验证**：tsc 0 错误 ✅、全量 2385 passed / 0 failed（EXIT=0）✅、改动行 eslint 0 新增（余量均为既有问题）✅、build:weapp 成功 ✅、dist 已确认含新文案且旧 5 字文案清除 ✅。改动未提交。
- **待办（用户侧 P0）**：mp.weixin.qq.com「设置 → 服务内容声明 → 用户隐私保护指引」补充声明**剪贴板权限**（与此前相册/相机同入口），否则真机上"复制邀请码"仍会失败（前端已兜底提示手动复制）；然后微信开发者工具重新编译即可看到邀请弹窗正常弹出。
- **第二轮补充（同日）**：①弹窗修复生效后用户实测仍报 `setClipboardData errno 112`——即上述待办未配置，属预期内，前端兜底 toast 已生效；②用户追问"哪里输入邀请码？"→ 排查证实**全 App 无任何页面调用 joinFamily**（store/service/生产接口齐全但 UI 层缺失），"生成邀请码 → 对方凭码加入"闭环断裂。**补全**：`family/index.tsx` 新增 `handleJoinByCode`（微信 showModal 原生 `editable` 输入框，Taro 3.6 类型表未收录 editable/placeholderText/content——展开透传+断言绕过，同 showNicknameAccessory 先例）→ `joinFamily`（内部刷新家庭列表/选中新家庭/拉宠物成员）→ 补拉 `fetchUsers` → 成功/失败均有反馈，失败透传服务端原因；空态页新增「🎟️ 凭邀请码加入」次级按钮（`.family-join-btn` 描边弱化样式）；邀请弹窗指引文案改为明确入口路径。**已知取舍**：已有自己家庭的被邀请方在非空态视图暂无输入入口（主场景=新用户空态，后续有需求再补）。验证=tsc 0 错误、2385 passed、eslint 改动文件 0 error、build ✅、dist 确认 editable+新文案 ✅。改动未提交。
- **第三轮补充（同日）**：用户实测反馈"前端根本没有地方输入邀请码"——其测试号**已建过家庭**，看到的是正常视图，而入口只在空态（上轮取舍正好踩中实际场景）。**补全**：家庭头部 ✏️ 旁新增同款式 🎟️ 小圆钮（复用 `family-head__edit` 样式，onClick 同 handleJoinByCode），**任何家庭状态下都有输码入口**（空态次级按钮 + 正常视图头部图标双入口）。验证=tsc 0 错误、全量测试通过、build:weapp 成功 ✅、dist 确认头部双按钮 + editable 输入框完整编译 ✅。改动未提交。**已知行为**：凭码加入成功后会自动切换到新加入的家庭；多家庭手动切换器暂无 UI（数据层 families 数组已支持），如需后续补。
- **第四轮补充（同日，用户指定位置）**：用户反馈头部 🎟️ 纯图标"一点标识都没有"且要求**把输入入口放进「共同养宠」区**。**调整**：①删除头部 🎟️ 小圆钮；②共同养宠成员横滑条尾部、「邀请 TA」卡左侧新增同款卡片「🎟️ 凭码加入 / 输邀请码」（复用 family-user-card 全套样式，全员可见不加 owner 条件——已在家庭的任何人都可能收到别家码）；③空态「凭邀请码加入」按钮保留（新用户唯一入口）；④邀请弹窗指引文案同步为「TA 在『家庭』页『共同养宠』区点『凭码加入』输入即可」。最终布局：成员头像 → 凭码加入 → 邀请 TA(owner)。验证=tsc 0/TEST_EXIT=0/BUILD_EXIT=0、dist 确认凭码卡+副文案+新指引文案全部编译 ✅。改动未提交。

### 2026-08-24 · 修复"宠物头像没同步到我的页" + 我的页顶部去双色横幅改沉浸式

- **现象（用户）**：①宠物头像并没有同步到我的页面；②我的页面顶部的双色模块太丑。
- **根因**：①「我的」页宠物切换 chips 只渲染物种 emoji（`species === 'cat' ? '🐱' : '🐶'`），从未读取宠物真实形象字段 `avatarPhotoUrl/avatarCartoonUrl`——形象定制页保存后 petStore 里明明有数据但页面不展示；且 mine 是 tab 常驻页只在首次挂载 `fetchPets`，切回时不刷新；②顶部用户卡是 `.mine-user-banner`（192rpx 橙色渐变横幅）+ 白卡头像 -96rpx 上叠的"两段拼接"结构，视觉割裂。
- **修复（纯前端 2 文件）**：①chips 渲染真实头像，优先级与全站一致（`avatarPhotoUrl > avatarCartoonUrl > 物种 emoji`，同 PetAvatar/PetSwitcher）；新增 `petAvatarFailed: Record<petId, 失败URL>`——仅当"当前 URL === 已失败 URL"才退回 emoji，同一坏地址不反复重试、换新地址自动重试；②`useDidShow` 增加 `fetchPets(user.id)`（在线以服务端为权威纠正 store；离线本地缓存与 store 同源无副作用；fetchPets 内部保留 currentPet 不会误切换）；③顶部重构为沉浸式头部 `.mine-hero*`：删横幅与白卡，头像/昵称直接坐在页面暖色渐变上（头像 136rpx 白描边 + 半透明白环 + 暖色投影），VIP 徽章/编辑按钮保留复用；顺带修该文件既有 eslint error（全局 `isNaN` → `Number.isNaN`）。
- **验证**：typecheck 0 错误 ✅、eslint 改动文件 0 error（余 2 个既有 warning 非本次引入）✅、全量 2385 passed / 0 failed（EXIT=0；另一轮出现 2 failed 系 vitest worker fork 崩溃的环境噪声，三轮中两轮干净通过与本次无关）✅、build:weapp 成功 ✅、dist 确认含 mine-hero + avatarPhotoUrl 且旧 banner 类名零残留 ✅、graphify 已更新 ✅。
- **效果图**：新旧对比 `E:\Codex\2026-08-24\mine-ui\outputs\mine-header-preview.html` + `mine-header-preview.png`（GLM-4V 质检通过：新版无双色拼接、头像光环自然、无布局错乱、chips 真实照片显示正常）。
- **待办（用户侧）**：微信开发者工具重新编译小程序后查看效果。改动未提交。

### 2026-08-24 · 全家福「精美场景模板」22 选 + 自定义场景 + 生图水印合规 B 方案（代码完成，待用户确认部署）

- **需求（用户）**：全家福缺少特定场景模板；且场景要精美不能太单一；要求先调研最新提示词写法一起决定。经结构化确认：迁移加 scene 列 ✅、卡内场景 chip 宫格（非 ActionSheet 堆叠）✅、22 场景目录 ✅、自定义场景输入 ✅、写实摄影感基调 ✅。
- **调研**：Seedream 4.0/Nano Banana/GPT Image 1.5 最新公式=时间光源+前中后景层次+材质细节道具+统一色彩基调+氛围情绪+光效质感词；场景层与画风层(STYLE_PROMPTS)正交，身份由参考图锁定。
- **服务端**：`familyPhotoService.ts` 重写 `FAMILY_PHOTO_SCENES`（22 键/5 大主题：居家4·自然6·节日4·旅行4·梦幻4，旧 starry 移除）+ `SCENE_PROMPTS` 全量多维描写；**修复关键 bug：generateFamilyPhoto 解构了 scene 却没传给 buildPrompt（选了也白选）**；`cleanCustomScene` 清洗（换行/制表符→空格、压缩空白、截断 60、纯空白视同未填）；INSERT 带 scene（默认 livingroom）+ description 存清洗后自定义文本；getFamilyPhotos 返回 scene/description；迁移 029 `family_photos ADD COLUMN IF NOT EXISTS scene TEXT`；schema 白名单提为具名导出 `FAMILY_PHOTO_SCENE_KEYS`（零依赖不变）供双向深比较。
- **水印合规 B 方案**（用户确认）：三个生图服务（全家福/表情包/形象）Seedream 请求统一 `watermark:false` 去平台「AI生成」标 + 新增 `services/imageBadge.ts` 用 jimp 在右下角合成自有角标素材 `assets/ai-badge.png`（451x93 半透明胶囊「AI 绘制 · 星河宠记」，宽 30% 留白 3%），落盘 `uploads/ai-generated/{uuid}.png` 返回 `{publicBaseUrl}/uploads/...`；任一环节失败降级返回原图 URL 只记日志不阻断。合规依据《人工智能生成合成内容标识办法》(2025-09-01)：提供用户关闭水印开关不合规；品牌角标为业界标准做法。
- **前端**：dashboard 生成卡新增「五大主题 tab + 场景 chips 宫格 + ✏️自定义」选择器（Textarea maxlength60、空描述 toast 拦截）；selectedScene 默认 livingroom；生成中文案显示「场景 X · 风格 Y」；相册 AI 照片（ai_generated/generated 且有 scene）带 emoji 场景标签；familyPhotoService.ts 前端常量（类型/标签表/FAMILY_PHOTO_SCENE_GROUPS）、familyService.generateFamilyPhoto(familyId,style,scene?,customScene?)、familyStore.generateAiPhoto 透传+乐观插入带场景、familyTypes PhotoType 补 `ai_generated`（后端真实枚举值）+ FamilyPhoto.scene；`fd-scene-*` 样式沿用橙金暖色语言。
- **双 Agent 审查**：有条件通过 → 已全部修复：**P1 场景过期闭包**（handleGeneratePhoto 的 ActionSheet 回调捕获旧渲染 selectedScene——改选海边首次生成却是客厅且文案迷惑性显示新场景；用 generateWithStyleRef 最新闭包引用模式修复）；P2 watermark:false 测试断言锁 + route→service scene/customScene 透传集成回归用例（INSERT 参数+prompt 双断言）+ 白名单双向集合相等锁 + **删除零引用 seedreamAdapter.ts**（防止未来复用绕过水印合规）；P3 fetch 加 AbortSignal.timeout(15s) 防挂起 + publicBaseUrl 缺失启动告警 + image2D 测试显式 mock 角标模块。
- **验证**：服务端 tsc 0 错误 + 全量 975 passed / 65 文件 ✅；前端 tsc 0 + 全量 2388 passed / 0 failed + eslint 改动行 0 新增 + build:weapp 成功 + dist 确认含 fd-scene-picker 与场景 key ✅；graphify 已更新 ✅。改动未提交。
- **遗留（审查记录在案）**：P2 角标降级时图片完全无标识且库内不可追溯（建议后续加 badge_status 或前端 UI 角标兜底）；形象库 imageUrl 必须 http(s) 而 PUBLIC_BASE_URL 缺失时角标返回相对路径会静默 400（本地/生产 .env 已配置该变量，暂不触发，已有启动告警）；PNG 隐式元数据标识（tEXt AIGC）未做；《办法》第十条隐式标识可后补。
- **待部署（用户确认后执行）**：①生产 psql 执行迁移 029（遇 owner 问题按规范 sudo -u postgres + ALTER OWNER）②服务器 `npm i jimp@0.22.12` ③上传 assets/ai-badge.png + src/services/imageBadge.ts + schemas/index.ts + routes/familyPhotos.ts + services/{familyPhotoService,image2DService,avatarService}.ts ④PM2 restart xinghuanhai-server ⑤冒烟：health 200 + 日志无 error + 实际生成一张图验证右下角角标与本站 URL ⑥小程序微信开发者工具重新编译体验。
- **效果预览**：E:\Codex\2026-08-24\xinghuanhai-scene-preview\outputs\christmas-family-badge.png（圣诞之夜+皮克斯风+角标实拍效果）

### 2026-08-24 · 形象定制页场景区简化：「头像/聊天贴纸」移除 → 「形象生成 / 分享形象」

- **需求（用户）**：形象生成页面的「头像」「贴纸」按钮没什么用，删掉，直接改成「形象生成」「分享形象」。
- **实现（纯前端 2 文件）**：①`pagesPet/avatar-customize/index.tsx`：删除 `handleApplyAvatar`（保存为头像）与 `handleSaveSticker`（聊天贴纸存相册）两个处理函数（grep 确认无其他调用方）；场景区三卡收敛为两卡——「✨ 形象生成」（onClick 切换 showPanel，**同时承担原独立「生成新形象」大按钮的面板开合职责**，文案随状态切换 收起面板/形象生成——原大按钮是面板唯一开关，直接删会导致面板打开后无处收起）+「📤 分享形象」（复用 handleGoShareCard 跳分享卡片页，仅改文案）；删除独立 `.avatar-gen-btn` 大按钮；页头结构注释同步更新；②`index.scss`：`.avatar-scenes` 三列→两列，删除死样式 `.avatar-gen-btn*` 与 `--gold` 图标变体。
- **验证**：typecheck 0 错误 ✅、全量 2388 passed / 0 failed（135 文件）✅、eslint 改动文件 0 error（余 8 个既有 warning 均在未触碰行；顺带 --fix 修掉 ref-fill 按钮既有 jsx-closing-bracket 格式 error）✅、build:weapp 成功 ✅、dist 确认含 形象生成/分享形象/收起面板 且 聊天贴纸/生成新形象 零残留（产物中文为 Unicode 转义，按转义串校验）✅、graphify 已更新 ✅。改动未提交。
- **说明**：轻量档任务（2 文件、非核心逻辑、无高风险关键词），按规范未启动双 Agent 审查，以调用点排查 + 全量测试 + 构建产物校验代替；`.scss` 传入 eslint 报 parsing error 为工具误报（项目 lint 不含 scss），非代码问题。
- **待办（用户侧）**：微信开发者工具重新编译小程序后查看效果。

### 2026-08-24 · 形象生成升级「一套两张」：头像 + 全方位角色设定图（代码完成，待用户确认部署）

- **需求（用户）**：形象生成只出头像不够——要做回忆录和全家福的参考图，需要全身形象；希望一次生成两张：一张头像，另一张是猫咪全方位描绘（正面特写、侧面、顶部、背面）。结构化确认：①不加照片上传位（已有参考图生图）；②文字+照片两条流程都改两张一套；③都进形象库，全家福优先用全方位图；④配额仍算 1 次。
- **服务端**：①迁移 030：`pet_avatar_library` 加 `view_type TEXT NOT NULL DEFAULT 'headshot'`（历史行自动归头像）、`pet_profiles` 加 `avatar_multiview_url TEXT`；②`avatarService.generatePetImageOptions` 重写为"一套两张"：新增 `buildMultiviewSheetPrompt`（四视图版式指令 左上正面特写/右上侧面全身/左下顶部俯视/右下背面全身 + "四个视图必须是同一只宠物…绝不是四只不同宠物"主体锁定特化话术 + 纯白背景），文字流=指定画风 1 套 2 调用、照片流=`PHOTO_SET_COUNT`=3 套 6 调用（原默认池 5 张）；容错=套内 Promise.all（头像必出、设定图 catch→null）、套间 allSettled，全失败才 null；③`avatarRepository.save` 改专用 UPSERT `ON CONFLICT (pet_id,image_url) DO UPDATE`（重复收藏幂等，修审查发现的"部分失败重试永远 500"循环）；④`/library` 接收 `viewType` 白名单 ['headshot','multiview'] 非法归 headshot 不拒绝；⑤pets 更新链路（schema/pets.ts/petRepository PetRow+allowedFields）支持 `avatar_multiview_url`；⑥全家福 `collectMemberPhotos` 参考图优先级改为 `COALESCE(avatar_photo_url, avatar_multiview_url, avatar_cartoon_url)`（真实照片>设定图>卡通头像）。
- **前端**：①service：`AvatarStyleOption.sheetUrl?` / `AvatarLibraryItem.viewType`（view_type 缺省兜底 headshot）/ `saveAvatarToLibrary` 第 5 参 viewType / 新增 `setMultiviewAsCurrent`（PUT body 仅 snake_case 单键 `avatar_multiview_url`，不清真实照片）；②页面：文字结果单卡下方固定设定图卡、照片流程改"3 套宫格选 1"+选中套下方预览设定图+📋 角标、存入形象库一次存两条（headshot+multiview）toast 按结果四态、形象库第三行类型筛选（🖼️头像/📋设定图）+类型徽章（点击即筛选）、设为当前按类型分流（multiview→写 avatar_multiview_url 提示"已设为参考图"；headshot→原 cartoon 流程）、文案"生成风格形象（3 套）"；③PetProfile 补 `avatarMultiviewUrl?: string`。
- **双 Agent 审查：双双有条件通过 → 放行条件已全部当轮修复**。服务端 P1 配额标签按"是否真用参考图"判定（原按 styleKey：无图+非法 key 错扣照片额度/有图+合法 key 记 -text- 绕月限，本次 6 调用放大成本）→ `photoUrl ? '-photo' : '-text-'`+2 条路由测试；P2-1 头像提示词 `PET_IDENTITY_KEEP` 条件化（无参考图不写"以参考照片为准"，金科玉律 #4）；P2-2 设定图画风关键词 `.replace(/头像/g,'形象')`（防与四视图指令打架）+ 有参考图时补一致性话术。前端 P1 toast 四态按 okHead/okSheet 判定（原判定键反了会显示与现实相反的文案）+UPSERT 根治；P2 照片流剩 1 套误入文字单张分支出现死按钮 → 分支条件加 `activeTab==='text'` 且显式传 styleOptions[0]；PetProfile 类型缺口。P3 记录延后：入库表情元数据取控件状态（已顺手修 targetOption 时 expression=null）、multiview 设参考图吞错假成功面（与既有离线兜底模式一致待产品确认）、view_type 无 CHECK、6 路并发 Seedream 无超时、"非品牌即真实"在 multiview 列延续 avatar_source 遗留。
- **验证**：服务端 tsc 0 + 全量 **983 passed**（975→983，含配额标签/身份锁定/UPSERT 幂等/viewType 白名单/COALESCE 优先级契约锁）；前端 tsc 0 + 全量 **2392 passed** + build:weapp ✅ + dist 确认含 multiview/viewType/sheetUrl；eslint 改动文件仅余既有 2 error（vi.hoisted shadow/import-first，改动前后同位）。graphify 已更新。改动未提交。
- **待部署（用户确认后执行，⚠️ 迁移 029+030 与场景/水印改动一并上）**：①生产 psql 迁移 029+030（owner 问题按规范 sudo -u postgres + ALTER OWNER）②服务器 npm i jimp@0.22.12 ③上传 assets/ai-badge.png + src/services/{imageBadge,familyPhotoService,avatarService,petPrompt?}.ts + repositories/{avatarRepository,petRepository}.ts + routes/{familyPhotos,avatar,pets}.ts + schemas/index.ts ④PM2 restart xinghuanhai-server ⑤冒烟 health 200+日志无 error+实际生成一套验证两张+角标 ⑥**发版顺序硬性约束：新后端+迁移必须先于/同批于小程序前端发版**（否则 GET 形象库静默变空、POST 存入失败、PUT 设参考图假成功三连）。⑦用户微信开发者工具重新编译体验。
- **遗留/后续**：回忆录视频管线接入设定图（memoirProcessor 用用户选的 source_photos，本轮不动视频管线；后续把设定图加入可选素材或自动优先）；avatar_source 严格化时把 multiview 来源一并收口；Seedream CDN 临时 URL 长期有效性问题延续。

### 2026-08-25 · 名字→外貌+方位翻译层（全家福成员排位 + 自定义文本宠物名自动转译）

- **需求（用户）**：用户必然用名字沟通座次/互动（"烧鸡在左边、烧鸭在右边"），但不能把名字给生图模型（金科玉律 #1）——方案=两层翻译，用户用名字说话，系统翻译成"外貌+方位"再进提示词。
- **第一层 排位**：①服务端 `generateFamilyPhoto` 增 `memberOrder?: string[]`（schema 驼峰 `memberOrder` uuid 数组 max20；**必须在 memberNames/photoUrls 取值之前 sort**，稳定排序未提及者追加）；`buildPrompt` 多只时改写「从左到右依次是：…」+ 有参考图时补「参考照片的顺序与画面从左到右的宠物顺序一一对应」；②FE dashboard 生成卡新增「🪑 排个座次」成员卡（头像+名字+‹›箭头交换顺序，名字只在 UI 显示）+ `fd-order*` 样式；store/service 第4参透传。
- **第二层 转译**：`petPrompt.translatePetNames(raw, pets)`——已知宠物名替换为「那只英短猫咪」（单只）/「左起第N只{品种}{物种}」（多只，序号=数组顺序即座次）；长名优先替换防子串误伤；空名/>20字跳过；复用 petSubjectText 品种兜底。挂载点三处：全家福 customScene（**入库 description 存用户原文，仅提示词用转译后文本**）、avatar generate-options description、background-swap customBackground（路由层做，单宠流程只译当前宠物名）。
- **测试坑实录**：①once-mock 按注册顺序消费，INSERT 用 implementationOnce 前不能再排 resolvedValueOnce（会把捕获槽挤到角标 UPDATE 上）；clearAllMocks 不清实现也不清 once 队列，残留会级联污染后续用例（mockResolvedValue(null) 泄漏→503；多余 once→isOwner 读 undefined rows 报错）；②前后端字段名契约：zod 默认剥离未知键，FE 发 snake_case `member_order` 被静默丢弃排序失效——必须驼峰 `memberOrder`，server 测试夹具同步（uuid 校验需真 UUID 格式）。
- **验证**：服务端 tsc0 + 全量绿（petPrompt 转译 4 例 + buildPrompt 从左到右例 + familyPhotos 集成排位/转译 2 例 + avatar bgswap 转译例）；前端 tsc0 + 全量绿 + build✅ + dist 确认含 memberOrder/fd-order/排个座次；graphify 已更新。改动未提交，并入既有待部署批次（无新增迁移）。

### 2026-08-24 · 照片生成对齐文生图（15 画风+表情单选）+ 2D/3D 进度卡改一行轻提示

- **需求（用户）**：①删掉照片生成下面的 2D/3D 进度条（经结构化确认选"换成一行轻提示"方案——直接删干净会让付费生成盲等且失败无感知）；②"风格等等都要更新 跟文生图一样"。
- **实现（前端 3 文件 + 服务端 2 文件 + 测试，基于并行会话"一套两张"最新代码之上）**：
  - 前端 `avatar-customize/index.tsx`：①2D/3D 两块 `GenerationProgress` 重进度卡替换为 `.avatar-customize__task-hint` 一行轻提示（生成中=⏳ 小字；失败=红字可点重试，复用 handle2DRetry / task3D.retry），组件 import 移除；②照片 Tab 原 cartoon/realistic 两卡选择器整块删除（STYLE_OPTIONS 常量删除），替换为与文字 Tab **完全同一套** GEN_STYLES 15 画风 chips + GEN_EXPRESSIONS 12 表情 chips（含"无"）；③`photoStyle` 放宽 string 默认 'q'、新增 `photoExpression`；`handleGeneratePhotoOptions` 改传 `styleKey+expression`（基调参数固定 'cartoon' legacy 口径）→ 与文生图一致**按所选画风生成 1 套**（头像+全方位设定图，服务端 styleKey 分支），成功 `setSelectedStyleIndex(0)`；按钮文案「生成风格形象（3 套）」→「按所选画风生成形象」，会员引导文案同步；④结果单张分支守卫从 `length===1 && activeTab==='text'` 放宽为 `length===1`——原审查约束防的是"批量剩 1 张无选中态死按钮"，现两条流程单张均显式下标 0 无死按钮；单卡画风/表情标签按 Tab 取值；⑤`AvatarCustomization.style` 类型放宽 string（服务端 avatar_style 本是 z.string() 自由串，历史 cartoon/realistic 兼容共存，grep 证实无消费方做枚举分支）；⑥index.scss 新增 task-hint/--error 样式。
  - 服务端 `routes/avatar.ts`：新增 `VALID_2D_STYLES` 白名单（VALID_STYLES 两档 + 15 种画风 key）**仅用于 /generate-2d**（legacy /generate 与 generate-options 的基调白名单不动，避免 key 泄进旧中文提示词模板）；`image2DService.ts`：`STYLE_TEXT_2D` 映射表（17 键含兜底）替换原二元三元式，关键词与提示词库 §六同源。
- **行为变更说明**：照片流从并行会话"一套两张"的默认池 3 套（6 调用）变为指定画风 1 套（2 调用）——AI 成本降 3 倍/次，由用户"跟文生图一样"需求驱动；不传 styleKey 的批量路径服务端保留未动。
- **验证**：小程序 tsc 0 ✅、eslint 0 error（余 8 既有 warning）✅、全量 **2392 passed** ✅、build:weapp ✅、dist 校验新文案全在（按所选画风生成形象/选择表情/生成中/点击重试/task-hint 样式）旧文案零残留（卡通风格卡/写实风格卡/生成风格形象）✅；服务端 tsc 0 ✅、全量 **986 passed**（983+新增 3：ghibli 映射进提示词/未知画风兜底/legacy realistic 保留）✅；graphify 已更新 ✅。改动未提交。测试首版踩坑：mockFetch.calls[0][1] 是 requestInit 对象不是 body 字符串，JSON.parse 需取 `.body`（已修，18/18 过）。
- **待部署（并入"一套两张"/场景水印批次一起上，⚠️ 发版顺序硬性约束同前：新后端先于/同批于前端发版）**：上传 routes/avatar.ts + services/image2DService.ts → PM2 restart xinghuanhai-server → 冒烟 health 200；用户侧微信开发者工具重新编译体验（照片 Tab 选画风+表情→生成一套两张）。

### 2026-08-24 · 文生图收敛：回归单张头像 + 背景换景 8 选 + 照片 Tab 参考照片小贴士

- **需求演进（用户三轮）**：①"这些（参考照片挑选技巧）需要提示用户"；②"突然觉得文生图好像没太需要这个功能"→ 文字生成没有参考图，四视图设定图全靠想象，作为回忆录/全家福角色参考价值低还翻倍生图成本 → **设定图收敛为照片流程专属，文字生成回归单张头像**；③"文生图能不能做背景更换？"→ 能，纯提示词层实现；④命名讨论：用户提议改叫「背景替换」→ **不建议**（该 Tab 核心是生成新形象，叫背景替换会让用户误以为保留原图只换景，预期落差），如要改名建议「创意生成」；真·背景替换（从形象库选已有形象 img2img 保角色换景）列为后续可做。
- **服务端**：①`generatePetImageOptions` 设定图调用条件化 `params.photoUrl ? call : null`——文字流 1 次调用、照片流每套仍 2 次；JSDoc 同步；②新增 `AVATAR_BACKGROUND_OPTIONS`（8 种：sky☁️/sakura🌸/grass🌿/christmas🎄/birthday🎂/beach🌊/night🌙/cozy🧶，中文多维描写对齐提示词技能 §场景公式）+ `AVATAR_BACKGROUND_PROMPTS` 映射；提示词尾部 `${bgText || '干净背景'}` 替换式拼接（非法 key 兜底默认）；**设定图不受影响恒纯白**（参考图价值在精确记录外貌，不能被场景污染）；③路由 generate-options 接收 background 白名单透传 + prompt 记录含背景。
- **前端**：①service `generateAvatarOptions` 第 7 参 background 透传；②文字 Tab 表情下方新增「选择背景（可选）」chips（默认+8 种，复用 gen-chip 样式零新 CSS）；③照片 Tab 上传区下新增 `.avatar-customize__photo-tips` 小贴士卡（自然光/清晰/正面五官/**尽量全身入镜**——设定图侧面背面视角靠它推断/背景干净单只/避免糊片蜷睡强滤镜 + "直接用此照片作头像免费且文字生成全家福受益"引导）；④入库 toast 文案：文字流不再显示"（仅头像）"后缀（本就只有头像，避免困惑）。
- **测试**：服务端 avatarService 文字流断言改为 1 次调用 sheetUrl=null + 四视图/表情用例补 photoUrl + 新增背景替换与非法 key 兜底 2 例；路由库测 mock 补 `AVATAR_BACKGROUND_PROMPTS` 导出（**教训：给被 mock 模块加新导出时，所有 vi.mock 工厂必须同步**，否则路由引用即 500）+ 背景白名单透传 1 例（X-Forwarded-For 分桶 .12/.13）；前端 service 3 处精确 body 断言补 background 字段 + 新增 sakura 透传例。
- **验证**：服务端 tsc 0 + 全量 **990 passed**；前端 tsc 0 + 全量测试 0 failed（2394）+ build:weapp ✅ + dist 含背景 key（sakura 命中页面产物）。改动未提交。graphify 已更新。
- **部署**：并入既有待部署批次（迁移 029+030 + jimp + 多文件上传 + PM2 重启），无新增迁移；发版顺序硬约束不变（新后端先于/同批于小程序前端）。

### 2026-08-24 · 真·背景替换上线（图生图保角色换景，代码完成待部署）

- **需求（用户）**："要真背景替换"——不是文生图换景，而是从已有形象选一张，AI 保持宠物完全不变、只把背景换掉。
- **服务端**：①`avatarService.generateBackgroundSwap({petId,species,breed,imageUrl,background})`：以用户选定源形象为参考图走 `callSeedream` 图生图（watermark:false+角标复用既有链路）；提示词按技能 §角色锁定=「以这张{品种}的照片为准…毛色/花纹/体型/五官/姿态与参考图完全一致，不改变外貌，不增减数量」+「仅将背景更换为：{AVATAR_BACKGROUND_PROMPTS}」+ 只出现这一只 + 边缘干净自然；非法背景 key 双保险不发请求；②路由 `POST /api/avatar/background-swap`（authMiddleware+generateLimiter）：petId 归属 findByIdAndUser、imageUrl 必须 http(s)、background 白名单否则 400、会员校验 MEMBER_ONLY；配额口径 `style='options-cartoon-text-bgswap'`（单次调用成本同文字流，-text- 不占照片月限）；createGeneration/markCompleted·Failed 全记录。
- **前端**：①service `backgroundSwap(petId,imageUrl,background)`；②生成面板新增第三 Tab「🌈 换背景」：第一步源形象横滑卡（当前形象 avatarCartoonUrl + 形象库全部条目，选中金框）→ 第二步 GEN_BACKGROUNDS 8 背景 chips → 「开始换背景」按钮（未选源/背景或进行中置灰，文案"换背景中…"）→ 结果卡（预览 + 💾存入形象库 / ✅设为当前形象[复用 saveAvatarCustomization cartoon 流程 styleVariant='bgswap'] + "不满意换个背景再来"提示）；非会员显示专享引导卡；空态引导先生成形象。③形象库归类 `style='bgswap'`：服务端 /library style 白名单追加 'bgswap'、前端 GEN_STYLE_LABELS 加 bgswap:'换背景'（库标签显示用，不进画风 chips 筛选行）。
- **测试**：服务端 service 用例断言参考图透传/角色锁定话术/仅换景/名字不进 prompt/非法背景不发请求；路由 4 用例（成功透传+bgswap 配额标签+markCompleted、400×2 不触服务、失败 503 markFailed）+ bgswap 入库白名单例；FE service 透传/失败 null 例。教训沿用：被 mock 模块新导出必须同步 vi.mock 工厂（generateBackgroundSwap 已同步）。
- **验证**：服务端 tsc 0 + 全量测试绿（995 passed）；前端 tsc 0 + 测试全绿 + build:weapp ✅ + dist 确认 background-swap 在 sub-vendors 共享 chunk；graphify 已更新。改动未提交。
- **部署**：并入既有批次（迁移 029+030 + jimp + 多文件上传含 routes/avatar.ts + services/avatarService.ts + PM2 重启），无新增迁移；发版顺序硬约束不变。
- **同日补充：自定义背景描述**（用户"背景除了我们提供的之外 还要允许用户自己写提示词 然后我们帮他锁定角色不变"）：①服务端新增导出 `cleanCustomBackground`（对齐全家福 cleanCustomScene 口径：换行/制表符→空格、压缩空白、截断 60、纯空白视同未填）；generateBackgroundSwap 增 `customBackground?` 参数，**自定义优先于预设 key**，两者皆空不发请求；路由接收 customBackground 与预设二选一（均缺省 400'请选择预设背景或填写自定义背景描述'），createGeneration prompt 记录"自定义-{文本}"；角色锁定话术不变（保宠物完全不变仅换景）。②前端换背景 Tab 背景 chips 下新增 ✏️ 自定义 Textarea（maxlength60，placeholder 示例"铺满落叶的秋日森林小径，午后暖阳穿过树叶洒下光斑"+ 提醒不要写宠物名字；非空时提示"优先于上方所选预设"）；按钮可用条件放宽为 (bgSwapBg || bgCustom.trim())；service backgroundSwap 第 4 参 customBackground。③测试：service 自定义清洗/截断/优先级/皆空不发请求例 + 路由 customBackground 透传与双缺省 400 例 + FE 透传例；**截断边界注意**：60 字=前缀+空格+50 个填充字，断言曾差 1 字失败。mock 教训再现：cleanCustomBackground 也必须同步进 vi.mock 工厂。验证：服务端 tsc 0+全量绿、前端 tsc 0+全量绿+build✅+dist 含 customBackground；graphify 已更新。

### 2026-08-25 · 修复"时光足迹里的记忆打不开"（生成条目点击是死胡同）

- **现象（用户）**：时光足迹（`pages/timeline/index.tsx`）里的记忆无法打开。经结构化确认症状=系统生成条目点不开。
- **根因**：时光线列表混两类条目——①用户手动添加的真实回忆（pet_moments，有 sourceId）→ 点击开详情弹窗 ✓；②档案/打卡生成的条目（生日🎂/加入家庭🏠/体重记录⚖️/日常记录📝/健康预警🚨，无 sourceId）→ `handleEventClick` 只弹「查看：xxx」toast 就没了，而这类条目恰是列表里最多的 → 用户感知"记忆打不开"。这些生成条目本就有完整标题/日期/描述，纯 UX 死胡同非数据缺失。
- **修复（纯前端 1 文件 1 函数）**：`handleEventClick` 删除 sourceId 分流与 flashback toast 分支，**所有条目统一点开详情弹窗**（弹窗复用既有 `timeline-detail-modal`）；删除按钮仍由 `detailEvent.sourceId` 门控（归属校验在 handleDeleteMoment 内不动）——查看权限与删除权限分离。
- **验证**：tsc 0 ✅、改动文件 eslint 仅余 5 个既有问题（stash 基线对比证实 2 error+3 warning 均在未触碰的 useEffect 数据加载处）✅、全量 2395 passed ✅、build:weapp ✅、dist 校验旧「查看：」/「回顾…年前」toast 零残留+详情弹窗与删除按钮文案在 ✅、graphify 已更新 ✅。改动未提交。
- **待办（用户侧）**：微信开发者工具重新编译后，点生日/体重记录等任意条目即可看完整内容；手动添加的回忆照旧可查看+删除。

### 2026-08-25 · 修复"AI 润色 503"（thinking 吃光 token 预算，已提交前部署完成）

- **现象（用户）**：时光足迹添加回忆的 AI 润色按钮报错，Console：`POST /api/timeline/ai-polish 503`。
- **排查链**：①路由 503 只有两个分支=chat 返回空串或未配置占位串；②生产日志实锤同一用户 02:27:51 成功（1.5s）→ 02:28:18/42 连续两次 503（4s+），无 `[Timeline AiPolish Error]`（排除 500 抛错分支）；③`.env` 有 `AI_API_KEY`（旧组 DeepSeek，模型 deepseek-v4-flash），排除未配置；④生产同参复现：简单输入 3/3 成功，长草稿 6 连发抓到 1 次 `finish=length、tokens=400 打满、reasoning 512 字符`——**deepseek-v4-flash 思考模式默认开启，思考吃光 max_tokens=400 时正文零 token → 空串 → 503**，间歇性由单次思考长度决定。
- **修复（服务端 2 文件）**：①`routes/timeline.ts` 润色调用加 `thinking: 'disabled'` + max_tokens 400→800（对齐 visionService/feedingAi 等新服务"关闭思考保正文"口径，润色是简单改写不需要推理）；②`__tests__/timeline.test.ts` 新增回归锁用例（断言 chat 必须带 thinking disabled + max_tokens 800）。
- **验证**：tsc 0 ✅、timeline 20/20 ✅；生产 API 实测 thinking disabled 六连发 reasoning 全 0、finish 全 stop、正文全非空 ✅；全量套件 5 failed 经 stash 基线对比证实均为并行会话"背景替换"工作区既有失败（avatar.library 1 + familyPhotos 4），与本改动无关 ✅。graphify 待更新。
- **部署（已完成，无数据库迁移，用户确认后执行）**：备份 routes/timeline.ts 到 `/opt/xinghuanhai/src.bak.aipolish-20260825024113` → scp 上传 → PM2 重启 online → 冒烟 health 200、ai-polish 无 token 401 路由存活、重启后日志无 error；部署记录已更新；回滚=恢复 src.bak.aipolish-* 后重启。
- **遗留建议**：`routes/ai.ts` 4 处、weeklyReportService、memoryService、qualityCheckService 等**老调用点同样没关 thinking**（token 预算 300-800 不等），存在同类间歇性截断/空响应风险，建议下轮统一收口 thinking 口径；PM2 启动日志持续提示"旧 AI_API_KEY 语义，建议迁移 ARK_*"。

### 2026-08-25 · 视觉模型全项目盘点 + 补配 QUALITY_CHECK_API_KEY（视觉能力从"一直降级"到正式激活）

- **用户问题**："我们项目总的一个视觉模型的配置"——盘点发现**生产/本地 .env 均未配置 `QUALITY_CHECK_API_KEY`**，visionService 自上线起永远命中"未配置降级"分支：AI 写描述实际一直返回 503「AI 视觉能力未配置」、照片自动提取外貌静默降级档案描述（此前"提示词草草描述"的隐藏原因之一）、回忆录视频抽帧质检同样降级。
- **项目视觉模型全景**：①**visionService 统一识图底座**=DeepSeek 官方 `deepseek-v4-flash-vision-exp`（QUALITY_CHECK_* 组，temp 0/max_tokens 500/thinking disabled/30s 超时/禁止回落主 AI key 防跨厂商混配）→ 消费方：AI 写描述、extractPetAppearance 照片提取外貌、healthReportService 体检报告识别；②**百炼多模态 bailianChat**=`BAILIAN_API_KEY` @ dashscope compatible-mode，模型 `BAILIAN_VISION_MODEL`（生产已配）默认 qwen3.6-plus → 消费方：品种识别 /breed-recognize；bailianASR 语音同组；③**qualityCheckService** 回忆录视频抽帧评分直用同一 qualityCheck 组；④相邻非识图：Seedream 生图/Seedance 图生视频的 image_url 输入、Meshy 3D。
- **处置（用户确认后）**：服务器上从主 AI_API_KEY 复制同值写入 QUALITY_CHECK_API_KEY（同为 DeepSeek 官方账号无混配风险）。**交叉验证法定位首次追加失败**：T1 主key+vision-exp=200（证明账号有该模型权限）、T2 复制key=401 且 source 后 len=0 → od 十六进制查 .env 尾部发现 printf 追加损坏只剩残片。修复=改用 **scp 脚本文件执行**（绕开 ssh 多层引号）：清脏行+tr 剥 CR 引号+三重校验 FILE_LINE_OK/SOURCE_OK(与主 key 同值)/HEALTH=200 全过；真实识图冒烟 http=200 返回图片内容 ✓。
- **部署记录已更新**；备份 `.env.bak.viskey-*` 两份；回滚=恢复备份后 restart。**教训沉淀：往服务器 .env 追加内容禁止 ssh 内嵌 printf/heredoc，一律 scp 脚本文件执行+source 校验**。
- **效果**：AI 写描述即刻可用（无需小程序重新编译）；照片自动提取外貌开始真实生效（生图提示词将带上照片里的毛色花纹细节）；体检报告识别激活。

### 2026-08-25 · 四批次合并部署上线（含生产 ESM 崩溃事故与修复）

- **范围**：用户确认"部署"→ 一次上齐四个待部署批次：①全家福 22 场景+水印 B 方案（迁移 029 + jimp + imageBadge）②形象一套两张（迁移 030）③名字→外貌翻译层④品种知识库（迁移 031 + /api/breeds/knowledge 热更新接口）。
- **执行**：迁移 029/030/031 全部 ✓（031 owner=xinghuanhai）；tar 落盘→scp→远端解压上传 20 文件；npm install 装 jimp@0.22.12；备份 src.bak.batch0825-20260825041703。
- **⚠️ P0 事故与修复**：首次启动崩溃循环——`imageBadge.ts` 用 `__dirname`，生产 ESM 下不存在（本地 vitest CJS 转换全绿测不出）。改 `fileURLToPath(import.meta.url)` 推导（同 breedRepository 模式），单文件 scp 热修后恢复。**教训：新增模块凡用 `__dirname` 必须 ESM 兼容写法；vitest 全绿≠生产可启动。**
- **冒烟全绿**：公网 health/breeds-knowledge 双 200（品种库 version 2026-08-25.1，110 品种带来源标注）；background-swap 与全家福 POST 无 token 均 401；进程 online 稳定无新报错。
- **待办（用户侧）**：微信开发者工具重新编译小程序（前端 dist 已含全部新功能：排座次/换背景/场景模板/品种热更新）；实际生成一张全家福验证角标+座次生效。

### 2026-08-25 · 执行 2026-08-22 决定：关闭 3D 模块（配额归零 + 藏入口，代码完成待部署）

- **背景**：用户指出"之前有把 3d 模块移除的决定"——查证 `01-产品文档/功能分级与竞品分析-2026-08-22.md` 确有记录（3D 需求未验证 + Meshy ~1-3 元/个，决定"上线首版关闭（feature flag 或配额归零），验证需求后再开"，烧钱功能清单含「3D 关闭」）；但**代码从未执行**：`MEMBER_3D_MONTHLY_LIMIT` 一直 = 3，会员仍可生成、Meshy 照常扣费。此前会话删的只是照片生成 Tab 的 2D/3D 进度条卡片 UI。
- **方案（用户三选一确认）**：配额归零 + 藏入口（否决"彻底移除代码"与"暂不处理"）。改动最小且符合原决定机制，验证需求后一行改回即可重开。
- **实现**：①服务端 `routes/avatar.ts`：`MEMBER_3D_MONTHLY_LIMIT` 3→0（注释引决定文档+恢复方法）；403 分支区分 `FEATURE_DISABLED`（limit=0 时文案"3D 模型功能暂未开放，敬请期待"）与既有 `QUOTA_EXCEEDED`（防出现"已用完（0 次/月）"怪文案）；/quota 对会员自动返回 limit 0；②前端 `components/PetAvatar/ImageGallery.tsx`：新增 `show3DEntry` prop **默认 false**——「生成 3D 模型/会员专享」按钮整体隐藏（默认关语义防未来新调用点意外复活入口；avatar-customize 无需改动）；历史已生成的 3D 模型仍可经 task3D restore + Model3DViewer 查看/下载不受影响；handleGenerate3D 兜底保留（直调 API 也会被服务端 403 拦截）。
- **回归锁**：新增服务端 `routes/avatar.generate3d.closed.test.ts` 2 用例（会员调 generate-3d 必须 403 FEATURE_DISABLED 且不建任务不调 Meshy；/quota 对会员 generation3D.limit===0 契约锁）；更新 `ImageGallery.test.tsx`（默认隐藏断言 + show3DEntry=true 行为用例共 15 个全过）。
- **验证**：服务端 tsc 0 ✅ + 全量 1014 passed / 67 文件 ✅（983→1014 含并行批次新增）；前端 tsc 0 ✅ + ImageGallery 15/15 ✅ + 全量 135 文件 passed ✅ + build:weapp 成功 ✅；graphify 已更新 ✅。改动未提交。
- **部署口径**：服务端 routes/avatar.ts 需上传生产（⚠️ 并行批次刚上传过该文件的旧版本——本地工作区文件已含双方全部改动，直接传当前版即安全超集）；前端随下次发版生效（微信开发者工具重新编译后入口消失）。
- **恢复路径**：需求验证后①avatar.ts 配额改回正数②ImageGallery 调用处传 show3DEntry={true}③同步 closed 回归锁断言。
### 2026-08-25 · 品种知识库热更新（服务端权威）+ 全量来源标注与译名校对

- **需求（用户"1 2都做"）**：①品种特征数据真实性核查后，给 110 条品种数据补来源标注并修正个别译名；②把品种库搬到服务端做热更新（像医学图谱那样不发版修订数据）。产品定位不变：科普引导+参数兜底，非诊疗依据。
- **服务端（复刻 knowledge_graphs 热更新模式）**：①迁移 031 `breed_knowledge`（id/version UNIQUE/data JSONB/created_at）；②`BreedKnowledgeRepository`（getLatestBreeds 空表惰性播种种子 `src/data/breedSeed.json` + ON CONFLICT 防并发；saveBreeds 版本递增 同日.n+1 跨日.1 全量替换语义）；③routes/breeds.ts：GET `/api/breeds/knowledge` 公开下发（503 由前端静态兜底）、GET/PUT `/api/admin/breeds`（adminAuth + isValidBreedData 结构校验：breeds 非空且每条 id/name/species(cat|dog)/sources 非空字符串数组，坏数据拒绝上线）；④schemas 加 adminBreedSchema；⑤测试 breeds.test.ts 8 例（下发/播种参数含种子/DB 异常 503/Token 403/版本递增 .2/缺 sources 400/结构校验边界）。
- **前端**：①breeds.ts 加切换层 `getActiveBreeds()/setActiveBreeds()`（复刻 setActiveGraph 模式），BreedItem 接口加必填 `sources: string[]`，文件头加数据性质声明（一般性兽医常识+权威源交叉印证，非逐字引用非诊疗依据）；②breedService.syncBreedKnowledge：拉取→isValidBreedList 校验→setActiveBreeds+缓存（xhh_breed_knowledge）→失败降级缓存→静态兜底，返回是否切换；③消费方 BREED_DATA 全部替换为 getActiveBreeds()（breed/breed-detail/add/edit/checkin/trends 共 6 页面），全仓 BREED_DATA 渲染引用清零；④同步触发点=品种百科页挂载、品种详情页二段式渲染（先兜底立即渲染再热替换 fresh!==found 引用比较）、添加宠物页挂载；⑤刷新信号 breedDataVersion 递增驱动 useMemo 重算（breed 页 filteredBreeds / add 页 filteredBreeds，void 引用防 exhaustive-deps warning）。
- **数据校对（方向①）**：①全量 110 条注入 sources——基础集按物种（犬 AKC/VCA/Merck，猫 CFA/International Cat Care/VCA/Merck）+条件集（有遗传病补 UC Davis VGL/OMIA，有毒物清单补 ASPCA 中毒控制），标注口径="本条常识可在以上权威来源交叉印证"；②译名修正 3 处：沙特儿猫→沙特尔猫（Chartreux）、内华达猫→尼比龙猫（Nebelung）、肯尼亚猫→索科凯猫（Sokoke），旧名保留 aliases 保搜索命中（AI 识别旧名仍可匹配）；③踩坑记录：PowerShell 注入脚本首版正则只匹配单引号数组而 geneticDiseases/toxicFoods 是双引号→条件源集静默未生效，靠新增测试断言（withGenetic 含 OMIA/UC Davis）抓出，二次脚本修复并重导出种子。
- **种子同步**：临时 vitest 脚本序列化 BREED_DATA 导出 breedSeed.json（{version:'2026-08-25.1',updatedAt,breeds}）到 server/src/data/，跑完即删；⚠️ 并行会话在共享 git 工作区分批提交了本任务进行中的改动（f2d1fb1 迁移031+种子+仓储+breeds.ts 校对、55f0da6 接口+service、af5a651 百科页同步、1963585 补 import），其中 f2d1fb1 的种子是条件源修复前旧版——工作区当前版（金毛 6 源齐全）为待提交修正。
- **验证**：服务端 tsc 0 ✅ + 全量 **1017 passed** / 67 文件 ✅（路由测试 8→11）；小程序 tsc 0 ✅ + 全量 **2407 passed / 44 skipped** ✅（2392→2407 含新增 15）+ build:weapp 成功 ✅ + dist 确认三新译名/sources 编译且旧名仅在 aliases ✅；eslint 改动文件仅余既有问题（add 页 2 import/first、trends test import-first/no-duplicates 均基线已存在）✅；graphify 已更新 ✅。改动未提交部分见 git status（breedSeed.json 新版/breeds.ts 条件源/6 页面 getActiveBreeds 替换/测试扩展/server breeds.test.ts）。
- **双 Agent 审查结论（2026-08-25 补记）**：**双双放行（P0/P1=0）→ 加固项全部当轮落地**。服务端 4×P2 已修：getLatestBreeds catch 补 console.error；saveBreeds 并发版本竞争注释标注已知限制（saveGraph 同构）；isValidBreedData 补长度/规模约束（id/name≤50、来源元素≤100、条目≤300、id 重复拒绝）；跨日版本递增（昨日.5→今日.1）与"服务端覆写 version/updatedAt"契约锁测试补齐。前端有条件放行 → 条件全完成：**P1-1 双端校验缺口闭合**——isValidBreedList 与 isValidBreedData 同口径补 `aliases` 数组 + `weightRange.min/max` 数值校验（checkin/edit/add 直接调数组方法、趋势页直接取数值，坏库穿透会 TypeError 白屏；防线从 4 字段闭合到"渲染必需字段"粒度，各补拒绝用例）；P2-1 add 页刷新信号（本轮自查先行修复 breedDataVersion，与审查发现殊途同归）；P2-2 setStorage 独立 try/catch（缓存配额满不再吞掉已成功的切换返回 false）。P3 记录延后：breed-detail 服务端新增品种无空态、edit/trends/checkin 不自触发同步（冷启动用静态库）、?version= 协商省流量、多账号缓存隔离、vaccineService.test breeds mock 无效防御可删。
- **待部署（用户确认后）**：①生产 psql 执行迁移 031（owner 问题按规范 sudo -u postgres + ALTER OWNER xinghuanhai）②上传 server/src/{data/breedSeed.json,repositories/breedRepository.ts,routes/breeds.ts,schemas/index.ts,index.ts} → PM2 restart xinghuanhai-server ③冒烟：curl /api/breeds/knowledge 应返回 version+110 条（空表自动播种）④小程序微信开发者工具重新编译，进品种百科页看 Console 无报错即热更新生效。
- **遗留建议**：管理后台 /admin 尚无品种库修订 UI（可先 curl PUT /api/admin/breeds 带 x-admin-token 修订，PUT 会版本递增+结构校验兜底）；sources 为一般参考粒度非逐字段溯源，后续逐条精修走 saveBreeds 发新版即可体现热更新价值；edit 页 Picker 与 add 页搜索面板交互不一致（既有遗留延续）。

### 2026-08-25 · 全端选图失效修复：chooseImage 已废弃，全量迁移 chooseMedia

- **现象**：用户报"个人资料自定义头像传不了 + 所有传照片都传不了、点击无反应"（模拟器+体验版一致、Console 无业务输出）。
- **定位过程**：静态排查代码链路全部健康（privacy.ts 失败分支全有提示/app.js 被动授权注册/WechatProfile 原生组件事件绑定正确）→ 请用户在模拟器 Console 直接执行 `wx.chooseImage({count:1,...})` 决定性实验 → 底层 API 本身失败（errorReport 栈、不弹窗）→ 用户环境基础库 **3.16.2** → 官方文档实锤：**wx.chooseImage 自基础库 2.21.0 起停止维护，新基础库上实质失效**。
- **修复（commit 92f48dc）**：①`utils/privacy.ts` 微信端内部改调 `Taro.chooseMedia`（mediaType 锁 image），返回结构适配回 chooseImage 契约（`tempFiles[].tempFilePath` → `tempFilePaths`/`tempFiles[].path` + errMsg:'chooseImage:ok'），8 个调用方零改动；②`platform/media.ts` weapp 分支同步迁移；③memoir-vlog/memoir-daily 两处直调点迁移（tempFilePaths→tempFiles.map）；④setup.ts 补 chooseMedia mock + privacy.test.ts 6 用例重写为 chooseMedia 契约（含形状适配断言与"锁定 mediaType:['image']"防回退断言）。errno 112/取消/拒绝隐私分支对 chooseMedia 天然兼容（errMsg 同构）。
- **验证**：tsc 0 ✅、全量 2407 passed / 44 skipped ✅、build:weapp EXIT=0 ✅、dist 确认含 chooseMedia ✅。
- **⚠️ 教训沉淀**：①微信会静默回收旧 API——"以前好的现在坏了"+多入口同时挂+底层直调失败=优先怀疑基础库变更，让用户跑一行原生 API 调用是最快分叉手段；②选图类需求新代码一律用 chooseMedia；③chooseAvatar(open-type) 是独立原生能力不受影响，勿混淆。

### 2026-08-25 · 全端选图失效真根因：Taro 未转发 onNeedPrivacyAuthorization 致隐私接口集体挂起

- **接续排查**：chooseMedia 迁移（92f48dc）后用户反馈仍全端无反应（连登录页头像都点不动、零反馈）→ 推翻单 API 废弃假设，转向"所有隐私接口同时挂"的公共层。
- **真根因**：`@tarojs/taro@3.6.40` 封装层【未转发】`onNeedPrivacyAuthorization`（node_modules dist 实证无此 API）→ app.js 的 `typeof Taro.onNeedPrivacyAuthorization === 'function'` 恒 false → **被动授权监听从未注册成功**。此前一直正常是因为用户已同意旧版隐私协议、接口直接放行；**用户在 mp.weixin.qq.com 补声明剪贴板权限时《用户隐私保护指引》更新 → 协议版本变化重置全体用户同意状态** → 此后每次调用隐私接口（选图/剪贴板/头像昵称）微信都在等开发者弹窗，而监听不存在 → **接口永久挂起=点击零反馈无报错**。完美解释：所有选图入口同挂+复制邀请码 errno 112 同期出现+模拟器体验版一致+Console 无业务输出。
- **修复（commit 待填）**：①app.js 改用原生 `wx.onNeedPrivacyAuthorization`（保留 Taro fallback 与 typeof 防御，不支持时 console.warn 不再静默）；②PrivacyPopup 同意按钮补 `id='agree'` 与 resolve({buttonId:'agree'}) 对齐（官方按 id 关联放行按钮）。
- **验证**：tsc 0（CheckinPopup 报错为并行会话未跟踪半成品，stash 对照证实非本次引入）；全量 2416 passed ✅；build EXIT=0；dist/app.js 确认含 wx.onNeedPrivacyAuthorization 注册与 open-type 透传 ✅。
- **⚠️ 教训沉淀**：①「多入口同时挂+底层直调失败+零报错」三联征=隐私授权挂起的典型指纹，先查 wx.getPrivacySetting({success:console.log}) 的 needAuthorization 与监听注册链路；②凡用 Taro 封装的较新 wx API 必须验证 node_modules 里真实存在（typeof 防御会静默跳过，反而掩盖问题），关键平台能力优先直接用全局 wx；③后台隐私指引每次更新都会重置用户同意状态——发版前改指引需评估存量用户首次调用隐私接口的授权引导。

### 2026-08-25 · AI 页健康打卡改弹窗卡片（聊天不再被打卡消息撑长）

- **需求**：用户反馈宠物打卡在 AI 页一条条弹、聊天非常长，要做成弹窗卡片在卡内打卡。
- **根因 + 隐藏 bug**：旧流程（已删 `hooks/useCheckinFlow.ts`）逐条问答一次注入约 12 条消息；且逐项打卡从未调 `createCheckin` 落库，报告卡是假数据（仅多宠一键打卡落库）——本次一并修复。
- **实现**：①新建 `components/CheckinPopup` 居中弹窗卡片（与本页命理详情弹窗同视觉语言）：多宠先选宠（保留一键全部正常 batchCreateCheckins）→ 卡内一屏 5 项选项 chips（还剩 N 项提示）→ 完成打卡真实落库 → 卡内结果视图（星级+分项+服务端 aiFeedback 按风险分级配色）；②完成后聊天只追加一条 checkin_result 结果卡消息 + 刷新顶部今日摘要（refreshTodayHealth 抽取复用）；③等级映射口径对齐独立打卡页 CheckinInput（poop3正常/4偏软/2腹泻、appetite1~4、spirit1~4、exercise 由活力推导），anomalyItems 落 AnomalyItem 枚举（小便归 other）、中文描述走 note；④中途退出 showModal 二次确认防误丢；⑤首页所有入口统一 openCheckin（快捷按钮/+面板/摘要卡/CTA/setFlowHandlers.startCheckin/Agent 工具 checkin_flow），删除语音/文本答题拦截与 getCurrentFlowType 的 checkin 分支。
- **测试**：新增 `CheckinPopup.test.tsx` 11 用例（渲染/映射落库/异常标记/高风险警示/失败 toast/多宠选宠/一键批量默认指标/已打卡不重复提交/关闭确认×2）+ 首页测试 mock 弹窗并断言三入口打开。
- **验证**：tsc 0 ✅、全量 **2426 passed / 44 skipped** ✅（审查修复后回归 **2436 passed / 0 failed**）✅、eslint 改动文件 0 问题 ✅、build:weapp ✅、dist 确认 ckp-* 类名 ✅、graphify 已更新 ✅。**已提交 `28ee6eb`**（develop；同批并行会话另提交 d477797 关闭3D生成、88ad982 登录守卫收口，工作区已清空）。
- **待办（用户侧）**：微信开发者工具重新编译体验；行为变化=打卡期间语音输入不再承担答题入口（弹窗内点选完成）。
- **后续轮次（用户反馈"万一有宠物单一只状态不好没考虑到"，已提交 ddc2a2f）**：痛点=多宠「一键全部正常」all-or-nothing——有宠物状态不好时要么被批量按正常落库（数据污染）要么反复开关弹窗逐只打。**多宠连续打卡**：①打开时并行查询各宠物今日打卡状态（Promise.resolve 防御 + 回填合并保留已提交标记防异步竞态），宠物列表带 ✓ + 剩余计数，已打卡宠物点击 toast 拦截防重复；②先给异常那只逐项勾选提交，结果页出现「继续给剩余 N 只打卡」回到列表（本只结果卡先回传聊天、弹窗不关闭）；③批量按钮只面向剩余未打卡（checkedToday 快照直跳免重复查询），文案动态显示剩余数。新增 2 用例（已打卡拦截 / 单只异常连续打卡全流程），CheckinPopup 16/16，全量 **2437 passed / 0 failed**、LINT/TSC/BUILD 全绿、graphify ✅。**顺带修复（581bfea）**：feedingService.test 的 monthsAgo 助手 8-31 推 6 个月 → 2-31 溢出 3-02 致月龄断言 5≠6（机器日期恰为 8-31 触发）——日钳制到目标月最后一天 + 本地时区输出，feeding 34/34。
- **双 Agent 审查（已闭环，第2轮复核通过 P0/P1=0）**：第1轮 P1×2+P2×5 → ①P1-1 提交守卫：未答完点提交不再静默按中性默认值落库（污染健康数据），toast「还有 N 项未选」拦截；②P1-2 **checkinService.calculateRiskLevel 历史语义颠倒修复**：删「appetite/spirit=3(正常档)→caution」分支——打卡真落库后每天全勾正常也会被判"轻度异常"并写进趋势，全正常档改判 low（测试断言 medium→low 同步）；③P2-1 顺手修：结果卡 handleClose 先 setResultPayload(null) 再回调防双击重发；组件测试增至 **14 用例**；全量回归 **2436 passed / 0 failed**、graphify ✅。遗留延后：P2-2 单宠同日重复提交云端非幂等（建议 getTodayCheckin 前置）、P2-3 五项选项口径双源（CheckinPopup vs pagesPet/checkin，建议抽共享常量）、P2-5 批量串行 await 不可关、备注C checkinService.ts:84 既有死分支 appetite===5&&spirit<=2 待顺手删。

### 2026-08-25 · 隐私授权终版方案：官方 requirePrivacyAuthorize 弹窗（第三轮收敛）

- **接续**：86ef58f（原生 wx 注册监听）后用户实测 `getPrivacySetting` 返回 `needAuthorization:true`（后台指引正常）但自绘 PrivacyPopup 始终不出现、选图零反馈 → 自绘弹窗渲染链路问题无法远程定位，果断换方案。
- **终版方案（commit aa5281e+本轮）**：**主动模式**——`utils/privacy.ts` 的 chooseImageWithPrivacy 在调 chooseMedia 前先 `wx.requirePrivacyAuthorize`：由**基础库弹出官方标准半屏授权弹窗**（完全不依赖自绘 UI），同意一次永久放行；拒绝时 fail errMsg 含 privacy → 现有 toast 分支兜底。app.js 同步移除 onNeedPrivacyAuthorization 注册、getPrivacySetting 主动弹窗与 PrivacyPopup 挂载（官方规定主动/被动必须二选一，混用即 8-24 冲突教训）；memoir-vlog/daily 直调点收编进统一入口。PrivacyPopup 组件文件保留未挂载。
- **验证**：tsc 0 ✅、全量 2436 passed ✅、build EXIT=0、requirePrivacyAuthorize 编译进 dist/common.js（共享 chunk）、app.js 无被动监听残留 ✅。
- **⚠️ 教训沉淀**：①「官方 API 有标准 UI 就不要自绘」——授权类交互优先平台原生弹窗，少一层自绘渲染链路少一类故障；②二选一机制必须彻底删掉另一侧代码而非仅注释；③用户端验证链 getPrivacySetting(needAuthorization)→点接口看官方弹窗是否出现，两步即可切分"配置问题/前端问题"。

### 2026-08-25 · "连登录页都进不去"事故：并行会话半成品混入 dist（已修复）

- **现象**：隐私修复（725fee0 官方 requirePrivacyAuthorize 弹窗方案）build 后用户实测「连登录页面都进不去」+ 报错 `t is not a function`。
- **根因【不是隐私改动】**：并行会话正在做打卡流程大重构——`?? CheckinPopup/` 未跟踪半成品组件 + `pages/index/index.tsx` 新增 `import CheckinPopup`（首页=启动页）+ 删除 `useCheckinFlow.ts`。我 21:12 的 build 把这些工作区半成品一起编译进 dist；CheckinPopup 引用 `checkinService.CheckinInput`（类型尚未在服务中导出，esbuild 把值导入保留为 undefined 绑定）→ **首页模块加载即崩 → 全 App 白屏**。
- **处置（零触碰并行会话工作区）**：①`git worktree add E:\temp-xhh-clean-build 724ddc1` 干净提交快照；②junction 链接主仓库 node_modules 免重装；③补齐 untracked 必需文件 `src/utils/routeGuard.ts`（app.js 依赖、未提交）；④快照内 build → 校验（含 requirePrivacyAuthorize ✓ / 无 CheckinPopup ✓ / 首页无半成品引用 ✓）→ 回填主仓库 dist；⑤摘 junction → worktree remove 清场，主 node_modules 完好。
- **验证链**：node --check dist/app.js=0、common.js 含官方授权代码、pages/** 无 CheckinPopup 字符串。用户重新编译即可回到可用状态（隐私官方弹窗方案仍在）。
- **⚠️ 流程教训沉淀**：①**共享活跃仓库 build 前，git status 里未跟踪+已修改文件必须过目**——build 会把任何人的半成品带进产物，此前"操作前复核"规范没覆盖 build 场景，现补上；②多会话共用仓库时，需要"只含已提交代码"的产物一律走 worktree 干净构建（勿 stash——会冻结并行会话的工作区）；③esbuild 对"导入了不存在的具名绑定"不报错只产 undefined，tsc 错误（当时有 TS2322/TS2304）被并行会话标注为"它的半成品"而忽略——**build 门禁不能只看自己的文件**。

### 2026-08-25 · 形象定制页移除「文字生图」与「换背景」（用户裁决）

- **需求（用户原话）**："形象生成里面的文字生图和换背景都删掉吧 都没啥用 形象里面没背景"——两个功能使用率低且形象（头像/设定图）本身不需要背景。
- **实现（纯前端 4 文件）**：①`avatar-customize/index.tsx`：删 Tab 切换栏与 activeTab 状态、文字面板全量（描述输入/参考提示词模板/画风表情背景选择器/配额行）、换背景面板全量（源形象横滑选卡/预设+自定义背景/结果区）、GEN_BACKGROUNDS 与 GEN_STYLE_ATMOS 常量、textQuotaText/canGenerate/genCount/generatedUrl 等 10 个状态量、handleTextGenerate/handleBackgroundSwap/handleSaveBgResult/handleUseBgResult 四个 handler；照片面板去掉条件包装直出；handleSaveToLibrary 入库画风改取候选自身元数据（顺手消除 genStyle 错标隐患）；GEN_STYLE_LABELS.bgswap 标签保留（形象库历史条目中文显示兼容）；②`services/avatarService.ts`：generateAvatarOptions 去 description/background 参数（服务端仍兼容但前端不再发）、删 backgroundSwap 函数；③scss 删五段死样式（__ref*/__desc*/__tabs/__tab*/bgsrc/bgres）；④测试：删 backgroundSwap×2 与描述/背景透传×3 用例，重写为新签名断言（30 用例全过）。
- **验证**：tsc 0 ✅、全量 137 文件 passed / 0 failed（EXIT=0）✅、eslint 改动文件 2 error 均既有（vi.hoisted shadow/import-first）✅、build:weapp 成功 ✅、dist 校验：删除文案零残留、照片生成等保留功能在产物 ✅。graphify 已更新。已提交 `refactor(形象)` 分支 develop。
- **边界说明**：服务端 generate-options 的 styleKey/expression/description/background 参数与 POST /background-swap 端点保留未动（刚部署过生产，避免再动后端；前端无入口即不可达）——后续统一清理时一并下线并同步删除 AVATAR_BACKGROUND_PROMPTS/cleanCustomBackground/generateBackgroundSwap 及其测试。
- **待办（用户侧）**：微信开发者工具重新编译小程序查看效果。

### 2026-08-31 · 排查"wss://api.xinghuanhai.com/ws 连接失败"（结论=服务端健康，客户端网络挂起）

- **现象（用户贴 Console）**：`WebSocket connection to 'wss://api.xinghuanhai.com/ws?token=…' failed` 连续多次 + `:33383/apihelper/assdk … net::ERR_NETWORK_IO_SUSPENDED`（33383 是微信开发者工具自身的本地服务端口）。
- **链路确认（本地代码）**：`src/app.js` useLaunch → authStore.initialize 恢复 token → **`wsClient.connect(token)`**（L86，入口是纯 JS 版 app.js，搜 .ts/.tsx 会漏）→ `buildWsUrl` 把 https→wss 拼 `/ws?token=`（config.ts API_BASE_URL=https://api.xinghuanhai.com）；失败走指数退避重连（1s→30s），所以 Console 反复报。仅页面订阅 `.on()`、登出 disconnect。
- **证据（本机实测 + 生产只读 SSH）**：①本机 curl 升级头握手 `wss://api.xinghuanhai.com/ws?token=<日志中token>` → **HTTP 101** 且 15s 无服务端关闭帧（token 未过期，exp-iat=7 天，当前尚余 ~6.4 天）；②伪造 token 仅验证用；③生产 nginx -T：api 站点 `location / → try_files → @backend`，@backend 带 `Upgrade $http_upgrade / Connection 'upgrade'`（与仓库 `05-部署配置/monitor/nginx-xinghuanhai.conf` 一致）✅；④PM2 `xinghuanhai-server` online、:3000 监听正常；⑤生产日志中除我自己的 GET /ws 404 探测外**无任何用户侧 /ws 痕迹**——用户连接根本没到服务器。
- **结论（已收敛到唯一环节）**：①**服务端 100% 排除**：Node 原生 WebSocket 客户端（本机）以日志中真实 token 走完整链路全部通过——握手 101 → JWT 校验过（无 4003）→ 订阅 `user:{id}:notifications` 收到 `subscribed` 回执 → 3s 未被踢 → 正常关闭；②**系统网络 100% 排除**：与开发者工具同一台电脑同一网络，Node 能连上说明 OS 网络层通；③**剩余唯一嫌疑 = 微信开发者工具自身**：`project.config.json` 实锤 `"urlCheck": true`（启用了合法域名校验）——该 appid（wxabdfebe007586e53）后台若「**socket 合法域名**」未包含 `wss://api.xinghuanhai.com`，工具校验直接拦 connectSocket（REST 正常是因为 request 合法域名已配好，两者独立类别，正好解释"仅 WS 三连败"）。`ERR_NETWORK_IO_SUSPENDED` 是工具自身 33383 apihelper 的独立偶发挂起，非主因；系统代理已确认关闭（ProxyEnable=0）排除代理。
- **用户侧处置（二选一）**：①**根治**：微信公众平台「开发设置→服务器域名→**socket 合法域名**」添加 `wss://api.xinghuanhai.com` 保存（生效≤10 分钟）→ 工具重新编译；②**工具内临时**：「详情→本地设置」勾选「不校验合法域名、web-view、TLS 版本以及 HTTPS 证书」（会把 urlCheck 写回 false）→ 重新编译。若后台该类别确实已配置仍失败，再查工具「设置→代理设置」自定义代理（与系统代理独立）。
- **第二轮收敛（用户反馈 socket 域名已配置后）**：用户确认 ①工具代理=「使用系统代理」（但系统代理 ProxyEnable=0=直连）②REST 全部正常仅 WS 报错 ③工具「详情→域名信息」socket 一栏可见 `wss://api.xinghuanhai.com`。结合 SSL 证书链完整（*.xinghuanhai.com→YR2→Root YR→ISRG Root X1，authorized=true）、工具日志 302 个文件零 connectSocket 记录 → **域名校验/证书/代理/系统网络/服务端全部排除**，最终定位=**微信开发者工具（env 2.02.2607271 + 基础库 3.16.2）模拟器对 wss:// 的专项通道问题**（社区常见「模拟器 WS 连不上、真机正常」；失败发生在模拟器内部通道、未上报工具主进程日志）。**决定性验证=真机预览/真机调试**：真机 WS 正常即证实模拟器专属问题，线上推送不受影响（wsClient 启动自动指数退避重连）；工具侧缓解按序=换调试基础库版本重编译→清缓存全部清除重编译→升级/重装工具→代理临时切「不使用代理」。
- **顺带发现（服务器侧，未处理）**：nginx -T 里 api.xinghuanhai.com 的 443 server 块出现 **3 份重复**（~L253/338/405，nginx 取首个匹配生效，重复块是并行会话部署遗留的死配置），不影响 WS，后续清理 conf.d 时删冗余；且 `/health` 无此路由（冒烟用 `/api/health`）。
- **可选加固（未做，避免画蛇添足）**：给 wsClient 加 wx.onNetworkStatusChange 监听触发立即重连、或对无网/挂起场景降噪（如首次失败连续 N 次才保留日志）。改动未提交。