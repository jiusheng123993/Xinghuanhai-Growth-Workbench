/**
 * 提示词模板库单元测试（M2）
 * 覆盖：
 *   1. completeSections：缺失段补齐、完整 prompt 不重复补
 *   2. injectCharacters：有 CHARACTERS 段注入 / 无段时插入
 *   3. appendLocks：5 把连续性锁（COUNT LOCK / SCREEN DIRECTION / IDENTITY LOCK / ANATOMY LOCK / QUALITY LOCK），
 *      并用『锁条数与锁名齐全』一条断言把『锁只有 5 把』钉死，防止注释与实现再次漂移
 *   4. buildFinalSegmentPrompt：完整组装（多角色锚点 / 旧单锚点兜底）
 */
import { describe, it, expect } from 'vitest';
import {
  buildFinalSegmentPrompt,
  completeSections,
  injectCharacters,
  appendLocks,
  hasSection,
} from './promptTemplates.js';
import type { MemoirSegmentScript } from '../schemas/memoirScript.js';

/** 标准单镜脚本（十段完整的 prompt） */
function makeSegment(prompt: string): MemoirSegmentScript {
  return {
    photo_index: 0,
    shot_type: 'push_in',
    camera: 'close_up',
    lighting: 'golden_hour',
    transition: 'revealing',
    duration_sec: 5,
    seedance_prompt: prompt,
    narration: '十年前的那个下午，你第一次跳上窗台。',
    subtitle: '2016 年夏天 · 初遇',
  };
}

/** 十段完整的示例 prompt */
const FULL_PROMPT = `GLOBAL STYLE: 写实风格，柔和暖调；画面只出现这一只猫，无文字水印。
SCENE: 橘猫在窗台，黄昏，安静思念。
CHARACTERS: 角色=参考图1。
LOCATION: 窗台第三块砖，左侧绿萝。
FIRST FRAME: 猫在 x42%/y55%，头朝右。
Shot 1: 特写，缓慢推镜——耳朵在光里透出粉色，尾巴尖轻轻摆动。
OPTICS: 47°焦段，机位与猫眼同高。
PHYSICS: 毛发柔软随微风浮动。
LIGHTING: 黄昏暖光从左窗射入。
AUDIO: 安静午后，远处偶有车声；无音乐。`;

describe('promptTemplates 提示词模板库', () => {
  describe('completeSections 补全十段', () => {
    it('完整 prompt 不重复追加段落', () => {
      const result = completeSections(FULL_PROMPT);
      expect(result).toBe(FULL_PROMPT.trim());
    });

    it('缺失段自动补齐（LLM 只给了 3 段）', () => {
      const partial = 'GLOBAL STYLE: 写实风格。\nSCENE: 橘猫在窗台。\nLIGHTING: 黄昏暖光。';
      const result = completeSections(partial);
      // 十段全部出现
      expect(hasSection(result, 'GLOBAL STYLE')).toBe(true);
      expect(hasSection(result, 'SCENE')).toBe(true);
      expect(hasSection(result, 'CHARACTERS')).toBe(true);
      expect(hasSection(result, 'LOCATION')).toBe(true);
      expect(hasSection(result, 'FIRST FRAME')).toBe(true);
      expect(hasSection(result, 'OPTICS')).toBe(true);
      expect(hasSection(result, 'PHYSICS')).toBe(true);
      expect(hasSection(result, 'LIGHTING')).toBe(true);
      expect(hasSection(result, 'AUDIO')).toBe(true);
    });

    it('半角/全角冒号都识别为段落标记', () => {
      expect(hasSection('GLOBAL STYLE: 写实', 'GLOBAL STYLE')).toBe(true);
      expect(hasSection('GLOBAL STYLE：写实', 'GLOBAL STYLE')).toBe(true);
      expect(hasSection('   SCENE: 内容', 'SCENE')).toBe(true);
      expect(hasSection('Shot 1（特写，缓慢推镜）：耳朵微动。', 'Shot')).toBe(true);
    });
  });

  describe('injectCharacters 角色锚点强制注入', () => {
    it('已有 CHARACTERS 段 → 在段内注入锚点', () => {
      const anchorText = '宠物=参考图（橘色短毛猫，白色胸脯，右耳缺一角）。保持与参考照片完全一致。';
      const result = injectCharacters(FULL_PROMPT, anchorText);
      expect(result).toContain('橘色短毛猫，白色胸脯，右耳缺一角');
      expect(result).toContain('保持与参考照片完全一致');
    });

    it('无 CHARACTERS 段 → 在 GLOBAL STYLE 后插入整段', () => {
      const noChars = 'GLOBAL STYLE: 写实风格。\nSCENE: 橘猫在窗台。';
      const result = injectCharacters(noChars, '宠物=参考图（橘色短毛猫）。保持与参考照片完全一致。');
      expect(result).toContain('CHARACTERS: 宠物=参考图（橘色短毛猫）');
      // GLOBAL STYLE 仍在开头
      expect(result.startsWith('GLOBAL STYLE')).toBe(true);
    });
  });

  describe('appendLocks 连续性锁', () => {
    it('追加 COUNT LOCK / SCREEN DIRECTION / IDENTITY LOCK', () => {
      const result = appendLocks(FULL_PROMPT, 'right');
      expect(result).toContain('COUNT LOCK');
      expect(result).toContain('不出现额外动物、人物');
      expect(result).toContain('主体始终朝向画面右侧');
      expect(result).toContain('IDENTITY LOCK：保持每个主体的毛色、花纹、体型、五官与参考图一致');
      expect(result).toContain('避免生成任何文字或字幕');
      expect(result).toContain('ANATOMY LOCK');
      expect(result).toContain('高质量，细节丰富，电影质感');
    });

    it('未指定方向时保持参考首帧原始朝向，不强制镜像', () => {
      const result = appendLocks(FULL_PROMPT);
      expect(result).toContain('保持参考照片首帧中的原始朝向');
      expect(result).not.toContain('始终朝向画面右侧');
    });

    it('明确指定方向时可锁定到左侧', () => {
      const result = appendLocks(FULL_PROMPT, 'left');
      expect(result).toContain('主体始终朝向画面左侧');
    });

    it('锁条数与锁名齐全（锁固定 5 把，防注释与实现再次漂移）', () => {
      // 锁名清单只在这里写一次，条数由 LOCK_NAMES.length 推出 —— 避免同一个数字硬编码两遍后各自漂移。
      const LOCK_NAMES = ['COUNT LOCK', 'SCREEN DIRECTION', 'IDENTITY LOCK', 'ANATOMY LOCK', 'QUALITY LOCK'];
      const result = appendLocks(FULL_PROMPT, 'right');
      // 追加部分 = 原文之后的尾部（实现用空行分隔正文与锁块）
      const appended = result.slice(FULL_PROMPT.trim().length);
      const lockLines = appended.split('\n').filter((line) => line.trim().length > 0);
      // ① 条数：每行一把锁，行数必须等于锁名清单长度
      expect(lockLines).toHaveLength(LOCK_NAMES.length);
      // ② 锁名：逐把检查存在，且都出现在某一行的行首（即每把锁独占一行、名字未被截断）
      for (const name of LOCK_NAMES) {
        expect(result).toContain(name);
        expect(lockLines.some((line) => line.indexOf(name) === 0)).toBe(true);
      }
    });
  });

  describe('buildFinalSegmentPrompt 完整组装', () => {
    it('多角色：只注入本镜在场角色的锚点', () => {
      const segment = makeSegment('GLOBAL STYLE: 写实风格。\nSCENE: 猫和主人。');
      // 本镜只有猫在场（characters_present 只含 doubao）
      const scopedSegment: MemoirSegmentScript = {
        ...segment,
        characters_present: ['doubao'],
      };
      const result = buildFinalSegmentPrompt({
        segment: scopedSegment,
        anchors: [
          { id: 'doubao', type: 'pet', desc: '橘色短毛猫，白色胸脯' },
          { id: 'mama', type: 'human', desc: '女性，长发，米色毛衣' },
        ],
        screenDirection: 'right',
      });
      // 本镜注入在场角色（猫）
      expect(result).toContain('橘色短毛猫，白色胸脯');
      // 不在场角色（主人）不注入本镜
      expect(result).not.toContain('米色毛衣');
      // 角色类型标签正确
      expect(result).toContain('宠物=参考图');
      // Locks 追加
      expect(result).toContain('COUNT LOCK');
    });

    it('旧单锚点兜底（无 anchors 时用 identityAnchor）', () => {
      const segment = makeSegment('GLOBAL STYLE: 写实风格。\nSCENE: 橘猫在窗台。');
      const result = buildFinalSegmentPrompt({
        segment,
        anchors: [],
        identityAnchor: '橘色短毛猫，白色胸脯',
      });
      expect(result).toContain('橘色短毛猫，白色胸脯');
      // 缺失段补齐（LOCATION/OPTICS 等）
      expect(hasSection(result, 'LOCATION')).toBe(true);
      expect(hasSection(result, 'OPTICS')).toBe(true);
      expect(hasSection(result, 'AUDIO')).toBe(true);
      // Locks 追加
      expect(result).toContain('COUNT LOCK');
      expect(result).toContain('SCREEN DIRECTION');
    });

    it('不修改原始单镜对象（纯函数）', () => {
      const segment = makeSegment(FULL_PROMPT);
      const original = segment.seedance_prompt;
      buildFinalSegmentPrompt({
        segment,
        anchors: [],
        identityAnchor: '橘色短毛猫',
      });
      expect(segment.seedance_prompt).toBe(original);
    });
  });
});
