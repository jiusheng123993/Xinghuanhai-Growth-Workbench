/**
 * agentRuleIntent.detectBreedQuestion 纯函数测试
 * 覆盖：命中品种提问的各类句式、不误伤普通闲聊/其他意图
 */
import { describe, it, expect } from 'vitest';
import { detectBreedQuestion, detectMemoryRecordIntent, detectOffTopic } from '../agentRuleIntent.js';

describe('detectBreedQuestion', () => {
  it('should match "这是什么猫/狗/品种" form', () => {
    expect(detectBreedQuestion('这是什么猫')).toBe(true);
    expect(detectBreedQuestion('这是什么狗')).toBe(true);
    expect(detectBreedQuestion('这是什么品种')).toBe(true);
    expect(detectBreedQuestion('这是什么犬')).toBe(true);
  });

  it('should match "什么品种" variants (含追问句式)', () => {
    expect(detectBreedQuestion('什么品种')).toBe(true);
    expect(detectBreedQuestion('它是什么品种呀')).toBe(true);
    expect(detectBreedQuestion('帮我看看这只是啥品种')).toBe(true);
  });

  it('should match "是什么猫/狗" and "这是啥猫"', () => {
    expect(detectBreedQuestion('是什么狗')).toBe(true);
    expect(detectBreedQuestion('这是啥猫')).toBe(true);
    expect(detectBreedQuestion('英短是什么猫')).toBe(true);
  });

  it('should match "X 的品种"', () => {
    expect(detectBreedQuestion('这只猫的品种')).toBe(true);
  });

  it('should ignore surrounding whitespace', () => {
    expect(detectBreedQuestion('  这是什么猫  ')).toBe(true);
  });

  it('should NOT match ordinary chat or other intents', () => {
    expect(detectBreedQuestion('今天豆豆吃了吗')).toBe(false);
    expect(detectBreedQuestion('帮我取个名字')).toBe(false);
    expect(detectBreedQuestion('猫粮推荐')).toBe(false);
    expect(detectBreedQuestion('巧克力猫能吃吗')).toBe(false);
    expect(detectBreedQuestion('这是什么意思')).toBe(false);
    expect(detectBreedQuestion('')).toBe(false);
  });
});

/**
 * 2026-09-11 事故回归：用户明确说"记录回忆/写日记"时，LLM 意图分类器返回 chat
 * （置信度 ≥0.7）→ agentLoop 对 chat 走 tool_choice='none' 禁用全部工具 →
 * record_memory 调不到，AI 只用文字回"记下了"，时光里却没有记录。
 * 下面锁死"明确请求必须命中 memory 规则"与"查询类说法不得命中"两侧边界。
 */
describe('detectMemoryRecordIntent 明确记录回忆请求', () => {
  it('should match "记录回忆 / 写日记" 等祈使说法', () => {
    expect(detectMemoryRecordIntent('记录回忆')).toBe(true);
    expect(detectMemoryRecordIntent('帮我记录一下回忆')).toBe(true);
    expect(detectMemoryRecordIntent('写个日记')).toBe(true);
    expect(detectMemoryRecordIntent('写篇日记吧')).toBe(true);
    expect(detectMemoryRecordIntent('记录回忆：豆豆今天追逗猫棒玩疯了')).toBe(true);
  });

  it('should match "记下这件事 / 今天的事" 类说法', () => {
    expect(detectMemoryRecordIntent('记下这件事：它今天把花瓶打碎了')).toBe(true);
    expect(detectMemoryRecordIntent('帮我记下今天的事')).toBe(true);
    expect(detectMemoryRecordIntent('记录一下今天的事')).toBe(true);
    expect(detectMemoryRecordIntent('把这段存进时光簿')).toBe(true);
  });

  it('should match 量词/裸"写日记"等常见说法（2026-09-11 审查 P2-3 漏判清单）', () => {
    expect(detectMemoryRecordIntent('写日记')).toBe(true);
    expect(detectMemoryRecordIntent('写一篇日记')).toBe(true);
    expect(detectMemoryRecordIntent('写个日记')).toBe(true);
    expect(detectMemoryRecordIntent('写篇日记吧')).toBe(true);
    expect(detectMemoryRecordIntent('记录一条回忆')).toBe(true);
    expect(detectMemoryRecordIntent('帮我记录一条回忆')).toBe(true);
    expect(detectMemoryRecordIntent('帮我记下来这件事')).toBe(true);
    expect(detectMemoryRecordIntent('记录下来这件事')).toBe(true);
    expect(detectMemoryRecordIntent('记下那次经历')).toBe(true);
    expect(detectMemoryRecordIntent('帮我保存这段回忆')).toBe(true);
    expect(detectMemoryRecordIntent('记录一下我的回忆')).toBe(true);
    expect(detectMemoryRecordIntent('记录心情日记')).toBe(true);
  });

  it('should ignore surrounding whitespace', () => {
    expect(detectMemoryRecordIntent('  记录 回忆  ')).toBe(true);
  });

  /**
   * 2026-09-11 双 Agent 审查 P1-1 实测反例（修复前全部误判为 true）：
   * memory 意图是 confidence=1.0 硬锁 + 提示词"务必调用 record_memory"，
   * 一旦把**问句**判成"要记录"，模型可能把问句本身写进 pet_moments（假回忆），
   * 或把用户强行拖进回忆录制流程（下一句话无二次确认即落库）。
   */
  it('should NOT match 疑问/求助口吻（审查实测反例，锁死不得回退）', () => {
    expect(detectMemoryRecordIntent('怎么记录回忆')).toBe(false);
    expect(detectMemoryRecordIntent('如何记录回忆')).toBe(false);
    expect(detectMemoryRecordIntent('记录回忆在哪里看')).toBe(false);
    expect(detectMemoryRecordIntent('记录回忆怎么删除')).toBe(false);
    expect(detectMemoryRecordIntent('保存回忆的方法是什么')).toBe(false);
    expect(detectMemoryRecordIntent('记录回忆的功能怎么用')).toBe(false);
    expect(detectMemoryRecordIntent('记录回忆的时候能加照片吗')).toBe(false);
    expect(detectMemoryRecordIntent('保存回忆失败怎么办')).toBe(false);
    expect(detectMemoryRecordIntent('我记录回忆总是失败')).toBe(false);
    expect(detectMemoryRecordIntent('怎么把照片存到时光线里')).toBe(false);
    expect(detectMemoryRecordIntent('怎么记下这段记忆')).toBe(false);
    expect(detectMemoryRecordIntent('怎么记录一下今天的事情')).toBe(false);
  });

  it('should NOT match 相邻产品线的记录请求（回忆录/打卡/喂养/疫苗）', () => {
    expect(detectMemoryRecordIntent('回忆录视频能存到时光线吗')).toBe(false);
    expect(detectMemoryRecordIntent('回忆录做到哪了 存进回忆了吗')).toBe(false);
    expect(detectMemoryRecordIntent('打卡记录能存到时光线吗')).toBe(false);
    expect(detectMemoryRecordIntent('喂养记录怎么存到回忆里')).toBe(false);
    expect(detectMemoryRecordIntent('把今天的打卡记录存到时光线')).toBe(false);
  });

  /**
   * 2026-09-11 复验 A 组反例（19/20 曾误判为 true）：疑问词表 + 句尾语气词（先剥尾部标点再判）。
   */
  it('should NOT match 疑问句整类（复验 A 组，锁死不得回退）', () => {
    expect(detectMemoryRecordIntent('记录回忆可以做什么')).toBe(false);
    expect(detectMemoryRecordIntent('记录回忆有什么用')).toBe(false);
    expect(detectMemoryRecordIntent('记录回忆有什么好处')).toBe(false);
    expect(detectMemoryRecordIntent('记录回忆需要会员吗？')).toBe(false);
    expect(detectMemoryRecordIntent('记录回忆有数量限制吗？')).toBe(false);
    expect(detectMemoryRecordIntent('记录回忆能存多少条')).toBe(false);
    expect(detectMemoryRecordIntent('记录回忆呢')).toBe(false);
    expect(detectMemoryRecordIntent('写回忆要注意什么')).toBe(false);
    expect(detectMemoryRecordIntent('记录回忆是干嘛的')).toBe(false);
    expect(detectMemoryRecordIntent('记录回忆占内存吗？')).toBe(false);
    expect(detectMemoryRecordIntent('记录回忆会不会泄露隐私？')).toBe(false);
    expect(detectMemoryRecordIntent('记录回忆支持语音吗？')).toBe(false);
    expect(detectMemoryRecordIntent('记录回忆的时候要注意什么')).toBe(false);
    expect(detectMemoryRecordIntent('记录回忆会占用多少空间')).toBe(false);
    expect(detectMemoryRecordIntent('记录回忆支持导出吗？')).toBe(false);
    expect(detectMemoryRecordIntent('记录回忆会不会很麻烦？')).toBe(false);
    expect(detectMemoryRecordIntent('记录回忆可以删除吗？')).toBe(false);
    expect(detectMemoryRecordIntent('记录回忆最长能写多少字')).toBe(false);
    expect(detectMemoryRecordIntent('记录回忆怎么写')).toBe(false);
    // 陈述句（裸"写日记"规则已锚定句首）
    expect(detectMemoryRecordIntent('我写日记好几年了')).toBe(false);
    expect(detectMemoryRecordIntent('它写日记一样把爪子按在纸上')).toBe(false);
  });

  /**
   * 2026-09-11 复验 B 组反例：正文（冒号之后）里出现"疫苗/体重/用药/失败/怎么"是养宠回忆的
   * 高频词，守卫**只作用于命令片段**，不得把它们一起拦掉——否则这些真实记录请求会被打回 LLM 分类，
   * 重新走回"AI 说记下了、其实什么都没写"的老路（复验实测曾漏判 11/20，其中 4 条直达事故路径）。
   */
  it('should match 正文含疫苗/体重/用药等词的**真实记录请求**（复验 B 组）', () => {
    expect(detectMemoryRecordIntent('记录回忆：今天带它打疫苗，它吓得不知道怎么好')).toBe(true);
    expect(detectMemoryRecordIntent('记录回忆：今天称了体重，比上周轻了')).toBe(true);
    expect(detectMemoryRecordIntent('记录回忆：它今天没反应，我叫了半天')).toBe(true);
    expect(detectMemoryRecordIntent('记录回忆：今天喂药失败了，它把药吐了')).toBe(true);
    expect(detectMemoryRecordIntent('帮我记录这段回忆：它在沙发上翻跟头怎么都停不下来')).toBe(true);
    expect(detectMemoryRecordIntent('帮我记下这件事：它今天吐了，我担心是不是体检没查出来')).toBe(true);
    expect(detectMemoryRecordIntent('记下这件事：它今天体重降到4.2kg')).toBe(true);
    expect(detectMemoryRecordIntent('记录一下今天的事：它今天喂食特别积极')).toBe(true);
    expect(detectMemoryRecordIntent('把这段存进时光簿：今天用药后它精神多了')).toBe(true);
    expect(detectMemoryRecordIntent('记下这件事：它今天偷吃失败，被我抓个正着')).toBe(true);
  });

  /**
   * 2026-09-11 复验 C 组反例（7/7 曾漏判）：句首祈使直接接正文、正文里没有"事/经历/回忆"关键词。
   */
  it('should match 句首祈使 + 直接接正文（复验 C 组，规则⑦）', () => {
    expect(detectMemoryRecordIntent('帮我记一下：今天它趴在我腿上睡着了')).toBe(true);
    expect(detectMemoryRecordIntent('记录下来：它今天学会握手了')).toBe(true);
    expect(detectMemoryRecordIntent('记录一下：它终于不怕吸尘器了')).toBe(true);
    expect(detectMemoryRecordIntent('帮我记一下这个瞬间')).toBe(true);
    expect(detectMemoryRecordIntent('记录一下它今天干的坏事')).toBe(true);
    expect(detectMemoryRecordIntent('帮我记录一下它的日常')).toBe(true);
    expect(detectMemoryRecordIntent('记下来今天它第一次自己上厕所')).toBe(true);
  });

  /**
   * 2026-09-11 复验第 3 轮反例（H/I 组）：规则⑦（句首祈使接正文）不能把"记录别的东西"的
   * 陈述句也锁成 memory 意图——那会让正文直接写进 pet_moments 变成脏回忆。
   */
  it('should NOT match 记录"别的东西"的陈述句（复验第 3 轮 H/I 组）', () => {
    expect(detectMemoryRecordIntent('记录一下会议的要点')).toBe(false);
    expect(detectMemoryRecordIntent('记录一下我今天的行程')).toBe(false);
    expect(detectMemoryRecordIntent('记录一下明天要买的东西')).toBe(false);
    expect(detectMemoryRecordIntent('记下我的密码')).toBe(false);
    expect(detectMemoryRecordIntent('写下今天的待办')).toBe(false);
    expect(detectMemoryRecordIntent('记录一下这个 bug 的复现步骤')).toBe(false);
    expect(detectMemoryRecordIntent('记一下老板交代的工作')).toBe(false);
    expect(detectMemoryRecordIntent('记录下来我学的单词')).toBe(false);
    expect(detectMemoryRecordIntent('记录一下我的账号密码')).toBe(false);
    expect(detectMemoryRecordIntent('写下来的回忆我都没删')).toBe(false);
    expect(detectMemoryRecordIntent('记下来的东西太多了')).toBe(false);
    expect(detectMemoryRecordIntent('记录下来的都是真实的')).toBe(false);
  });

  /**
   * 2026-09-11 复验第 3 轮：命令片段的分隔符必须含逗号/顿号/空白；
   * 疑问词表补 A-不-A 通用式；"吧 + 问号"仍算问句。
   */
  it('should match 逗号/空格分隔的真实记录请求（复验第 3 轮建议）', () => {
    expect(detectMemoryRecordIntent('记录回忆，今天它打疫苗了，有点蔫')).toBe(true);
    expect(detectMemoryRecordIntent('帮我记一下，今天它打疫苗了')).toBe(true);
    expect(detectMemoryRecordIntent('记录回忆 今天称了体重')).toBe(true);
    expect(detectMemoryRecordIntent('帮我记下今天的事，它在沙发上翻跟头怎么都停不下来')).toBe(true);
    expect(detectMemoryRecordIntent('记录回忆，它今天没反应，我叫了半天')).toBe(true);
  });

  it('should NOT match A-不-A 问式与"吧+问号"（复验第 3 轮建议）', () => {
    expect(detectMemoryRecordIntent('记录回忆贵不贵？')).toBe(false);
    expect(detectMemoryRecordIntent('记录回忆快不快')).toBe(false);
    expect(detectMemoryRecordIntent('记录回忆难不难')).toBe(false);
    expect(detectMemoryRecordIntent('记录回忆算隐私内容吧？')).toBe(false);
  });

  it('should NOT match 查询类/名词性说法（避免把"查询回忆"误判成"记录回忆"）', () => {
    expect(detectMemoryRecordIntent('我记录的回忆在哪看')).toBe(false);
    expect(detectMemoryRecordIntent('时光线里的回忆怎么删除')).toBe(false);
    expect(detectMemoryRecordIntent('回忆记录的时间不对')).toBe(false);
  });

  it('should NOT match 回忆录（另一条产品线）与普通分享', () => {
    expect(detectMemoryRecordIntent('帮我做一部回忆录')).toBe(false);
    expect(detectMemoryRecordIntent('回忆录做到哪一步了')).toBe(false);
    expect(detectMemoryRecordIntent('今天可乐和布丁两个人在房子里跑来跑去的 吵死了 他们玩的很开心')).toBe(false);
    expect(detectMemoryRecordIntent('它今天一直睡觉')).toBe(false);
    expect(detectMemoryRecordIntent('记录一下今天喂了鸡胸肉')).toBe(false);
    expect(detectMemoryRecordIntent('')).toBe(false);
    expect(detectMemoryRecordIntent('   ')).toBe(false);
  });
});

describe('detectOffTopic 越界话题拦截', () => {  it('should match human romance/relationship topics', () => {
    expect(detectOffTopic('我想谈恋爱了')).toBe(true);
    expect(detectOffTopic('好想脱单')).toBe(true);
    expect(detectOffTopic('我失恋了，好难过')).toBe(true);
    expect(detectOffTopic('被家里催婚')).toBe(true);
    expect(detectOffTopic('和男朋友分手了')).toBe(true);
    expect(detectOffTopic('暗恋一个女生')).toBe(true);
    expect(detectOffTopic('想结婚了')).toBe(true);
    expect(detectOffTopic('喜欢的人跟我表白了')).toBe(true);
  });

  it('should match homework/coding/translation requests', () => {
    expect(detectOffTopic('帮我写作业')).toBe(true);
    expect(detectOffTopic('帮我写一篇论文')).toBe(true);
    expect(detectOffTopic('帮我写代码')).toBe(true);
    expect(detectOffTopic('帮我翻译这段话')).toBe(true);
    expect(detectOffTopic('学Python')).toBe(true);
    expect(detectOffTopic('这段代码报错了')).toBe(true);
  });

  it('should match finance/weather/news/entertainment/fortune/job topics', () => {
    expect(detectOffTopic('今天股票怎么样')).toBe(true);
    expect(detectOffTopic('帮我推荐基金')).toBe(true);
    expect(detectOffTopic('今天天气怎么样')).toBe(true);
    expect(detectOffTopic('最近有什么新闻')).toBe(true);
    expect(detectOffTopic('推荐一部好看的电影')).toBe(false); // 电影未收录（长尾），交给 LLM offtopic 分类器
    expect(detectOffTopic('帮我算算运势')).toBe(true);
    expect(detectOffTopic('最近在找工作')).toBe(true);
    expect(detectOffTopic('帮我看看星座')).toBe(true);
  });

  it('should match with surrounding whitespace', () => {
    expect(detectOffTopic('  我想 谈恋爱  ')).toBe(true);
    expect(detectOffTopic('  帮我 写作业  ')).toBe(true);
  });

  it('should NOT match pet-related content', () => {
    expect(detectOffTopic('豆豆今天没精神')).toBe(false);
    expect(detectOffTopic('猫粮推荐')).toBe(false);
    expect(detectOffTopic('它把花瓶打碎了')).toBe(false);
    expect(detectOffTopic('它已经去世了，我很想念它')).toBe(false);
    expect(detectOffTopic('我家猫感冒了怎么办')).toBe(false);
    expect(detectOffTopic('今天适合带狗出门吗')).toBe(false);
    expect(detectOffTopic('')).toBe(false);
    expect(detectOffTopic('   ')).toBe(false);
  });

  it('should NOT match pet breeding/mating/weight requests（歧义词刻意未收录）', () => {
    expect(detectOffTopic('想给我家猫找个对象配种')).toBe(false);
    expect(detectOffTopic('我家狗发情了怎么办')).toBe(false);
    expect(detectOffTopic('我家猫太胖了想减肥')).toBe(false);
  });

  /**
   * 2026-09-10 事故回归：AI 取名·命理详情的提示词（miniapp/src/utils/namingPrompts.ts
   * buildDetailPrompt）会连同"运势"一起发给 /api/ai/chat。此前单词级 /运势/ 规则把这条
   * 业务内请求判为越界 → 直接返回拒绝话术、不调 LLM → 命理深度分析 100% 失效，
   * 用户永远只看到本地降级模板。以下字面量取自该提示词的真实输出，锁死不得再误伤。
   */
  it('should NOT match pet naming/fate prompt text（取名命理提示词不得被判越界）', () => {
    expect(detectOffTopic('2. 整体运势：综合五行、星宿、字义，分析这个名字带来的整体运势走向（3-4句话）')).toBe(false);
    expect(detectOffTopic('5. 健康运势：从五行平衡角度分析名字对宠物健康的影响（2-3句话）')).toBe(false);
    expect(detectOffTopic('3. 事业/生活运势：这个名字对宠物日常生活、活力、表现力的影响（2-3句话）')).toBe(false);
    expect(detectOffTopic('4. 感情/人际运势：名字对宠物与主人、其他宠物、家人之间缘分的影响（2-3句话）')).toBe(false);
    expect(detectOffTopic('"fortune": "整体运势分析"')).toBe(false);
    expect(detectOffTopic('你是一位精通中国传统命理学的取名大师，请为以下宠物名字进行深度命理分析：')).toBe(false);
    expect(detectOffTopic('为一只布偶推荐5个中文宠物名字。出生日期：2026-03-12（春天），性别：female。')).toBe(false);
  });

  it('should still match human fortune-telling questions（运势规则收窄后仍要拦截人类问法）', () => {
    expect(detectOffTopic('帮我看看今年的运势')).toBe(true);
    expect(detectOffTopic('看运势')).toBe(true);
    expect(detectOffTopic('我的运势如何')).toBe(true);
    expect(detectOffTopic('今年运势怎么样')).toBe(true);
    expect(detectOffTopic('最近运势不太好')).toBe(true);
    expect(detectOffTopic('帮我测一下运势')).toBe(true);
    expect(detectOffTopic('给我算一卦')).toBe(false); // 未收录"算一卦"（长尾）→ 交 LLM 兜底
  });
});
