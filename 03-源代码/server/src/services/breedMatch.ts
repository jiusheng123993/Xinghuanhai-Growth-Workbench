/**
 * 品种名称 → 品种库条目匹配（纯函数，无 DB 依赖）
 * 用途：AI 聊天识图 / 追问品种时，LLM 给出的品种名可能是别名、简称或英文，
 * 需要归一化后在品种库（服务端权威 breed_knowledge 或前端 BREED_DATA 同构数据）中
 * 按 name / aliases 匹配出标准条目，供前端跳转品种详情页（breed-detail?id=...）。
 *
 * 正确性设计（2026-09-10 双 Agent 审查修复）：
 * 1. 物种一致性：query 含「猫/喵」或「狗/犬」时只保留该物种候选，避免
 *    「苏格兰猫」命中犬类「苏格兰梗」（其别名"苏格兰"⊂query 的跨物种误命中 P1）。
 * 2. 最长匹配优先：同档候选按命中 token 长度降序，摆脱"数组顺序决定结果"的依赖
 *    （如「重点色波斯」应命中更特异的别名"重点色波斯猫"=喜马拉雅猫，而非短别名"波斯"=波斯猫）。
 * 3. 异物种歧义守卫：与最优候选同档（exact + tokenLen 相同）存在异物种候选时不返回，
 *    由调用方按「未命中」作答，绝不跨物种硬跳详情页。
 */

/** 匹配结果：最小够用的品种信息（前端跳详情页 + 展示名） */
export interface BreedMatch {
  id: string;
  name: string;
  species: 'dog' | 'cat';
}

/** 参与匹配的品种条目最小结构（与 breed_knowledge 数据 / 前端 BreedItem 对齐） */
export interface MatchableBreed {
  id: string;
  name: string;
  species: string;
  aliases?: string[];
}

/** 归一化：去所有空白、转小写（英文别名大小写不敏感），中文不受影响 */
function normalize(s: string): string {
  return s.replace(/\s+/g, '').toLowerCase();
}

/**
 * 从 query 探测物种提示
 * 「猫/喵」→ cat，「狗/犬」→ dog；两者都无或都有 → null（不约束）。
 * 注：很多品种名本身不带物种词（"金毛""英短"），故 hint 只作"有明确物种词时"的过滤条件。
 */
function detectSpeciesHint(q: string): 'dog' | 'cat' | null {
  const hasCat = /猫|喵/.test(q);
  const hasDog = /狗|犬/.test(q);
  if (hasCat && !hasDog) return 'cat';
  if (hasDog && !hasCat) return 'dog';
  return null;
}

/**
 * 在品种库中匹配品种名
 * 匹配策略：先收集全部候选（name/aliases 的精确匹配 + 包含匹配），
 * 再按「物种提示过滤 → 精确优先 → 命中 token 最长优先」排序取最优，最后做异物种歧义守卫。
 * query 归一化长度 < 2 直接拒绝（防"猫/狗"单字把整库全命中）。
 * @param breeds 品种库条目数组（含 id/name/species/aliases）
 * @param query LLM 给出的品种名
 * @returns 匹配条目；未命中或跨物种歧义返回 null
 */
export function findBreedMatch(breeds: MatchableBreed[], query: string): BreedMatch | null {
  const q = normalize(query || '');
  // 单字（如"猫""狗"）不是具体品种，直接拒绝
  if (q.length < 2) return null;

  const hint = detectSpeciesHint(q);

  interface Candidate {
    breed: MatchableBreed;
    /** 是否为精确匹配（name/alias 全等） */
    exact: boolean;
    /** 命中的 token 长度（最长匹配优先的排序依据） */
    tokenLen: number;
  }
  const candidates: Candidate[] = [];

  for (const b of breeds) {
    if (b.species !== 'dog' && b.species !== 'cat') continue;
    const nb = normalize(b.name);
    // 精确匹配：name
    if (nb === q) candidates.push({ breed: b, exact: true, tokenLen: nb.length });
    // 精确匹配：alias
    for (const a of b.aliases || []) {
      const na = normalize(a);
      if (na === q) candidates.push({ breed: b, exact: true, tokenLen: na.length });
    }
    // 包含匹配：name（token 长度 ≥2 防过短误命中）
    if (nb.length >= 2 && (nb.includes(q) || q.includes(nb))) {
      candidates.push({ breed: b, exact: false, tokenLen: nb.length });
    }
    // 包含匹配：alias
    for (const a of b.aliases || []) {
      const na = normalize(a);
      if (na.length >= 2 && (na.includes(q) || q.includes(na))) {
        candidates.push({ breed: b, exact: false, tokenLen: na.length });
      }
    }
  }

  if (candidates.length === 0) return null;

  // 物种一致性过滤：query 带明确物种词时，只保留该物种（「苏格兰猫」→ 排除犬类「苏格兰梗」）
  const filtered = hint ? candidates.filter((c) => c.breed.species === hint) : candidates;
  // 物种词过滤后无候选 → 不硬套异物种，返回 null（由工具走「未找到」引导）
  if (filtered.length === 0) return null;

  // 排序：精确匹配优先；同档按命中 token 长度降序（最长匹配优先，摆脱数组顺序依赖）
  filtered.sort((a, b) => {
    if (a.exact !== b.exact) return a.exact ? -1 : 1;
    return b.tokenLen - a.tokenLen;
  });

  const best = filtered[0];

  // 异物种歧义守卫：与最优候选同档（exact + tokenLen 相同）存在异物种候选 → 歧义，返回 null
  const tiedCrossSpecies = filtered.some(
    (c) => c.breed.species !== best.breed.species && c.exact === best.exact && c.tokenLen === best.tokenLen,
  );
  if (tiedCrossSpecies) return null;

  return { id: best.breed.id, name: best.breed.name, species: best.breed.species as 'dog' | 'cat' };
}
