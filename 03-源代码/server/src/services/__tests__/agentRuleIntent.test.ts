/**
 * agentRuleIntent.detectBreedQuestion 纯函数测试
 * 覆盖：命中品种提问的各类句式、不误伤普通闲聊/其他意图
 */
import { describe, it, expect } from 'vitest';
import { detectBreedQuestion, detectOffTopic } from '../agentRuleIntent.js';

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

describe('detectOffTopic 越界话题拦截', () => {
  it('should match human romance/relationship topics', () => {
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
});
