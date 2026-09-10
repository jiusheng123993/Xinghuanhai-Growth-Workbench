/**
 * breedMatch.findBreedMatch 纯函数测试
 * 覆盖：名称/别名精确匹配、别名包含匹配、英文大小写不敏感、单字拒绝、物种过滤、未命中 null，
 * 以及用真实 breedSeed.json 全库驱动的跨物种误命中回归（P1 修复锁定）。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { findBreedMatch, type MatchableBreed } from '../breedMatch.js';

/** 测试用小型品种库（结构与 breed_knowledge 数据一致） */
const breeds: MatchableBreed[] = [
  { id: 'golden_retriever', name: '金毛寻回犬', species: 'dog', aliases: ['金毛', '黄金猎犬', 'Golden Retriever'] },
  { id: 'british_shorthair', name: '英国短毛猫', species: 'cat', aliases: ['英短', '英短猫'] },
  { id: 'labrador_retriever', name: '拉布拉多寻回犬', species: 'dog', aliases: ['拉布拉多', '拉布', 'Labrador Retriever'] },
];

describe('findBreedMatch', () => {
  it('should match by exact name when query is the full name', () => {
    expect(findBreedMatch(breeds, '金毛寻回犬')).toEqual({ id: 'golden_retriever', name: '金毛寻回犬', species: 'dog' });
  });

  it('should match by exact alias when query is an alias', () => {
    expect(findBreedMatch(breeds, '英短')).toEqual({ id: 'british_shorthair', name: '英国短毛猫', species: 'cat' });
  });

  it('should match when query contains an alias (英短猫 → 英短)', () => {
    expect(findBreedMatch(breeds, '英短猫')).toEqual({ id: 'british_shorthair', name: '英国短毛猫', species: 'cat' });
  });

  it('should match English alias case-insensitively', () => {
    expect(findBreedMatch(breeds, 'golden retriever')).toEqual({ id: 'golden_retriever', name: '金毛寻回犬', species: 'dog' });
    expect(findBreedMatch(breeds, 'GOLDEN RETRIEVER')).toEqual({ id: 'golden_retriever', name: '金毛寻回犬', species: 'dog' });
  });

  it('should ignore whitespace in query', () => {
    expect(findBreedMatch(breeds, ' 英短 ')).toEqual({ id: 'british_shorthair', name: '英国短毛猫', species: 'cat' });
  });

  it('should reject single-character query (如"猫""狗") to avoid over-matching', () => {
    expect(findBreedMatch(breeds, '猫')).toBeNull();
    expect(findBreedMatch(breeds, '狗')).toBeNull();
  });

  it('should return null for unknown breed', () => {
    expect(findBreedMatch(breeds, '不存在的品种xyz')).toBeNull();
  });

  it('should return null for empty query', () => {
    expect(findBreedMatch(breeds, '')).toBeNull();
    expect(findBreedMatch(breeds, '   ')).toBeNull();
  });

  it('should keep species distinct (dog breed not matched as cat)', () => {
    // 「英短」是猫，不能命中犬类别名（库中无「英短」犬别名，结果应为猫）
    const m = findBreedMatch(breeds, '英短');
    expect(m?.species).toBe('cat');
  });
});

// ============ 真实品种库全库回归（锁定 P1 跨物种误命中 + 最长匹配优先） ============
describe('findBreedMatch · breedSeed 全库回归', () => {
  // 读服务端权威种子库（与前端 BREED_DATA 同构，110 品种），用真实数据验证匹配正确性
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const seed = JSON.parse(
    readFileSync(path.resolve(__dirname, '../../data/breedSeed.json'), 'utf-8'),
  ) as { breeds: MatchableBreed[] };
  const full = seed.breeds;

  it('should never match a cat query to a dog breed (苏格兰猫 → 不得命中苏格兰梗)', () => {
    const m = findBreedMatch(full, '苏格兰猫');
    expect(m === null || m.species === 'cat').toBe(true);
  });

  it('should never match a cat query to a dog breed (藏獒猫 → 不得命中藏獒)', () => {
    const m = findBreedMatch(full, '藏獒猫');
    expect(m === null || m.species === 'cat').toBe(true);
  });

  it('should prefer the longest/most specific alias (重点色波斯 → 喜马拉雅猫，非波斯猫)', () => {
    const m = findBreedMatch(full, '重点色波斯');
    expect(m?.id).toBe('himalayan');
  });

  it('should match 英短猫 to 英国短毛猫 (contains alias 英短 + 物种 hint cat)', () => {
    expect(findBreedMatch(full, '英短猫')?.id).toBe('british_shorthair');
  });

  it('should match 金毛 to 金毛寻回犬', () => {
    expect(findBreedMatch(full, '金毛')?.id).toBe('golden_retriever');
  });

  it('should match full name 英国短毛猫 exactly', () => {
    expect(findBreedMatch(full, '英国短毛猫')?.id).toBe('british_shorthair');
  });
});
