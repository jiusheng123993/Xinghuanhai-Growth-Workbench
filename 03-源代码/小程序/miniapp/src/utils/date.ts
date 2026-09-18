/**
 * 日期工具：本地时区的「自然日差」
 *
 * 【为什么单独抽这个模块】2026-09-11 排查「陪伴天数」时踩到的坑：
 *   `new Date('2023-05-12')` 按 ECMAScript 规范解析成 **UTC 零点**，
 *   在东八区相当于本地当天 08:00。于是原先散落在各页面的写法
 *     Math.floor((Date.now() - new Date(birthDate).getTime()) / 86400000)
 *   有两处偏差：
 *     ① 每天本地 00:00–08:00 之间，算出来的天数比真实自然日差少 1
 *        （要等到早上 8 点才「翻牌」，用户在凌晨看会觉得数字没更新）；
 *     ② 它算的是「满 24 小时数」而不是「日历天差」，跨时区/夏令时时还会再差 1 天。
 *   本模块统一改成「本地零点相减 + 按日历天取整」，供时光线页 / 日记页共用一个口径，
 *   避免同一只宠物在两个页面上算出不同的天数。
 */

/**
 * 匹配「YYYY-M-D」开头的日期（月份/日允许不补零），后面可以直接结束，
 * 也可以跟时间部分（`T` 或空格分隔）。
 *
 * 为什么要连"带时间"的串一起抓：`'2026-02-31T00:00:00.000Z'` 这种不存在的日期，
 * V8 既不报错也不给 Invalid Date，而是**静默进位**成 2026-03-03 ——
 * 只对纯日期串做反查的话，带时间的那条路仍是漏的（2026-09-11 审查 P3 实测）。
 */
const DATE_PREFIX_RE = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s]|$)/

/**
 * 解析日期为「本地时区当天零点」
 * @param input - 'YYYY-MM-DD' 纯日期串、带时间的 ISO 串、时间戳或 Date 对象
 * @returns 本地零点 Date；无法解析（含 2023-02-31 这类不存在的日期）时返回 null
 */
export function parseLocalDate(input: string | number | Date | null | undefined): Date | null {
  if (input === null || input === undefined || input === '') return null

  // 以 YYYY-M-D 开头的串（生日、以及带时间的 createdAt）：手工拆年月日 + 反查合法性，
  // 既避开 new Date('YYYY-MM-DD') 按 UTC 解析、在东八区变成当天 08:00 的问题，
  // 也挡住 '2026-02-31' 这类被静默进位成 3 月 3 日的非法日期
  if (typeof input === 'string') {
    const raw = input.trim()
    const matched = DATE_PREFIX_RE.exec(raw)
    if (matched) {
      const year = Number(matched[1])
      const month = Number(matched[2])
      const day = Number(matched[3])
      const localMidnight = new Date(year, month - 1, day)
      // 反查一次：Date 会把 2 月 31 日进位成 3 月 3 日，必须挡掉，
      // 否则界面会拿一个不存在的日期算天数
      if (
        localMidnight.getFullYear() !== year
        || localMidnight.getMonth() !== month - 1
        || localMidnight.getDate() !== day
      ) {
        return null
      }

      // 前缀之外没有剩余内容 = 纯日期串（matched[0] 含结尾的 T/空格，所以用长度比对判断）
      if (raw.length <= matched[0].length) return localMidnight

      // 带时间部分：按真实时刻解析，再归一到它落在哪个本地日历日。
      // `YYYY-MM-DD HH:mm:ss`（空格分隔）在 iOS/JSCore 上可能解析失败，
      // 先归一成 ISO 风格的 `T` 分隔再交给 Date（2026-09-11 审查 P3）。
      const normalized = raw.replace(/^(\d{4}-\d{1,2}-\d{1,2})\s+/, '$1T')
      const parsed = new Date(normalized)
      if (Number.isNaN(parsed.getTime())) return null
      return new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate())
    }
  }

  // 带时间的字符串 / 时间戳 / Date：先得到真实时刻，再取它落在哪个「本地日历日」，
  // 最后回到该日零点（建档时间 createdAt 就是这种带时间的 ISO 串）
  const parsed = input instanceof Date ? input : new Date(input)
  if (Number.isNaN(parsed.getTime())) return null
  return new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate())
}

/**
 * 从某一天到今天经过了多少个自然日（今天 = 0，昨天 = 1）
 * @param input - 起算日期（'YYYY-MM-DD' 生日 / ISO 建档时间均可）
 * @param now - 参照的「今天」，默认当前时间；测试里注入固定时刻用
 * @returns 天数；输入非法或起算日在未来时返回 null，调用方据此隐藏该字段而不是显示 0
 */
export function daysSinceLocalDate(
  input: string | number | Date | null | undefined,
  now: Date = new Date(),
): number | null {
  const start = parseLocalDate(input)
  if (!start) return null
  const today = parseLocalDate(now)
  if (!today) return null
  // 两个本地零点相减：中国无夏令时，恒为 86400000 的整数倍；
  // 用 round 而不是 floor，兜住其他时区夏令时造成的 ±1 小时漂移
  const days = Math.round((today.getTime() - start.getTime()) / 86400000)
  return days >= 0 ? days : null
}

/** 「X岁Y个月」的展示选项 */
export interface PetAgeFormatOptions {
  /** 出生日期缺失/非法/在未来时的兜底文案，默认空串（各页可传「年龄未知」「未知」） */
  fallback?: string
}

/**
 * 出生日期 → 中文年龄文案（全站统一口径）
 *
 * 【为什么必须统一】2026-09-11 排查发现全站有 **11 份各写各的实现**，
 * 同一只宠物在不同页面会显示**不同的年龄**。实测（生日 2025-09-20、当天 2026-09-11）：
 *   - 6 处「月相减、但不减"日"」（或只在某个分支减）：`components/PetCard`（跨年分支没减、
 *     不足岁分支减了）、`pages/index`、`pages/family/utils`、「宠物日记」页（该页 2026-09-12
 *     已并入 `pages/timeline`，此处保留历史记录）、
 *     `pagesPet/family/lineage`、`pagesPet/health-report` → 得「1岁」（多算一个月）
 *   - 3 处减了"日"：`pages/creative`、`pagesPet/avatar-customize` → 得「11个月」（正确）
 *   - 2 处只精确到"岁"、整月信息直接丢：`services/reportService`、`pages/timeline`
 *     （后者还是 `Math.floor(毫秒差 / 365.25天)`)
 *   - 格式混用：`1岁3月` / `1岁3个月` / `5月` / `5个月` / `刚出生` / `1岁0个月`
 * 另外多数用 `new Date('YYYY-MM-DD')`（按 UTC 解析，东八区相当于当天 08:00），
 * 月底出生 + 月初查看时也会差一个月；只有 avatar-customize / health-report 用了
 * `replace(/-/g,'/')` 绕过（那是项目里"知道这个坑"的写法，但不该靠人记住）。
 *
 * 【有意保留的异口径 —— 不要顺手改】：
 *   - `engines/vaccineScheduler` / `services/feedingService` / `services/symptomService` 的**月龄**：
 *     接种窗口、喂养分档、临床风险阈值，要的是整数月区间与结构化字段（还要上传服务端），不是展示文案
 *   - `data/petProducts.ts` 的 `petAge` 枚举（puppy_kitten / senior）：喂给商品推荐引擎的分类。
 *     原唯一产出方 `pages/product/index.tsx` 已随 2026-09-12「IA 落地第 1 批」删除，
 *     现消费方只剩 `petProducts.ts` 自身的打分逻辑（经 `hooks/useProductCommission` 调用），
 *     且已无页面写入该字段 —— 此处仅作类型口径记录，不代表还有页面在用。
 *   - 「今年满 X 岁」这类**只精确到"岁"**的生日语境文案：原唯一产出方 `pagesPet/achievement`
 *     的生日成就卡已随 2026-09-12 收口批次整页删除（全仓现无消费方）。但那条口径本身是对的：
 *     生日成就说的是"今年满 X 岁"，不是"当前精确年龄"——将来若再做生日卡语境，
 *     别顺手换成 `formatPetAge` 的 `X岁Y个月`（同上条，此处保留的是**理由**，不是还活着的消费方）。
 *   - `pages/mine` 的「养宠 N 个月 / N 年」：算的是用户养宠时长，起算点与宠物年龄不同
 *
 * 规则（本案定版）：
 *   - 满 1 岁：`X岁`（剩余月 > 0 时补 `Y个月`），如 `2岁3个月`
 *   - 不满 1 岁、满 1 个月：`Y个月`，如 `11个月`
 *   - 不满 1 个月：`Z天`（比「0个月」有信息量），如 `12天`
 *   - 日期缺失/非法/在未来：返回 fallback（不显示负数年龄）
 *
 * @param input - 出生日期（'YYYY-MM-DD' 或 ISO 串）
 * @param options - fallback / showDays
 * @param now - 参照的"今天"，默认当前时间（测试注入用）
 */
export function formatPetAge(
  input: string | null | undefined,
  options: PetAgeFormatOptions = {},
  now: Date = new Date(),
): string {
  const fallback = options.fallback ?? ''
  const birth = parseLocalDate(input)
  const today = parseLocalDate(now)
  if (!birth || !today) return fallback

  // 先按月相减，再按"日"修正：生日是 20 号、今天才 5 号 → 这个月还没满，要减 1。
  // 这是上面那 6 处实现漏掉的一步，也是"同一只宠物两个页面差一个月"的直接原因。
  let months = (today.getFullYear() - birth.getFullYear()) * 12 + (today.getMonth() - birth.getMonth())
  if (today.getDate() < birth.getDate()) months -= 1
  if (months < 0) return fallback // 出生日期在未来：宁可显示兜底，也不显示"负X个月"

  const years = Math.floor(months / 12)
  const restMonths = months % 12

  if (years > 0) return restMonths > 0 ? `${years}岁${restMonths}个月` : `${years}岁`
  if (months > 0) return `${months}个月`

  const days = daysSinceLocalDate(input, now)
  return days === null ? fallback : `${days}天`
}

/**
 * 取「本地时区」的 YYYY-MM-DD（日期键）
 *
 * 【为什么必须走这里】任何"按天"的统计（打卡天数、连续打卡、本周打卡、记一天一条去重）
 * 都必须用**本地日历日**做键。项目里散落着 `toISOString().slice(0, 10)` 与 `slice(0, 10)`
 * 的写法，它们取到的是 **UTC 日期**：东八区 20:00 之后产生的记录会被算成"前一天"，
 * 于是这些天数值在晚上齐齐差一天（2026-09-11 统一）。
 *
 * @returns 'YYYY-MM-DD'；无法解析时返回 null
 */
export function localDateString(input: string | number | Date | null | undefined): string | null {
  const d = parseLocalDate(input)
  if (!d) return null
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * 取「本地时区」的 MM-DD（用于"今天是不是它的生日 / 加入家庭纪念日"这类判断）
 *
 * 【为什么不能用 slice】`pet.createdAt` 是带时间的 ISO 串（如 `2026-09-10T20:00:00.000Z`），
 * 直接 `str.slice(5,10)` 取到的是 **UTC 日期**：东八区 20:00 之后建档的宠物会被算成前一天，
 * 「N 年前的今天」提醒就会在错误的日子弹出来（2026-09-11 排查）。
 *
 * @returns 'MM-DD'；无法解析时返回 null
 */
export function localMonthDay(input: string | null | undefined): string | null {
  // 复用上面的日期键实现，避免"两套取本地日期"的写法再次分叉
  return localDateString(input)?.slice(5) ?? null
}

/**
 * 按时段给一句问候语（早上好 / 下午好 / 晚上好）
 *
 * 【为什么放在这里而不各页各写一份】最初只有团团页在用（欢迎语第一句）；
 * 2026-09-12 今天页顶栏也用它（顶栏原来重复显示品牌名「星河宠记」，与原生导航栏标题撞车，
 * 改成问候语）→ 同一件事两处用就必须只有一处实现，否则"几点算早上"会出现两套口径。
 *
 * 分档：< 11 早上好 ／ < 18 下午好 ／ 其余晚上好 —— 三档覆盖 0~23 点，
 * 不会出现"凌晨说晚上好"，也不会有时刻落不进任何档位。
 *
 * @param now - 参照时刻（测试注入固定时间用），默认当前时间
 * @returns 问候语（不含标点，调用方自己接「，」或「呀」）
 */
export function greetingByHour(now: Date = new Date()): string {
  const h = now.getHours()
  if (h < 11) return '早上好'
  if (h < 18) return '下午好'
  return '晚上好'
}
