/**
 * agentRuleIntent.detectBreedQuestion 纯函数测试
 * 覆盖：命中品种提问的各类句式、不误伤普通闲聊/其他意图
 */
import { describe, it, expect } from 'vitest';
import { detectBreedQuestion } from '../agentRuleIntent.js';

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
