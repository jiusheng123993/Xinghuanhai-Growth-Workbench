/**
 * 全家福提示词构建单元测试
 * 重点验证「提示词安全」，防止重演线上翻车：
 * 1. 宠物名字绝不进入提示词（猫咪叫「烧鸡」不能被画成一只鸡）
 * 2. 数量与物种明确（四只猫不会被画成一只）
 * 3. 品种为空时有兜底（不出现空串/undefined）
 * 4. 含参考图一致性约束与主体锁定（对应提示词库 §0.6/§四）
 */
import { describe, it, expect, vi } from 'vitest';

// mock 数据库与配置，避免单测触发真实连接
vi.mock('../db.js', () => ({ pool: { query: vi.fn() } }));
// 转存走真实 jimp 太重，本文件只测提示词构建，mock 成透传
vi.mock('./imageBadge.js', () => ({ hostAiImage: vi.fn(async (url: string) => url) }));
vi.mock('../config.js', () => ({
  config: {
    jwtSecret: 'test-jwt-secret',
    port: 3000,
    databaseUrl: 'postgresql://localhost/test',
    ai: { apiKey: '', baseUrl: '', model: '' },
    seedream: { apiKey: 'test-seedream-key' },
    meshy: { apiKey: '' },
    wechat: { appId: '', secret: '' },
    uploadDir: './uploads',
  },
}));

import {
  buildPrompt,
  FAMILY_PHOTO_STYLES,
  FAMILY_PHOTO_SCENES,
  isBrandPresetUrl,
  type MemberInfo,
} from './familyPhotoService.js';
// schema 白名单与场景清单的契约同步在此锁死（两处内联清单，改一处忘另一处会直接红）
import { generateFamilyPhotoSchema, FAMILY_PHOTO_SCENE_KEYS } from '../schemas/index.js';

/** 模拟用户家的四只猫（其中一只叫「烧鸡」——名字绝不能进入提示词） */
const fourCats: MemberInfo[] = [
  { petId: 'p1', name: '烧鸡', species: 'cat', breed: '英短', photoUrl: 'https://example.com/1.jpg' },
  { petId: 'p2', name: '奶茶', species: 'cat', breed: '美短', photoUrl: 'https://example.com/2.jpg' },
  { petId: 'p3', name: '布丁', species: 'cat', breed: '布偶', photoUrl: 'https://example.com/3.jpg' },
  { petId: 'p4', name: '团子', species: 'cat', breed: '中华田园', photoUrl: 'https://example.com/4.jpg' },
];

describe('buildPrompt 提示词安全', () => {
  it('提示词中绝不出现宠物名字（「烧鸡」不能被画成鸡）', () => {
    const prompt = buildPrompt(fourCats, 'pixar');
    // 名字不进提示词
    expect(prompt).not.toContain('烧鸡');
    expect(prompt).not.toContain('奶茶');
    // 旧模板的英文 named 结构必须消失
    expect(prompt).not.toContain('named');
    // 不出现任何"鸡"相关英文词
    expect(prompt).not.toContain('chicken');
    expect(prompt).not.toContain('roast');
  });

  it('明确数量与物种：四只猫不会被画成一只', () => {
    const prompt = buildPrompt(fourCats, 'pixar');
    expect(prompt).toContain('4只猫咪');
    expect(prompt).toContain('猫咪');
    expect(prompt).not.toContain('狗狗');
    expect(prompt).toContain('不要出现其他动物');
  });

  it('每只宠物的品种都写入提示词（外貌描述更具体）', () => {
    const prompt = buildPrompt(fourCats, 'ghibli');
    expect(prompt).toContain('英短');
    expect(prompt).toContain('美短');
    expect(prompt).toContain('布偶');
    expect(prompt).toContain('中华田园');
  });

  it('品种为空时使用兜底描述，不出现空串/undefined', () => {
    const members: MemberInfo[] = [
      { petId: 'p1', name: '烧鸡', species: 'cat', breed: '', photoUrl: null },
      { petId: 'p2', name: '旺财', species: 'cat', breed: null, photoUrl: null },
    ];
    const prompt = buildPrompt(members, 'oil');
    expect(prompt).not.toContain('undefined');
    expect(prompt).not.toContain('null');
    expect(prompt).toContain('毛茸茸的猫咪');
    expect(prompt).toContain('2只猫咪');
  });

  it('猫狗混合家庭分别计数', () => {
    const members: MemberInfo[] = [
      { petId: 'p1', name: '咪咪', species: 'cat', breed: '英短', photoUrl: null },
      { petId: 'p2', name: '旺财', species: 'dog', breed: '金毛', photoUrl: null },
      { petId: 'p3', name: '小白', species: 'dog', breed: '萨摩耶', photoUrl: null },
    ];
    const prompt = buildPrompt(members, 'nordic');
    expect(prompt).toContain('1只猫咪');
    expect(prompt).toContain('2只狗狗');
    expect(prompt).toContain('一只金毛狗狗');
    expect(prompt).toContain('一只萨摩耶狗狗');
  });

  it('包含参考图一致性约束与主体锁定（对应提示词库角色锁定规范）', () => {
    const prompt = buildPrompt(fourCats, 'ink');
    expect(prompt).toContain('参考图');
    expect(prompt).toContain('完全一致');
    expect(prompt).toContain('不增减数量');
    expect(prompt).toContain('不要出现其他动物、人物或食物');
  });

  it('多只时声明"从左到右依次是"且顺序=成员数组顺序（排位→方位的翻译层）', () => {
    const members: MemberInfo[] = [
      { petId: 'p1', name: '烧鸡', species: 'cat', breed: '英短', photoUrl: 'https://e.com/1.png' },
      { petId: 'p2', name: '烧鸭', species: 'cat', breed: '布偶', photoUrl: 'https://e.com/2.png' },
    ];
    const prompt = buildPrompt(members, 'pixar');
    expect(prompt).toContain('从左到右依次是：一只英短猫咪、一只布偶猫咪');
    // 参考图顺序对应句（多只+有参考图才出现）
    expect(prompt).toContain('参考照片的顺序与画面从左到右的宠物顺序一一对应');
    // 单只时不出现方位话术
    const single = buildPrompt([members[0]], 'pixar');
    expect(single).not.toContain('从左到右依次是');
  });
});

describe('isBrandPresetUrl 品牌默认头像判定', () => {
  it('服务端 home-style 品牌头像判定为默认（不是真实形象）', () => {
    expect(isBrandPresetUrl('https://api.xinghuanhai.com/uploads/avatars/home-style/cat/cat-01-orange-tabby.png')).toBe(true);
    expect(isBrandPresetUrl('/uploads/avatars/home-style/dog/dog-01-golden.png')).toBe(true);
  });

  it('本地预设资源 preset-home 判定为默认', () => {
    expect(isBrandPresetUrl('https://example.com/assets/preset-home/cat/cat-02-british-blue.png')).toBe(true);
  });

  it('真实照片 / AI 生成形象判定为非默认', () => {
    expect(isBrandPresetUrl('https://api.xinghuanhai.com/uploads/pet-photos/u/pet-1/a.jpg')).toBe(false);
    expect(isBrandPresetUrl('https://cdn.seedream.example.com/abcdef.png')).toBe(false);
  });

  it('空值判定为 false', () => {
    expect(isBrandPresetUrl(null)).toBe(false);
    expect(isBrandPresetUrl(undefined)).toBe(false);
    expect(isBrandPresetUrl('')).toBe(false);
  });
});

describe('FAMILY_PHOTO_STYLES 全部风格可用', () => {
  it('6 种风格均有完整提示词（风格词 + 主体约束）', () => {
    for (const style of FAMILY_PHOTO_STYLES) {
      const prompt = buildPrompt(fourCats, style);
      expect(prompt.length).toBeGreaterThan(80);
    }
  });

  it('风格关键词已接入提示词库 §六（抽查皮克斯/吉卜力/赛博朋克/水墨）', () => {
    expect(buildPrompt(fourCats, 'pixar')).toContain('Pixar style');
    expect(buildPrompt(fourCats, 'ghibli')).toContain('Studio Ghibli style');
    expect(buildPrompt(fourCats, 'cyberpunk')).toContain('neon lights');
    expect(buildPrompt(fourCats, 'ink')).toContain('Chinese ink wash painting');
    expect(buildPrompt(fourCats, 'nordic')).toContain('Scandinavian design');
    expect(buildPrompt(fourCats, 'oil')).toContain('impasto');
  });
});

describe('全家福场景模板（SCENE_PROMPTS 多维精美描写）', () => {
  it('不传场景时默认使用温馨客厅', () => {
    const prompt = buildPrompt(fourCats, 'pixar');
    // 默认场景的"时间光源+层次+道具"多维描写进入提示词
    expect(prompt).toContain('温馨客厅一角');
    expect(prompt).toContain('布艺沙发');
  });

  it('指定场景时对应场景描写进入提示词', () => {
    expect(buildPrompt(fourCats, 'pixar', 'seaside')).toContain('海边日落');
    expect(buildPrompt(fourCats, 'ghibli', 'christmas')).toContain('圣诞树前');
    expect(buildPrompt(fourCats, 'ink', 'sakura')).toContain('樱花树下');
  });

  it('全部场景都能构建出含多维描写的完整提示词（防新增场景漏写 SCENE_PROMPTS）', () => {
    for (const scene of FAMILY_PHOTO_SCENES) {
      const prompt = buildPrompt(fourCats, 'nordic', scene);
      // 场景库升级后每段描写都显著长于旧版单句（>120 字符），防止退回"温馨客厅，柔和光线"式贫瘠描写
      expect(prompt.length).toBeGreaterThan(120);
    }
  });

  it('自定义场景清洗后拼进提示词（换行转空格 + 压缩空白）', () => {
    const prompt = buildPrompt(fourCats, 'pixar', 'livingroom', '在我家的院子里\n\n阳光很好');
    expect(prompt).toContain('在我家的院子里 阳光很好');
  });

  it('自定义场景超长时截断到 60 字', () => {
    const prompt = buildPrompt(fourCats, 'pixar', 'livingroom', 'a'.repeat(80));
    expect(prompt).toContain('a'.repeat(60));
    expect(prompt).not.toContain('a'.repeat(61));
  });

  it('自定义场景为纯空白时视同未填，与不传完全一致', () => {
    expect(buildPrompt(fourCats, 'pixar', 'livingroom', '   \n\t ')).toBe(
      buildPrompt(fourCats, 'pixar', 'livingroom'),
    );
  });
});

describe('scene 白名单契约同步（schema ↔ FAMILY_PHOTO_SCENES）', () => {
  it('双向集合相等：FAMILY_PHOTO_SCENES 与 schema 的 FAMILY_PHOTO_SCENE_KEYS 完全一致', () => {
    // 双向深比较锁死同步：单向"服务端 ⊆ schema"会漏掉"schema 多加 key 但
    // 服务端没写 SCENE_PROMPTS"的情况（运行时会把 "undefined" 拼进提示词）
    expect([...FAMILY_PHOTO_SCENE_KEYS].sort()).toEqual([...FAMILY_PHOTO_SCENES].sort());
  });

  it('schema 接受场景清单的全部 key（两处内联白名单保持一致）', () => {
    for (const scene of FAMILY_PHOTO_SCENES) {
      const result = generateFamilyPhotoSchema.safeParse({ style: 'pixar', scene });
      expect(result.success).toBe(true);
    }
  });

  it('已下线的旧 key（starry）被 schema 拒收', () => {
    const result = generateFamilyPhotoSchema.safeParse({ style: 'pixar', scene: 'starry' });
    expect(result.success).toBe(false);
  });

  it('非法场景 key 被拒收；customScene 超 60 字被拒收；两者均可省略', () => {
    expect(generateFamilyPhotoSchema.safeParse({ style: 'pixar', scene: 'moon-palace' }).success).toBe(false);
    expect(generateFamilyPhotoSchema.safeParse({ style: 'pixar', customScene: 'x'.repeat(61) }).success).toBe(false);
    expect(generateFamilyPhotoSchema.safeParse({ style: 'pixar' }).success).toBe(true);
  });
});
