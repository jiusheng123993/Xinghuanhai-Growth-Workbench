/**
 * 宠物提示词公共模块单元测试
 * 所有 AI 生图服务（全家福/头像/2D 表情包）共用此模块，重点验证：
 * 1. 绝不包含宠物名字（防「烧鸡」被画成鸡）
 * 2. 品种为空/含换行/超长时正确清洗兜底
 * 3. 性别前缀与物种中文名正确
 */
import { describe, it, expect } from 'vitest';
import { petSpeciesLabel, petSubjectText, translatePetNames, stripNamingPhrases, PET_BREED_FALLBACK, PET_IDENTITY_KEEP, PET_ONLY_ONE } from './petPrompt.js';

describe('petSpeciesLabel 物种中文名', () => {
  it('dog → 狗狗，cat → 猫咪，未知物种兜底为猫咪', () => {
    expect(petSpeciesLabel('dog')).toBe('狗狗');
    expect(petSpeciesLabel('cat')).toBe('猫咪');
    expect(petSpeciesLabel('rabbit')).toBe('猫咪');
  });
});

describe('petSubjectText 主体描述', () => {
  it('正常品种：一只英短猫咪（绝不包含名字——名字由调用方传入也不得进入）', () => {
    // 注意：petSubjectText 签名就没有名字参数，名字结构上无法泄漏
    expect(petSubjectText('英短', 'cat')).toBe('一只英短猫咪');
    expect(petSubjectText('金毛', 'dog')).toBe('一只金毛狗狗');
  });

  it('品种为空/undefined/null 时使用兜底描述', () => {
    expect(petSubjectText('', 'cat')).toBe(`一只${PET_BREED_FALLBACK}猫咪`);
    expect(petSubjectText(null, 'cat')).toBe(`一只${PET_BREED_FALLBACK}猫咪`);
    expect(petSubjectText(undefined, 'cat')).toBe(`一只${PET_BREED_FALLBACK}猫咪`);
  });

  it('「不确定品种」及同类口语词按品种缺失兜底（防文生图把「不确定」当指令）', () => {
    expect(petSubjectText('不确定品种', 'cat')).toBe(`一只${PET_BREED_FALLBACK}猫咪`);
    expect(petSubjectText('不确定品种', 'dog')).toBe(`一只${PET_BREED_FALLBACK}狗狗`);
    expect(petSubjectText('混血', 'cat')).toBe(`一只${PET_BREED_FALLBACK}猫咪`);
    expect(petSubjectText('土猫串串', 'cat')).toBe(`一只${PET_BREED_FALLBACK}猫咪`);
  });

  it('品种含换行/多余空白时清洗并截断（防污染提示词结构）', () => {
    expect(petSubjectText('英短\n布偶', 'cat')).toBe('一只英短 布偶猫咪');
    expect(petSubjectText('  中华田园  ', 'cat')).toBe('一只中华田园猫咪');
    // 超长品种截断到 20 字
    expect(petSubjectText('非常非常非常非常非常非常非常非常非常非常非常长的品种名', 'cat')).toHaveLength('一只'.length + 20 + '猫咪'.length);
  });

  it('性别前缀正确插入：一只母英短猫咪 / 一只公金毛狗狗', () => {
    expect(petSubjectText('英短', 'cat', '母')).toBe('一只母英短猫咪');
    expect(petSubjectText('金毛', 'dog', '公')).toBe('一只公金毛狗狗');
  });
});

describe('约束常量（对应提示词库 §0.6/§四）', () => {
  it('角色一致性约束包含毛色/花纹/体型/五官锁定', () => {
    expect(PET_IDENTITY_KEEP).toContain('参考图');
    expect(PET_IDENTITY_KEEP).toContain('毛色');
    expect(PET_IDENTITY_KEEP).toContain('完全一致');
  });

  it('主体锁定禁止出现其他动物/人物/食物', () => {
    expect(PET_ONLY_ONE).toContain('只出现这一只宠物');
    expect(PET_ONLY_ONE).toContain('不要出现其他动物');
  });
});

describe('translatePetNames 名字→外貌指代转译（用户用名字说话，模型收到外貌语言）', () => {
  const twoPets = [
    { name: '烧鸡', breed: '英短', species: 'cat' },
    { name: '烧鸭', breed: '田园白猫', species: 'cat' },
  ];

  it('单只宠物：「烧鸡戴生日帽」→「那只英短猫咪戴生日帽」，名字不残留', () => {
    const out = translatePetNames('烧鸡戴着生日帽', [twoPets[0]]);
    expect(out).toBe('那只英短猫咪戴着生日帽');
    expect(out).not.toContain('烧鸡');
  });

  it('多只宠物：按数组顺序生成「左起第一只/第二只」方位指代（配合全家福排位）', () => {
    const out = translatePetNames('烧鸡追着烧鸭跑', twoPets);
    expect(out).toBe('左起第一只英短猫咪追着左起第二只田园白猫猫咪跑');
    expect(out).not.toContain('烧鸡');
    expect(out).not.toContain('烧鸭');
  });

  it('名字集合外的词一律不动；未命中时原样返回', () => {
    expect(translatePetNames('铺满落叶的秋日森林小径', twoPets)).toBe('铺满落叶的秋日森林小径');
    expect(translatePetNames('', twoPets)).toBe('');
  });

  it('空名/超长名跳过；重名去重不产生序号空洞；长名优先替换防子串误伤', () => {
    // 空名与 >20 字名不参与转译
    const weird = [
      { name: '  ', breed: '英短', species: 'cat' },
      { name: 'x'.repeat(21), breed: '英短', species: 'cat' },
      { name: '咪咪', breed: '', species: 'cat' },
    ];
    expect(translatePetNames('咪咪在睡觉', weird)).toBe(`那只${PET_BREED_FALLBACK}猫咪在睡觉`);
    // 「小猫咪」包含「小猫」：长名先替换，剩余文本再替换短名
    const pair = [
      { name: '小猫', breed: '橘猫', species: 'cat' },
      { name: '小猫咪', breed: '蓝猫', species: 'cat' },
    ];
    const out = translatePetNames('小猫咪和小猫在玩', [...pair].reverse());
    expect(out).not.toContain('小猫咪和小猫');
  });
});

/**
 * stripNamingPhrases —— 命名句式（结构性）清洗
 *
 * 这一组锁的是「白名单拦不住 LLM 编造名字」这个缺口：translatePetNames 只认宠物档案里
 * 已有的名字，而分镜脚本里出现的「小橘」「大黄」这类编造名字只能靠句法结构拦。
 * 用例分三类：
 * ① 正面：命名句式必须清干净、且不留残渣
 * ② 负面：高频动词「叫」与正常句子绝不能被改坏（宁可漏一个名字，也不能改坏句子）
 * ③ 已知边界：当前算法确实会漏 / 会多删的情况，全部显式钉住，防止以后悄悄漂移
 */
describe('stripNamingPhrases 命名句式结构性清洗（拦白名单拦不住的编造名字）', () => {
  /**
   * 通用残渣体检，逐项对应任务书点名的残渣形态：
   * - 「叫的」「唤作的」：名字删了、命名框架没删干净
   * - 「，，」：删除点两侧标点撞在一起
   * - 句首悬空标点（如「，它很胖」）
   * - 多余空格（含首尾）
   */
  const expectNoResidue = (out: string): void => {
    expect(out).not.toMatch(/叫的|唤作的|名叫的/);
    expect(out).not.toMatch(/[，、；：]{2,}/);
    expect(out).not.toMatch(/^[，、；：。！？…]/);
    expect(out).not.toMatch(/\s{2,}|^\s|\s$/);
  };

  describe('正面：命名句式必须被清掉（输入里的名字不在任何档案里，白名单够不着）', () => {
    it('用例1 裸「叫」：「一只叫小橘的猫在窗台上」→「一只猫在窗台上」', () => {
      // 「叫」是高频动词，本案必须靠「叫 X 的 + 宠物名词」的句法才能认定是起名
      const out = stripNamingPhrases('一只叫小橘的猫在窗台上');
      expect(out).toBe('一只猫在窗台上');
      expect(out).not.toContain('小橘');
      expectNoResidue(out);
    });

    it('用例2 「名叫大黄的狗狗趴着」→「狗狗趴着」', () => {
      const out = stripNamingPhrases('名叫大黄的狗狗趴着');
      expect(out).toBe('狗狗趴着');
      expect(out).not.toContain('大黄');
      expectNoResidue(out);
    });

    it('用例3 「这只狗名字是旺财」→「这只狗」', () => {
      const out = stripNamingPhrases('这只狗名字是旺财');
      expect(out).toBe('这只狗');
      expect(out).not.toContain('旺财');
      expectNoResidue(out);
    });

    it('用例4 「那只猫叫作咪咪，正在睡觉」→「那只猫，正在睡觉」（保留停顿逗号）', () => {
      // 逗号**刻意保留**：吃掉它会把「这只狗名字是旺财，那只猫叫小黑」粘成
      // 「这只狗那只猫叫小黑」，两个主体糊成一团，比留一个停顿逗号更糟
      const out = stripNamingPhrases('那只猫叫作咪咪，正在睡觉');
      expect(out).toBe('那只猫，正在睡觉');
      expect(out).not.toContain('咪咪');
      expectNoResidue(out);
    });

    it('用例5 「唤作小黑的猫」→「猫」', () => {
      const out = stripNamingPhrases('唤作小黑的猫');
      expect(out).toBe('猫');
      expect(out).not.toContain('小黑');
      expectNoResidue(out);
    });

    it('用例6 「昵称是团子」→ 空串（整句只有命名部分）', () => {
      const out = stripNamingPhrases('昵称是团子');
      expect(out).toBe('');
      expect(out).not.toContain('团子');
      expectNoResidue(out);
    });

    it('定语式：「名叫旺财的那只猫」→「那只猫」（「的」随命名框架一起删，不留悬空「的」）', () => {
      const out = stripNamingPhrases('名叫旺财的那只猫');
      expect(out).toBe('那只猫');
      expectNoResidue(out);
    });

    it('定语式+外貌修饰：「名叫旺财的橘猫追着狗」→「橘猫追着狗」（「的」后允许 1~2 字修饰）', () => {
      const out = stripNamingPhrases('名叫旺财的橘猫追着狗');
      expect(out).toBe('橘猫追着狗');
      expectNoResidue(out);
    });

    it('多句混排：「一只叫小橘的猫，名叫旺财的狗在旁边」→「一只猫，狗在旁边」', () => {
      const out = stripNamingPhrases('一只叫小橘的猫，名叫旺财的狗在旁边');
      expect(out).toBe('一只猫，狗在旁边');
      expect(out).not.toContain('小橘');
      expect(out).not.toContain('旺财');
      expectNoResidue(out);
    });

    it('候选段长度上限：8 字以内算名字；超过 8 字不当作名字（防把一整句话当名字删掉）', () => {
      expect(stripNamingPhrases('名叫abcdefgh的猫')).toBe('猫');
      expect(stripNamingPhrases('名叫abcdefghij的猫')).toBe('名叫abcdefghij的猫');
    });

    it('候选段不能为空：「名叫的猫」原样不动（防「名叫，」这类残渣）', () => {
      expect(stripNamingPhrases('名叫的猫')).toBe('名叫的猫');
    });

    it('左邻标点：「汪汪。名字是旺财。今天天气好」→「汪汪。今天天气好」（撞在一起的同种标点吃掉一个）', () => {
      const out = stripNamingPhrases('汪汪。名字是旺财。今天天气好');
      expect(out).toBe('汪汪。今天天气好');
      expectNoResidue(out);
    });

    it('删除段落在句首：「名字是旺财。今天天气好」→「今天天气好」（连它身后失去依附的句号一起带走）', () => {
      const out = stripNamingPhrases('名字是旺财。今天天气好');
      expect(out).toBe('今天天气好');
      expectNoResidue(out);
    });

    it('左邻「的」：「这只狗的名字是旺财」→「这只狗」（不留下悬空的「这只狗的」）', () => {
      expect(stripNamingPhrases('这只狗的名字是旺财')).toBe('这只狗');
    });

    it('前后有空格时折叠并去首尾空白（不产生多余空格）', () => {
      expect(stripNamingPhrases('  一只叫小橘的猫  ')).toBe('一只猫');
    });
  });

  describe('负面：绝不误伤（全是「叫」当普通动词 / 不该动的正常句子）', () => {
    it('「他叫我过去」原样：代词「我」被名字段的代词否定挡住，且「叫我」后面没有「的+宠物名词」', () => {
      // 两道防线都要写清：① 名字候选段不允许以人称代词开头；② 裸「叫」只认「叫X的+宠物名词」
      expect(stripNamingPhrases('他叫我过去')).toBe('他叫我过去');
    });

    it('「老板叫你过去一下」原样：同上，换成「你」', () => {
      expect(stripNamingPhrases('老板叫你过去一下')).toBe('老板叫你过去一下');
    });

    it('「门口有人在叫卖」原样：「叫卖」是动词复合，裸「叫」后面没有「的+宠物名词」', () => {
      // 若只按「叫」判名字，「叫卖」的「卖」会被当成名字删掉（实测反例），所以裸「叫」必须配句式
      expect(stripNamingPhrases('门口有人在叫卖')).toBe('门口有人在叫卖');
    });

    it('「这只狗在叫」原样：「叫」在句末，既无命名标记也无「的」', () => {
      expect(stripNamingPhrases('这只狗在叫')).toBe('这只狗在叫');
    });

    it('「他叫我过去的时候」原样：有「的」，但代词 + 「的时候」是时间状语不是定语', () => {
      expect(stripNamingPhrases('他叫我过去的时候')).toBe('他叫我过去的时候');
    });

    it('「他叫我的猫过来」原样：「叫我」被代词挡；即便放开代词，「我的猫」也不是「叫X的猫」', () => {
      expect(stripNamingPhrases('他叫我的猫过来')).toBe('他叫我的猫过来');
    });

    it('「他叫小黑的时候猫会来」原样：「的」后接「时候」是时间状语，否定前瞻命中（宁可漏）', () => {
      // 这条是本次实现里真实踩过的坑：忘了把守卫里的「的」去掉，会把句子删成「他时候猫会来」
      expect(stripNamingPhrases('他叫小黑的时候猫会来')).toBe('他叫小黑的时候猫会来');
    });

    it('「名叫小明的学生」原样：「学生」不是宠物名词；且右边界是「的」时必须整条不匹配（防「明的学生」）', () => {
      expect(stripNamingPhrases('名叫小明的学生')).toBe('名叫小明的学生');
    });

    it('「名叫小明的」原样：名字后既无标点也无句末，右边界不成立', () => {
      expect(stripNamingPhrases('名叫小明的')).toBe('名叫小明的');
    });

    it('「猫叫，狗也叫」原样：逗号在「叫」后面，不是「叫X的」结构', () => {
      expect(stripNamingPhrases('猫叫，狗也叫')).toBe('猫叫，狗也叫');
    });

    it('裸「叫」+ 动词补语原样：「被叫醒的猫咪」「被邻居叫走的狗」「隔壁叫春的猫」', () => {
      // 这三条是自审时找出来的真误伤：没有补语守卫会变成「被猫咪」「被邻居狗」「隔壁猫」
      expect(stripNamingPhrases('被叫醒的猫咪')).toBe('被叫醒的猫咪');
      expect(stripNamingPhrases('被邻居叫走的狗')).toBe('被邻居叫走的狗');
      expect(stripNamingPhrases('隔壁叫春的猫')).toBe('隔壁叫春的猫');
    });

    it('「有人在叫卖小猫」原样：「小猫」是「叫卖」的宾语，不是名字', () => {
      expect(stripNamingPhrases('有人在叫卖小猫')).toBe('有人在叫卖小猫');
    });

    it('「他在叫狗的名字」原样：这是「喊」，不是起名', () => {
      expect(stripNamingPhrases('他在叫狗的名字')).toBe('他在叫狗的名字');
    });

    it('「给猫取名字」原样：「取名字」是普通说法，不是命名句式（标记里用了否定前瞻排除「字」）', () => {
      expect(stripNamingPhrases('给猫取名字')).toBe('给猫取名字');
    });

    it('已由白名单处理过的文本原样（幂等，不重复处理、不产残渣）', () => {
      const whitelisted = translatePetNames('烧鸡戴着生日帽', [{ name: '烧鸡', breed: '英短', species: 'cat' }]);
      expect(whitelisted).toBe('那只英短猫咪戴着生日帽');
      expect(stripNamingPhrases(whitelisted)).toBe('那只英短猫咪戴着生日帽');
    });

    it('未命中时原样返回（含空串），且连续调用结果不变（幂等）', () => {
      expect(stripNamingPhrases('铺满落叶的秋日森林小径')).toBe('铺满落叶的秋日森林小径');
      expect(stripNamingPhrases('')).toBe('');
      const once = stripNamingPhrases('一只叫小橘的猫在窗台上');
      expect(stripNamingPhrases(once)).toBe(once);
    });
  });

  describe('与 translatePetNames 的调用顺序（推荐：先结构性清洗，再白名单替换）', () => {
    const pets = [{ name: '烧鸡', breed: '英短', species: 'cat' }];

    it('推荐顺序（先 strip 后 translate）：命名框架被结构清洗吃掉，白名单只看到剩下的普通文本', () => {
      const raw = '名叫烧鸡的猫在叫，烧鸡盯着窗外';
      const out = translatePetNames(stripNamingPhrases(raw), pets);
      expect(out).toBe('猫在叫，那只英短猫咪盯着窗外');
      expect(out).not.toContain('烧鸡');
    });

    it('反序（先 translate 后 strip）结果同样不含名字，两者不互相破坏', () => {
      // 反序的中间态会出现「名叫那只英短猫咪的猫」这种别扭文本，所以推荐顺序是先结构后白名单；
      // 但最终结果一致，锁在这里防止以后改动让某一种顺序漏名字
      const raw = '名叫烧鸡的猫在叫，烧鸡盯着窗外';
      const out = stripNamingPhrases(translatePetNames(raw, pets));
      expect(out).toBe('猫在叫，那只英短猫咪盯着窗外');
      expect(out).not.toContain('烧鸡');
    });
  });

  describe('已知边界（自曝：会漏 / 会多删，钉住当前行为，详见交付正文）', () => {
    it('多删：名字后紧跟正文且没有标点时，边界无法判定，会按最长候选一并删掉', () => {
      // 「今天很乖」被当作名字的一部分删除——名字确实没了（安全目标达成），但正文有损失；
      // 真实调用应保证名字后带标点，或依赖白名单 + 本函数双重兜底
      expect(stripNamingPhrases('这只狗名字是旺财今天很乖')).toBe('这只狗');
    });

    it('漏网：裸「叫」后面没有「的」时不动（「她叫咪咪」「隔壁的猫叫小黑」）', () => {
      // 宁可漏：放开这类会立刻误伤「他叫我过去」，而漏掉的名字仍可由 translatePetNames 白名单兜住
      expect(stripNamingPhrases('她叫咪咪')).toBe('她叫咪咪');
      expect(stripNamingPhrases('隔壁的猫叫小黑')).toBe('隔壁的猫叫小黑');
    });

    it('不区分主体：显式命名标记一律清（「这本书的名字是小王子」→「这本书」）', () => {
      // 本函数的契约是「删掉一切命名框架与名字」，不判断主体是不是宠物；对人名/书名同样生效
      expect(stripNamingPhrases('这本书的名字是小王子')).toBe('这本书');
    });

    it('错序不粘连：两句话各自有命名框架时，标点保留，两个主体不会被粘成一个', () => {
      expect(stripNamingPhrases('这只狗名叫旺财，那只猫叫小黑')).toBe('这只狗，那只猫叫小黑');
    });
  });

  /**
   * 【2026-09-19 队长接线】句式级清洗已合进 translatePetNames，调用方无需再单独调用。
   * 这两条锁的是「接了线才真的生效」——只实现不接入等于死代码，缺口照样敞着。
   */
  describe('translatePetNames 已内置句式级清洗（接线验证）', () => {
    it('档案里没有任何名字时，LLM 编造名依然被清掉（旧实现会在这里提前 return 漏出去）', () => {
      const out = translatePetNames('一只叫小橘的猫在窗台上', [
        { name: null, breed: '英短', species: 'cat' },
      ]);
      expect(out).not.toContain('小橘');
      expect(out).toBe('一只猫在窗台上');
    });

    it('已知名字与编造名同时出现时，两道清洗都生效', () => {
      const out = translatePetNames('烧鸡和一只叫小橘的猫', [
        { name: '烧鸡', breed: '英短', species: 'cat' },
      ]);
      expect(out).not.toContain('烧鸡');
      expect(out).not.toContain('小橘');
    });

    it('负向：正常句子不被接线误伤', () => {
      expect(translatePetNames('他叫我过去', [{ name: null, breed: null, species: 'cat' }])).toBe(
        '他叫我过去',
      );
    });
  });

  /**
   * 【2026-09-19 独立复核回归】审-1 攻出了 5 条**真漏网**：定语式修饰上限原为 `{0,2}`，
   * 而「品种+颜色」（≥3 字）恰是 LLM 分镜与用户自定义场景的默认写法 ⇒ 整条正则不匹配 ⇒
   * **编造名字原样进提示词**。本组用例就是当时那 5 条反例，钉死「上限已放宽」这件事。
   */
  describe('回归：定语修饰 ≥3 字时的编造名泄漏（复核 §3.1 的五条反例）', () => {
    it('名叫旺财的一只橘猫', () => {
      expect(stripNamingPhrases('名叫旺财的一只橘猫')).toBe('一只橘猫');
    });

    it('那只叫旺财的英短蓝猫', () => {
      expect(stripNamingPhrases('那只叫旺财的英短蓝猫')).toBe('那只英短蓝猫');
    });

    it('那只叫小黑的白色长毛猫', () => {
      expect(stripNamingPhrases('那只叫小黑的白色长毛猫')).toBe('那只白色长毛猫');
    });

    it('名叫团子的白色萨摩耶', () => {
      expect(stripNamingPhrases('名叫团子的白色萨摩耶')).toBe('白色萨摩耶');
    });

    it('叫旺财的邻居家的狗', () => {
      expect(stripNamingPhrases('叫旺财的邻居家的狗')).toBe('邻居家的狗');
    });

    it('五条一起断言：结果一律不含编造名', () => {
      const cases = [
        '名叫旺财的一只橘猫',
        '那只叫旺财的英短蓝猫',
        '那只叫小黑的白色长毛猫',
        '名叫团子的白色萨摩耶',
        '叫旺财的邻居家的狗',
      ];
      for (const c of cases) {
        expect(stripNamingPhrases(c)).not.toMatch(/旺财|小黑|团子/);
      }
    });
  });

  /**
   * 【2026-09-19 独立复核回归】复核另发现「裸叫 + 补语」会咬出粘连残渣
   * （`它叫得很大声的猫` → `它猫`）。处置是宁可漏：`得/了/着` 开头的补语一律不当作名字候选。
   * ⇒ 这些句子应当**原样不动**。
   */
  describe('回归：裸「叫」+ 补语不得咬出粘连残渣（复核 §3.2）', () => {
    it('叫得很大声 → 原样不动（不得变成「它猫」）', () => {
      expect(stripNamingPhrases('它叫得很大声的猫')).toBe('它叫得很大声的猫');
    });

    it('叫了两声 → 原样不动（不得变成「报警器狗」）', () => {
      expect(stripNamingPhrases('报警器叫了两声的狗')).toBe('报警器叫了两声的狗');
    });

    it('叫着玩 → 原样不动', () => {
      expect(stripNamingPhrases('那只叫着玩的猫')).toBe('那只叫着玩的猫');
    });
  });
});
