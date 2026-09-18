# Pet Prompt Engine · 宠物提示词引擎技能

> 星河宠记全项目「AI 提示词」唯一标准技能：**生图（头像/全家福/表情包）与回忆录（视频分镜）**
> 所有提示词任务先加载本技能，按公式完整组装，禁止各写各的、禁止遗漏环节。
>
> 源文档：《宠物回忆录-提示词库.md》（`01-产品文档/`，v5.0，170+ 条，方法论+风格库+角色锁定）
> 本技能 = 提示词库精华的**可执行固化版** + 代码调用点索引。提示词库原文细节仍以源文档为准。

---

## 一、何时使用（触发条件）

| 任务 | 加载 |
| --- | --- |
| 任何宠物 AI 生图（头像/形象/全家福/2D 表情包） | ✅ 必须 |
| 回忆录视频分镜提示词（Seedance） | ✅ 必须 |
| 新增/修改提示词相关代码、写提示词测试 | ✅ 必须 |
| 向 LLM 拼任何含宠物描述的自然语言 | 参考公式 |

## 二、金科玉律（红线，先于一切）

1. **宠物名字绝不进提示词**（猫叫「烧鸡」会被画成烤鸡——线上事故，已有测试锁死）。名字只进入库字段，不进 prompt。
   ⚠️ **两道清洗缺一不可（2026-09-19 补）**：① `translatePetNames` —— 按档案里的**已知名字**替换为外貌指代；
   ② `stripNamingPhrases` —— 按**句式特征**清洗「叫X的 / 名叫X / 名字是X / 叫作X / 唤作X / 昵称是X」，
   用来拦 **LLM 自己编造**的第三方名字（白名单机制拦不住这种，见 §八）。
2. **外貌要写具体**（提示词库 §0.9）：毛色/花纹/体型/脸型/眼睛/鼻子/胡须/特殊标记，禁止"橘色虎斑"式草草带过。有真实照片 → 用视觉模型自动提取（`extractPetAppearance`）。
3. **数量锁定**：明确"只出现这 N 只"，防模型加戏/多画。
4. **参考图一致性**：有参考图必须声明"保持毛色/花纹/体型/五官与参考图一致，不改变外貌，不增减数量"；**无参考图绝不写"以参考照片为准"**（提示词说谎）。
5. **清洗**：品种/描述一律去换行/控制字符 + 截断（品种 20 字、描述 100 字）；"不确定品种/混血/串串"映射为兜底"毛茸茸的"。
6. **中英混排策略**：主体/约束用中文，风格关键词用提示词库英文原文（模型识别更准）。

## 三、生图提示词公式（已固化于代码，按此审查）

```
{主体} + {外貌} + {表情} + {画风} + {光影氛围} + {画质} + {角色锁定} + {主体锁定}
```

| 环节 | 实现 | 代码位置 |
| --- | --- | --- |
| 主体（品种+物种，兜底） | `petSubjectText(breed, species, gender?)` → "一只英短猫咪" | `server/src/services/petPrompt.ts` |
| 外貌（用户描述 / 照片自动提取） | 描述清洗截断 100 字；无描述+有照片 → `extractPetAppearance`（DeepSeek 视觉） | `avatarService.ts` / `routes/avatar.ts` |
| 表情（12 种） | `EXPRESSION_PROMPTS`（中文正向描述） | `server/src/services/avatarService.ts` |
| 画风（15 种，猫狗各一套） | `AVATAR_STYLE_OPTIONS` | `server/src/services/avatarService.ts` |
| 光影氛围（每画风配好） | 前端 `GEN_STYLE_ATMOS`（提示词库 §6 关键词） | `miniapp/.../avatar-customize/index.tsx` |
| 画质词 | `高质量，细节丰富，干净背景` | 各组装点 |
| 角色锁定（有参考图） | `PET_IDENTITY_KEEP` | `server/src/services/petPrompt.ts` |
| 主体锁定 | `PET_ONLY_ONE` | `server/src/services/petPrompt.ts` |
| 名字清洗（**白名单**：已知名字） | `translatePetNames` | `server/src/services/petPrompt.ts` |
| 名字清洗（**句式级**：防 LLM 编造名） | `stripNamingPhrases` | `server/src/services/petPrompt.ts` |

**用户侧指引**（参考提示词模板，前端已实现公式化五字段：主体/外貌/表情/画风/氛围 + 一键填入）。

## 四、各场景模板

### 4.1 头像/形象生图（generate-options）
组装：`{主体}的头像，{外貌}，{表情}，{画风}风格：{氛围}，高质量，细节丰富，干净背景`
入口：前端文字生成 Tab（描述+15 画风单选+12 表情单选 → 生成 1 张）；照片生成（5 画风候选）。

### 4.2 全家福（familyPhotoService）
组装：`{风格关键词}，一张温馨的全家福合影，画面中共有{N}只{物种}：{每只品种+物种，绝不写名字}。所有宠物并排坐在一起…。以参考照片为准：保持每只宠物毛色/花纹/体型/五官与参考图完全一致，不改变外貌，不增减数量。画面中只出现这{N}只宠物，不要出现其他动物、人物或食物。高质量，细节丰富。`
- 风格 6 种（pixar/ghibli/oil/ink/nordic/cyberpunk），关键词取自提示词库 §6
- **分级**：成员无真实形象（只有品牌默认头像/无头像）→ 拦截返回 `MEMBER_NO_REAL_IMAGE` 引导，不硬生成
- 品牌默认头像判定：`isBrandPresetUrl`（URL 含 `/home-style/` 或 `/preset-home/`）

### 4.3 回忆录视频（promptTemplates.ts，Seedance 2.5）
- **生成前看图**：`memoirPhotoAnalysis.ts` 逐张提取可见主体/外貌/姿态/互动/场景/构图/光线，按 `photo_index` 一一对应喂给分镜；单图失败保守降级，不编造照片外剧情
- **全库调用协议**：提示词库 v5.1 已将卡片分为模式 S（真实照片首帧）、模式 C（创意关键帧）、模式 P（空镜/后期模块）；调用卡片时必须追加对应公共尾缀，禁止只复制旧卡片正文
- **官方工程型公式**：精准主体 + 动作细节 + 场景环境 + 光影色调 + 镜头运镜 + 视觉风格 + 画质 + 约束条件
- **全库调用模式**：真实照片/日常静图默认模式 S（首帧安全）；空镜/转场/光影/音频用模式 P（后期模块）；大动作与风格化模板用模式 C（先专用关键帧再视频），不得把模式 C 直接套到任意静态宠物照片
- **十段结构**：GLOBAL STYLE → SCENE → CHARACTERS → LOCATION → FIRST FRAME → Shot → OPTICS → PHYSICS → LIGHTING → AUDIO（缺段补官方级默认）
- **静图安全动作**：每镜只用一种运镜；只做缓慢眨眼/轻微呼吸/耳朵或尾巴尖小幅微动，不凭空奔跑、跳跃、转身
- **运镜与节奏（2026-09-19 补）**：`Shot` 默认段带**位移速度**（如「约 2 秒/帧，全程匀速、无卡顿无骤停」）与**静→动→静**节奏声明
- **宠物专有信号（2026-09-19 补，我们的护城河）**：`PHYSICS` 默认段覆盖耳位 / 胡须 / 尾尖 / 竖毛 / 舔鼻 / 瞬膜（第三眼睑）等真实可读的微动作；
  ⚠️ 只用**视觉事实词**（如「耳廓向后压低」），**不写情绪词**（Anti-Subjective）；且**只能小幅低缓连续**，不得越出静图安全边界
- **Locks 连续性锁**：COUNT LOCK / SCREEN DIRECTION（默认保持首帧原始朝向）/ IDENTITY LOCK / ANATOMY LOCK / QUALITY LOCK
- **多角色锚点**：每在场角色一个 CharacterAnchor（id/type/desc 3-6 特征全片逐字重复）；历史脚本和 LLM 输出也必须在进入 Seedance 前清除宠物名字
- **首帧契约**：Seedance 图片输入显式 `role: first_frame`；无参考图绝不写身份锁定说谎
- **记忆锚定（防编造，2026-09-01 新增）**：分镜叙事只能以三类真实素材为事实来源——记忆引擎摘要（`agent_memories` 核心层 + 时光线 `pet_moments` 回忆文本，`memoryService.getPetMomentsSummary`）、用户亲述文案（`source_text`）、逐张照片视觉摘要。素材里的具体回忆优先写进旁白；三类素材全空时必须触发【无记忆约束】：禁止虚构具体事件/日期/对话/关系，只许照片事实与中性氛围。照片事实与记忆冲突时以照片为准
- **音频边界**：Seedance 段要求无人物对白、无模型字幕、无模型 BGM；旁白与字幕由后期 TTS/ASS 统一完成

### 4.4 2D 表情包（image2DService）
组装：`{主体}，{表情/动作}，{角度}视角，{基调}，高质量，干净背景，{PET_IDENTITY_KEEP}，{PET_ONLY_ONE}`

## 五、风格库（提示词库 §6/§7.1）

**生图画风（15 种，`AVATAR_STYLE_OPTIONS` + 前端 `GEN_STYLES`）**：
Q版萌系(q) / 日系治愈(japanese) / 美式卡通(american) / 水彩手绘(watercolor) / 黏土萌宠(clay) / 吉卜力动画(ghibli) / 皮克斯3D(pixar) / 像素艺术(pixel) / 水墨国风(ink) / 油画印象派(oil) / 赛博朋克(cyberpunk) / 极简北欧(nordic) / 低多边形(lowpoly) / 线稿素描(lineart) / 暗黑奇幻(dark)

**视频全量 13 种**（§6.1-6.13）：赛博朋克 / 复古VHS / 吉卜力 / 皮克斯3D / 像素 / 水墨 / 油画 / 暗黑奇幻 / 极简北欧 / 故障艺术 / 黏土动画 / 低多边形 / 线稿

> 每风格英文关键词以提示词库 §7.1 速查表为唯一事实源；生图 15 种已固化在 `AVATAR_STYLE_OPTIONS`（猫/狗各一套，防串脸）。

## 六、表情库（12 种，`EXPRESSION_PROMPTS`）

开心(happy) / 难过(sad) / 兴奋(excited) / 困倦(sleepy) / 温柔(love) / 得意(cool) / 生气(angry) / 思考(thinking) / 惊讶(surprised) / 委屈(crying) / 庆祝(celebrate) / 调皮(naughty)
> 每个表情有中文正向提示词（如 happy → "开心的表情，嘴角上扬，眼睛弯弯"），拼进生图提示词。

## 七、角色锁定表（提示词库 §0.6/§四，代码已固化）

```
- 角色：{品种} {毛色/花纹} {体型}，全片/全图同一只，毛色体型不变（face/fur/body keep）
- 数量敏感：画面中只出现这 N 只，禁止第二只、变种、换毛色
- 禁止：其他动物/人物/文字/水印
- 有参考图：以参考照片为准，不改变外貌，不增减数量
```

## 八、避坑清单（提示词库 §八 + 线上事故沉淀）

| 坑 | 处置 |
| --- | --- |
| 名字进提示词（烧鸡→鸡） | 名字只入库，不进 prompt；测试断言不含名字/chicken/roast/named |
| 外貌草草（"橘色虎斑"） | 按 §0.9 多维度写；有照片自动提取 |
| 品种为空/未知 | `petSubjectText` 兜底"毛茸茸的"；"不确定品种/混血/串串"映射兜底 |
| 无参考图却写"以参考照片为准" | 条件拼接（有任一参考图才写） |
| 中英混杂、名字/换行注入 | 中文主体+英文风格词；统一清洗去换行截断 |
| 数量不明确 | 明确"共 N 只"，防只画一只/多画 |
| 文字生成占照片配额 | style 区分（文字 `-text-*` 不计入照片额度） |
| 品牌默认头像当参考图 | `isBrandPresetUrl` 拦截 + 引导生成真实形象 |
| **LLM 自己编造名字**（如写出「一只叫小橘的猫」） | 白名单 `translatePetNames` **拦不住**（名字不在档案里）→ 必须叠 `stripNamingPhrases` 句式级清洗。⚠️ 它是**纯删除式**：名字后**无标点**时会吃掉后文（如「名字是旺财今天很乖」→「这只狗」），已知边界 |

## 九、修改提示词的正确姿势

1. **改画风/表情/外貌提取** → `server/src/services/avatarService.ts`（AVATAR_STYLE_OPTIONS / EXPRESSION_PROMPTS / extractPetAppearance）+ 前端 `avatar-customize/index.tsx`（GEN_STYLES / GEN_STYLE_ATMOS / 模板），两处 key 必须一致
2. **改全家福** → `server/src/services/familyPhotoService.ts`（STYLE_PROMPTS / buildPrompt / isBrandPresetUrl）
3. **改回忆录** → `server/src/services/promptTemplates.ts`（十段默认值 / Locks / 角色锚点）
4. **改公共约束** → `server/src/services/petPrompt.ts`（petSubjectText / PET_IDENTITY_KEEP / PET_ONLY_ONE / translatePetNames / stripNamingPhrases）
5. **改提示词库原文** → `01-产品文档/宠物回忆录-提示词库.md`，然后回填本技能与代码
6. **必须同步测试**：相关 .test.ts 断言（名字不进提示词 / 数量 / 兜底 / 清洗 / 白名单），跑 `npm test`（前后端）+ `tsc --noEmit`

## 十、验证清单（改完自查）

- [ ] 名字/鸡类词不进任何提示词（有测试锁）
- [ ] 造句式级清洗已接在调用链上，且负向句（「他叫我过去」）不被误伤
- [ ] 外貌具体（多维度），有照片能自动提取
- [ ] 数量明确、主体锁定、参考图约束条件正确
- [ ] 画风/表情 key 前后端一致，白名单闭环
- [ ] 清洗（去换行/截断）生效，无注入
- [ ] 前后端 tsc 0 + 全量测试绿 + build:weapp 成功
- [ ] 服务端已部署（PM2 xinghuanhai-server，备份 src.bak.*），冒烟 health 200
