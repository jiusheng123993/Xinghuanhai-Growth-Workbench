/**
 * 家庭页小动物头像映射（主包数据模块）
 *
 * 为什么放主包 data 而非 pagesPet 分包：
 * - 家庭页（pages/family）在主包，主包不能 import 分包资源；
 * - 20 张头像图片已压缩为 256px WebP（共约 206KB）放在服务器 uploads/avatars/home-style/，
 *   由服务端 /uploads 静态托管，前端用 resolveAvatarUrl 拼出绝对地址，不占小程序包体积。
 *
 * 匹配策略（优先级从高到低）：
 * 1. breedId 精确匹配（如 golden_retriever → dog-01）
 * 2. 品种中文名关键词匹配（如 "金毛" → dog-01）
 * 3. 按物种兜底：猫 → 橘猫(cat-01)，狗 → 金毛(dog-01)
 */
import type { PetProfile } from '../services/petService'
import { resolveAvatarUrl } from '../services/api'

/** 单个头像条目：文件 key（对应 uploads 目录下的 webp 文件名）+ 匹配关键词 */
interface HomeStyleAvatarItem {
  /** 文件名（不含扩展名），如 cat-01-orange-tabby */
  key: string
  /** 该头像对应的 breedId 精确匹配集合 */
  breedIds: string[]
  /** 该头像对应的品种中文关键词（用于 breed 模糊匹配） */
  keywords: string[]
  /** 物种（用于兜底） */
  species: 'dog' | 'cat'
}

/** 20 张头像条目：猫 10 + 狗 10（与 server/uploads/avatars/home-style 目录一一对应）
 * 导出给预设形象库复用（同源派生，避免 key 手抄漂移） */
export const HOME_STYLE_AVATARS: HomeStyleAvatarItem[] = [
  // ===== 猫 10 张 =====
  {
    key: 'cat-01-orange-tabby', species: 'cat',
    breedIds: ['chinese_domestic_cat', 'turkish_van'],
    keywords: ['橘', 'orange', '土猫', '田园'],
  },
  {
    key: 'cat-02-british-blue', species: 'cat',
    breedIds: ['british_shorthair'],
    keywords: ['英短', '蓝猫', 'british'],
  },
  {
    key: 'cat-03-cow', species: 'cat',
    breedIds: [],
    keywords: ['奶牛', '黑白'],
  },
  {
    key: 'cat-04-calico', species: 'cat',
    breedIds: [],
    keywords: ['三花', 'calico'],
  },
  {
    key: 'cat-05-black', species: 'cat',
    breedIds: ['bombay_cat'],
    keywords: ['黑猫', '黑', 'black'],
  },
  {
    key: 'cat-06-white-blue-eye', species: 'cat',
    breedIds: ['persian_cat', 'turkish_angora'],
    keywords: ['白猫', '白', '波斯', 'white'],
  },
  {
    key: 'cat-07-siamese', species: 'cat',
    breedIds: ['siamese_cat', 'balinese'],
    keywords: ['暹罗', 'siamese'],
  },
  {
    key: 'cat-08-ragdoll', species: 'cat',
    breedIds: ['ragdoll', 'ragamuffin', 'birman'],
    keywords: ['布偶', 'ragdoll'],
  },
  {
    key: 'cat-09-chinese-tabby', species: 'cat',
    breedIds: ['dragon_li'],
    keywords: ['狸花', '虎斑', '狸'],
  },
  {
    key: 'cat-10-american-shorthair', species: 'cat',
    breedIds: ['american_shorthair', 'exotic_shorthair'],
    keywords: ['美短', 'american'],
  },
  // ===== 狗 10 张 =====
  {
    key: 'dog-01-golden', species: 'dog',
    breedIds: ['golden_retriever'],
    keywords: ['金毛', 'golden'],
  },
  {
    key: 'dog-02-shiba', species: 'dog',
    breedIds: ['shiba_inu'],
    keywords: ['柴犬', 'shiba', '柴'],
  },
  {
    key: 'dog-03-corgi', species: 'dog',
    breedIds: ['corgi_pembroke'],
    keywords: ['柯基', 'corgi'],
  },
  {
    key: 'dog-04-husky', species: 'dog',
    breedIds: ['husky_siberian', 'alaskan_malamute'],
    keywords: ['哈士奇', '二哈', 'husky', '阿拉斯加'],
  },
  {
    key: 'dog-05-samoyed', species: 'dog',
    breedIds: ['samoyed'],
    keywords: ['萨摩耶', 'samoyed', '萨摩'],
  },
  {
    key: 'dog-06-french-bulldog', species: 'dog',
    breedIds: ['french_bulldog', 'bulldog', 'boston_terrier'],
    keywords: ['法斗', '斗牛', 'bulldog', '巴哥'],
  },
  {
    key: 'dog-07-bichon', species: 'dog',
    breedIds: ['bichon_frise', 'maltese', 'west_highland_white_terrier', 'lhasa_apso'],
    keywords: ['比熊', '马尔济斯', '西高地', 'bichon', 'maltese'],
  },
  {
    key: 'dog-08-border-collie', species: 'dog',
    breedIds: ['border_collie', 'shetland_sheepdog', 'australian_shepherd'],
    keywords: ['边牧', 'border', '喜乐蒂', '澳牧'],
  },
  {
    key: 'dog-09-labrador', species: 'dog',
    breedIds: ['labrador_retriever'],
    keywords: ['拉布拉多', '拉多', 'labrador'],
  },
  {
    key: 'dog-10-poodle', species: 'dog',
    breedIds: ['poodle_toy', 'poodle_standard'],
    keywords: ['贵宾', '泰迪', 'poodle'],
  },
]

/** 物种兜底头像（猫→橘猫、狗→金毛），保证任意宠物都能匹配到小动物头像 */
const SPECIES_FALLBACK: Record<'dog' | 'cat', string> = {
  cat: 'cat-01-orange-tabby',
  dog: 'dog-01-golden',
}

/**
 * 物种归一化：识别猫/狗（兼容大小写与中文脏数据），其余一律按狗处理
 * 抽出公共函数，避免 key 匹配与 URL 拼接两处逻辑重复
 * @param species - 宠物物种原始值（'cat'/'dog'/'猫'/'狗'/大小写/undefined）
 * @returns 归一化物种 'dog' | 'cat'
 */
export function normalizeSpecies(species: string | undefined | null): 'dog' | 'cat' {
  const s = (species || '').trim().toLowerCase()
  if (s === 'cat' || s === '猫') return 'cat'
  return 'dog'
}

/**
 * 物种归类：区分猫/狗/其他（供多物种场景如家族图谱判断是否显示小动物头像）
 * 与 normalizeSpecies 的区别：normalizeSpecies 会把未知物种静默归为狗，
 * 这里保留 'other' 供调用方对非猫狗物种做 emoji 展示。
 * @param species - 宠物物种原始值
 * @returns 'cat' | 'dog' | 'other'
 */
export function getSpeciesKind(species: string | undefined | null): 'cat' | 'dog' | 'other' {
  const s = (species || '').trim().toLowerCase()
  if (s === 'cat' || s === '猫') return 'cat'
  if (s === 'dog' || s === '狗') return 'dog'
  return 'other'
}

/**
 * 根据宠物档案匹配小动物头像文件名（不含扩展名）
 * @param pet - 宠物档案（需含 species/breed/breedId）
 * @returns 如 cat-01-orange-tabby；异常情况按物种兜底
 */
export function getHomeStyleAvatarKey(pet: Pick<PetProfile, 'species' | 'breed' | 'breedId'>): string {
  // 物种显式归一化（复用公共函数，保证 key 与 URL 逻辑一致）
  const species = normalizeSpecies(pet.species)

  // 1. breedId 精确匹配（统一小写，兼容大小写差异）
  const breedId = (pet.breedId || '').toLowerCase().trim()
  if (breedId) {
    const byId = HOME_STYLE_AVATARS.find((item) => item.species === species && item.breedIds.includes(breedId))
    if (byId) return byId.key
  }

  // 2. 品种中文名关键词匹配（包含即命中，如 "金毛寻回犬" 含 "金毛"）
  //    注意：
  //    - breed 与关键词都统一小写再比较，否则英文关键词（如 Golden）永远匹配不上；
  //    - 长词优先：单字关键词（黑/白/狸/柴）容易误命中，先收集全部命中条目，
  //      按"命中的最长关键词长度"降序取最优；长度相同则数据集顺序（先定义者优先）。
  const breed = (pet.breed || '').toLowerCase().trim()
  if (breed) {
    // 收集同物种下所有命中的条目及其最长命中关键词长度
    const hits = HOME_STYLE_AVATARS.flatMap((item) => {
      if (item.species !== species) return []
      const bestLen = item.keywords
        .map((kw) => kw.toLowerCase())
        .filter((kw) => breed.includes(kw))
        .reduce((max, kw) => Math.max(max, kw.length), 0)
      return bestLen > 0 ? [{ item, bestLen }] : []
    })
    // 长词优先（降序）；长度相同保持数据集顺序（sort 稳定，先定义者在前）
    hits.sort((a, b) => b.bestLen - a.bestLen)
    if (hits.length > 0) return hits[0].item.key
  }

  // 3. 物种兜底
  return SPECIES_FALLBACK[species]
}

/**
 * 获取宠物的小动物头像绝对 URL（用于家庭页 <Image> src）
 * 走服务器 /uploads 静态托管，resolveAvatarUrl 负责拼接 API_BASE_URL
 * 注意：服务器文件按物种分子目录存放（home-style/cat/*.png、home-style/dog/*.png），
 *       URL 必须带上 species 子目录，否则 404。
 * 2026-08-24：文件后缀由 .webp 改为 .png——微信安卓真机对 webp（尤其 VP8X 带透明）
 *      解码兼容性差（模拟器正常、真机不显示），服务器已同步上传 PNG 版本。
 * @param pet - 宠物档案
 * @returns 完整 URL，如 https://api.xinghuanhai.com/uploads/avatars/home-style/cat/cat-01-orange-tabby.png
 */
export function getHomeStyleAvatarUrl(pet: Pick<PetProfile, 'species' | 'breed' | 'breedId'>): string {
  const key = getHomeStyleAvatarKey(pet)
  return getHomeStyleAvatarUrlByKey(key, normalizeSpecies(pet.species))
}

/**
 * 按文件名 key + 物种直接拼品牌头像绝对 URL（预设形象库等"已知 key"场景使用）
 * 与 getHomeStyleAvatarUrl 同源，保证「预设形象」与「家庭页头像」引用同一张图。
 * @param key - 头像文件名（不含扩展名），如 cat-01-orange-tabby
 * @param species - 物种（决定 URL 子目录）
 * @returns 完整 URL，如 https://api.xinghuanhai.com/uploads/avatars/home-style/cat/cat-01-orange-tabby.png
 */
export function getHomeStyleAvatarUrlByKey(key: string, species: 'dog' | 'cat'): string {
  return resolveAvatarUrl(`/uploads/avatars/home-style/${species}/${key}.png`)
}

/**
 * 宠物头像统一解析（全站唯一口径）
 *
 * 优先级与家庭页 FamilyPetAvatar 完全一致：
 *   真实照片 avatarPhotoUrl > AI/卡通形象 avatarCartoonUrl > 按品种匹配的品牌小动物头像。
 *
 * 为什么必须有「品牌头像」这一层兜底（2026-09-10 用户反馈）：
 * 新建宠物默认没有自定义头像，若直接退化成"物种 emoji"，档案页/首页就只剩一个空渐变圆，
 * 用户会判定为「头像没显示」；而家庭页同一只宠物却能显示小动物头像——同一份数据两处不一致。
 * 这里收敛为统一口径：任何一只宠物永远有一个"小动物"头像。
 * 品牌头像由服务器 /uploads 托管（与预设形象同源同图），加载失败时由调用方 onError
 * 再退回 emoji（两级兜底，保证头像位永不为空）。
 *
 * @param pet - 宠物档案（真实照片/AI 形象 + species/breed/breedId 供品种匹配）
 * @returns 可直接用于 <Image> 的绝对 URL（永远非空）
 */
export function resolvePetAvatarUrl(
  // 头像字段显式放宽为 string | null：服务端与本地缓存都可能返回 null
  // （见 avatar-customize 保存时把清空字段置 null 的既有约定）
  pet: Pick<PetProfile, 'species' | 'breed' | 'breedId'> & {
    avatarPhotoUrl?: string | null
    avatarCartoonUrl?: string | null
  },
): string {
  return pet.avatarPhotoUrl || pet.avatarCartoonUrl || getHomeStyleAvatarUrl(pet)
}
