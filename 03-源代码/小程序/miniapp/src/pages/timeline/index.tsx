/**
 * 时光页面
 *
 * 【本页是什么】所有宠物共用的一本「时光线」：**只放用户自己记的回忆**
 *   （pet_moments：手写的文字、拍下的照片、补记的历史日期），按同一条时间轴倒序排列、按月分组；
 *   顶部另有速览数字与成就分区，页头有唯一写入口「记一条」。
 *   【绝对不放进来的】任何由打卡数据自动生成的内容 —— 那些属于「打卡记录」，
 *   主场是健康档案页 pagesPet/trends；判定标准见下面 2026-09-12 第 4b 波那一段。
 *
 * 2026-09-10 调整：回忆录类入口统一收口到「创作 → 回忆录馆」，
 * 本页原有的「回忆精选」三张卡（年度回忆/日常回忆录/纪念Vlog）已整体移除——
 * 后两个与回忆录馆的轻纪念/标准档完全重复，年度回忆则不重复、已迁入回忆录馆。
 * 本页职责收窄为：看时光线 + 记一条回忆。
 *
 * 2026-09-12（IA 第 2c 批）：原独立分包页「宠物日记」（成长日记）曾并入本页 ——
 * 搬入的是 diary 页**独有**的视图：diaryEngine 生成的拟人化日记正文 + 6 档心情筛选。
 * ⚠️ 这一步在第 4b 波被推翻：并入的日记正文本身就是**打卡数据自动生成的**（不是用户记的），
 * 它和心情筛选已整批搬到健康档案页的「打卡记录」分区（见下面 4b 那段）。
 *
 * 2026-09-12（高保真 v2 第 2 波 · 屏 02）：按 `02-timeline.png` 重排页面骨架。
 * 对照原型后补上的两块（这正是本波任务书说的"5 块里 2 缺"）：
 *   ① **「记一条」写入口**（原型里那条约占 10% 屏高的橙色渐变主 CTA）——
 *      原实现把写入口塞在**滚动区最底部**（`.timeline-add-main-btn`），首屏根本看不见；
 *      现在按原型提到页头正下方，是全页唯一写入口。
 *   ② **「成就」展示分区**（原型把原「成就墙」独立页降级成时光页内的一个分区）——
 *      原实现本页完全没有成就区。这里**不复用 `AchievementCard` 组件**（它是"单张纪念卡"，
 *      与原型的两列 gtile 宫格不是一种东西），而是按 `ACHIEVEMENT_TYPES.streak_7/30/100`
 *      这套既有成就定义，用**真实打卡数据**渲染进度格子（见 buildCheckinSummary）。
 *      2026-09-12 收口批次：`pagesPet/achievement`（成就墙独立页）已按同一口径**真正删除**
 *      （页面 + app.config 注册项 + 我的页菜单项），成就从此只有本页这一个展示位。
 * 另外按原型补上：**按月分组的月份小标题**（`2026 年 9 月` + 该月条数）与**页头右侧的宠物档案圆钮**。
 *
 * 2026-09-12（第 4 波 · 时光线与打卡记录拆分）——用户原话：
 *   「宠物日记和时光是一种东西，你区分错了。真正有问题的是 打卡记录和日记/时光不是一个东西，你塞在一起了」
 * 这一步**做对了**什么：打卡的原始明细（大便/小便/食欲/精神/体重）整批搬去健康档案页，
 * `TimelineEvent.type === 'milestone'` 那批从此既不生成也不渲染。
 * 这一步**做错了**什么：把日记正文也塞进了这条流（见下一段）。
 *
 * 2026-09-12（第 4b 波 · 本页最终口径）——用户看完第 4 波成果后的原话：
 *   「你的打卡记录怎么全部归类到时光了　吃得好睡得好这个全部都是打卡的吧？？　我哪有填了那么多时光」
 * 【核实结论】第 4 波留在时光线上的那些「今天吃得香睡得香，是快乐的一天～」，是
 * diaryService → diaryEngine 按**每条打卡 1:1 自动生成**的正文 —— 用户从来没有记过它们。
 * 它们是打卡数据的另一副面孔，却被当成"用户记的内容"摆在了这一页上，这正是用户看到的那一幕。
 * 【本次改动】
 *   ① **日记卡整批移出本页**：自动生成的正文与 6 档心情筛选搬到健康档案页（pagesPet/trends）
 *      的「打卡记录」分区 —— 每句正文跟着它自己那条打卡显示，并在界面上写明句子来源；
 *   ② **本页只剩「用户自己记的回忆」**：照片回忆（pet_moments）+ 用户点过「添加到时光线」的
 *      旧时光提醒（后者只来自宠物档案里用户自己填的日期，判断依据见 findFlashbackMemory 注释）；
 *   ③ **页头/速览/成就的数字跟着屏幕改口径**：每个数字按什么算，逐条写在
 *      buildTimelineSummary 与各自注释里（不许出现"数字与列表对不上"）。
 * 【自查标准】打开本页，每一张卡片都必须能回答"这是用户自己记的"。
 *
 * 【页面骨架（第 4b 波后的顺序）】固定顶部条（「时光」+ N 天的记录 + 档案钮）
 *   → 滚动区：品牌插画横幅 →「记一条」CTA → 时光速览（真实数字）→ 旧时光横幅
 *   → 按月分组的时光线（**只剩用户回忆**）→ 成就 → 底部呼吸位。
 */
import { View, Text, ScrollView, Image, Textarea, Picker } from '@tarojs/components'
import Taro, { useDidShow, useShareAppMessage, useShareTimeline } from '@tarojs/taro'
import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { useThemeClass } from '../../hooks/useThemeClass'
// 【已移除】useAnalytics：本页原来只有「分享这篇日记」一处埋点（share_diary），
// 日记卡随第 4b 波搬去健康档案页后，本页不再产生任何埋点事件，这个 hook 一并撤掉。
// 登录态 + 页面级登录守卫（2026-09-12 补齐「时光没有绑定登录」）：
// 本页此前既没有 import authStore、也没有 import authGuard，是四个 tab 页里唯一漏掉守卫的一页
// —— 复核结论与「为什么本页此前没有」写在组件里那段 guard 注释中。
import { useAuthStore } from '../../stores/authStore'
import { usePetStore } from '../../stores/petStore'
import { getCheckins } from '../../services/checkinService'
import { timelineService } from '../../services/timelineService'
// 【已移除】diaryService（generateDiaryFromEntries / DiaryRecord）：
// 第 4b 波把自动生成的日记正文整批搬到健康档案页（pagesPet/trends），本页不再生成它。
// diaryService 与 diaryEngine 本身没有孤儿化，只是换了消费方（趋势页「打卡记录」分区）。
import { resolveAvatarUrl } from '../../services/api'
import { CONFIG } from '../../config'
import { storage } from '../../utils/storage'
import { chooseImageWithPrivacy } from '../../utils/privacy'
import { redirectToLoginIfNeeded } from '../../utils/authGuard'
import { localMonthDay, parseLocalDate, formatPetAge, localDateString } from '../../utils/date'
import { detectPetsInText, toPetTags } from '../../utils/petMatching'
import type { PetProfile } from '../../services/petService'
import type { PetHealthEntry } from '../../memory-body/types/memoryBodyTypes'
import type { PetMoment } from '../../types/familyTypes'
// 【已移除】DiaryTone：心情筛选（TONE_FILTERS + 心情色板）随日记正文一起搬到趋势页。
import './index.scss'
import { Icon, EmptyState, PageHero, Illustration } from '../../components'
import PageBackground from '../../components/PageBackground'
// 成就名称/图标的出处（constants 里的 ACHIEVEMENT_TYPES）：
// 本页「成就」分区要写成就名（如「坚持一周」）与档位图标，自己另抄一份必然与常量漂移
// （同一句文案几处各写各的正是本项目反复踩过的坑）。
// ⚠️ 2026-09-12：第一格的**图标位已按 v2 屏 02 改成插画**（key `empty-achievement`），
//   但 `icon` 字段仍在用 —— 它被压在插画底下当**加载失败时的兜底**（详见成就分区注释）。
// ⚠️ 2026-09-12 收口批次：「成就墙」独立页（pagesPet/achievement）已整页下线，
//   本页因此成了 constants 这份 ACHIEVEMENT_TYPES 的**唯一消费方**；
//   打卡弹层 / 疫苗弹层 / 成就分享卡走的是 component 层的**另一套同名定义**
//   `components/AchievementCard` 的 `ACHIEVEMENT_DEFS`（字段一致、值各写各的），改文案别只改一处。
import { ACHIEVEMENT_TYPES } from '../../constants'
// 自定义 tabBar 的选中态广播 hook（本页 = tabBar 第 2 项，路径写错 tsc 直接报错）
import { useTabBarSelected } from '../../constants/tabBar'
// 【已移除】PetSwitcher：共用回忆录改造后本页不再"按宠物分类"的切换条（2026-09-11）

interface TimelineEvent {
  id: string
  date: string
  title: string
  /**
   * 事件类型
   *
   * 【为什么没有 'milestone'（2026-09-12 第 4 波）】原先打卡会在这条线上生成
   * 「体重记录：5kg」「日常记录」这类**里程碑**卡片（type 'milestone'）。用户指出
   * 打卡记录和日记/时光不是一个东西、不该塞在一起 —— 打卡的明细（大便/小便/食欲/精神/体重）
   * 已搬到健康档案页（pagesPet/trends）的「打卡记录」分区，所以里程碑从此既不生成也不渲染。
   * 类型里一并删掉 'milestone'，避免有人再塞一条回到这条流上。
   * 注：'ghost' 是历史遗留类型（当前全仓没有任何地方产出它），保留是为了不动既有判断逻辑。
   *
   * 【三类事件的数据来源（第 4b 波自查用）】
   *   · 'memory'    —— 用户手记的真实回忆（pet_moments 表），**用户自己记的**；
   *   · 'flashback' —— 「N 年前的今天」旧时光提醒，来自宠物档案里用户自己填的日期
   *                   （生日 / 建档日）；由打卡数据派生出来的那几支已在第 4b 波全部删除，
   *                   判断依据见 findFlashbackMemory 的注释；
   *   · 'ghost'     —— 历史遗留类型，当前没有任何产出方（保留只为不动既有判断逻辑）。
   */
  type: 'memory' | 'ghost' | 'flashback'
  emoji: string
  photos: string[]
  description: string
  flashbackYear?: number
  /** 对应 pet_moments 表记录 id（仅真实回忆有），用于删除/详情定位 */
  sourceId?: string
  /**
   * 这条记录属于哪只宠物（2026-09-11 共用回忆录改造）
   *
   * 本页从"按当前宠物分开"改成"所有宠物共用一条时间线"之后，
   * 卡片上必须能看出"这是谁的回忆"——否则多宠家庭的列表会分不清归属。
   * 用户手记的回忆会带上这三个字段（旧时光提醒的文案里已含宠物名，不带归属字段）。
   */
  petId?: string
  petName?: string
  petEmoji?: string
  /**
   * 这条回忆关联的**全部宠物**（多宠共同回忆，一只以上时有值）
   *
   * 来自服务端写入的 `content.pets`；单宠回忆只有上面三个单值字段。
   * 卡片按它渲染多枚标签（同一条回忆可以是「🐱 烧鸡」「🐕 烧鸭」共同的）。
   */
  petTags?: { id: string; name: string; emoji: string }[]
}

interface FlashbackMemory {
  title: string
  emoji: string
  description: string
  yearsAgo: number
}

/**
 * 本页顶部速览与成就分区用到的真实计数（2026-09-12 v2 屏 02 引入，第 4b 波改口径）
 *
 * 【为什么要有这个类型】页头副标题写「N 天的记录」、速览第四格写「打卡天数」、
 * 成就分区写「连续打卡第 N 天」「本月新增 N 张」。这些数字**必须由真实数据现算**
 * （不许塞假数据），且都出自 loadTimelineData 那一次 `getCheckins` / `getMoments` 的结果
 * —— 所以统一收成一个 state，免得页面上几处各算一遍、口径还会飘。
 *
 * 【第 4b 波为什么把字段整批换名】改前这个类型叫 CheckinSummary，混装了打卡数字与
 * 「时光线条数」。日记离开时光线后本页屏幕上的内容只剩用户回忆，
 * 于是每个字段第一次必须回答"它数的是打卡，还是用户记的回忆"——
 * 与其在旧名字底下偷偷改语义，不如按口径重新起名（见下面每个字段的注释）。
 *
 * 【为什么不用 checkinService.getCheckinStats】那个函数只读**本地缓存**（不联网），
 * 冷启动/换设备时会是空的，而本页手里已经有刚联网拉回来的完整打卡数组。
 * 它的 streak 算法已在本文件里逐行照做（去重日期 + 从今天往回逐日比对），
 * 保证本页与打卡页/首页那套口径不会出现"两个连续天数"。
 */
interface TimelineSummary {
  /**
   * 用户回忆（pet_moments）覆盖的**天数**（按本地日历日去重）—— 页头「N 天的记录」用它
   *
   * 【第 4b 波改口径】改前这里数的是**打卡天数**：一个天天打卡、从没写过回忆的用户
   * 会看到页头写着「30 天的记录」，而下面的列表是空的 —— 数字与列表直接对不上。
   * 现在数的是屏幕上那些卡片覆盖的天数，口径与列表一致（为 0 时页头不渲染这行文案）。
   */
  memoryDays: number
  /**
   * 有打卡记录的天数（按本地日历日去重，多宠合并算一天）—— 速览「打卡天数」那一格用它
   *
   * 【打卡口径，故意同屏保留】它是**打卡**的数字，不跟时光线走：本页速览与成就区一直
   * 承担顺带看一眼坚持情况的职责（成就第一格就是连续打卡），
   * 打卡明细则在健康档案页的「打卡记录」分区 —— 两处同源（同一次 getCheckins），数字不会打架。
   */
  checkinDays: number
  /** 连续打卡天数（从今天往回数，与 checkinStore/checkinService 同算法）—— 成就第一格用它 */
  streak: number
  /** 本月用户回忆覆盖的天数（按本地日历日去重）—— 成就第二格的副行「本月新增 N 条记录」 */
  monthMemoryDays: number
  /** 本月用户回忆里的真实照片张数 —— 成就第二格的主标题「N 张照片」 */
  monthPhotos: number
}

/** TimelineSummary 的初值（未登录 / 什么都还没拉到时用它，页面不渲染 0 值格子） */
const EMPTY_TIMELINE_SUMMARY: TimelineSummary = {
  memoryDays: 0,
  checkinDays: 0,
  streak: 0,
  monthMemoryDays: 0,
  monthPhotos: 0,
}

/**
 * 折线「连续打卡」成就的档位（7 / 30 / 100 天）
 *
 * 名字与图标一律取自 constants 的 ACHIEVEMENT_TYPES，**不另抄一份文案**：
 * （上面那段 import 注释已说明：component 层还有一套同义的 `ACHIEVEMENT_DEFS` 供打卡/疫苗弹层用，
 *   两套都在；这里引的是 constants 那份，别串了。）
 * `icon` 现在有两个用途：第一格压在主插画底下当降级兜底（见成就分区注释），
 * 其余档位切换时也仍是同一条数据源，所以展开写法保持不变。
 */
const STREAK_ACHIEVEMENTS = [
  { key: 'streak_7', days: 7, ...ACHIEVEMENT_TYPES.streak_7 },
  { key: 'streak_30', days: 30, ...ACHIEVEMENT_TYPES.streak_30 },
  { key: 'streak_100', days: 100, ...ACHIEVEMENT_TYPES.streak_100 },
] as const

// 【已移除】心情色板 TONE_COLORS / 中文名 TONE_LABELS / 6 档筛选 TONE_FILTERS：
// 它们是「日记正文」的配套设施（筛的是 diaryEngine 算出来的心情档位），
// 2026-09-12 第 4b 波随日记正文一起搬到健康档案页（pagesPet/trends）的「打卡记录」分区。
// 留在这里只会是一组没人读的常量，且会误导后来人以为本页还能按心情筛。
/**
 * 本地日期字符串（YYYY-MM-DD）
 *
 * 2026-09-11 全站口径收口：原实现用 toISOString().slice(0,10) / slice(0,10) 取的是 **UTC 日期** ——
 * 东八区 00:00-08:00 的记录会被算成前一天，于是「打卡天数 / 连续天数 / 去重天数」
 * 在早上齐齐差一天，并与已改用本地日的 checkinService、reportService 口径不一致。
 */
function entryDateStr(entry: PetHealthEntry): string {
  return localDateString(entry.createdAt) ?? ''
}

/**
 * 取「本地时区」的 MM-DD
 *
 * 不能直接 `dateStr.slice(5, 10)`：`pet.createdAt` 是带时间的 ISO 串
 * （如 `2026-09-10T20:00:00.000Z`），slice 拿到的是 **UTC 日期**，
 * 东八区 20:00 之后建档的宠物会被算成前一天 →「N 年前的今天·加入家庭」
 * 会在错误的日子弹横幅（2026-09-11 排查）。统一交给 utils/date 按本地日历日取。
 */
function getMonthDay(dateStr: string): string {
  return localMonthDay(dateStr) ?? ''
}

/**
 * 本地日期字符串（YYYY-MM-DD）
 * 坑点：toISOString() 取的是 UTC 日期，中国时区（UTC+8）晚上 20 点后会比本地日期早一天，
 * 补记日期默认值必须用本地时区，否则用户会"穿越到昨天"
 */
function getLocalDateString(d: Date = new Date()): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

// 【已移除】isWithinLast7Days（判断"本周"）：它只服务于第 4 波版 TimelineSummary 里的 weekDays，
// 而 weekDays 这个数字全页面没有任何一处渲染（页头写的是"N 天的记录"，速览写的是"打卡天数"）。
// 第 4b 波按"只留屏幕上真在用的数字"的口径清理：该字段与该函数一并删除。
/**
 * 这一天是否落在「本月」内（本地日历月）
 * @param dateStr - YYYY-MM-DD
 * @param todayStr - 今天（YYYY-MM-DD），由调用方统一取一次，避免函数内多次 new Date 跨零点
 */
function isInCurrentMonth(dateStr: string, todayStr: string): boolean {
  return dateStr.slice(0, 7) === todayStr.slice(0, 7)
}

/**
 * 连续打卡天数（从今天往回逐日比对）
 *
 * 【算法与 checkinService.calculateLocalStats / checkinStore.fetchCheckins 完全一致】
 * 那两处是"打卡页 / 首页"的数字来源，本页若另写一套就会出现同一用户
 * 「时光说连续 5 天、首页说连续 6 天」。所以这里逐行照做：
 * 去重日期 → 倒序 → 从今天起每命中一天就把游标往前挪一天，断链即停。
 *
 * ⚠️ 游标必须用 parseLocalDate（按本地时区解析），不能用 `new Date(dateStr)`
 * —— 后者按 UTC 解析 "YYYY-MM-DD"，东八区会整体偏一天（本仓 2026-09-11 修过这个坑）。
 *
 * @param entries - 全部宠物的打卡记录（本函数内部自己去重日期，多宠同一天只算一天）
 * @returns 连续天数；今天没打卡就是 0
 */
function calcStreakFromEntries(entries: PetHealthEntry[]): number {
  const sortedDates = Array.from(new Set(entries.map(entryDateStr).filter((d) => d !== ''))).sort().reverse()
  const cursor = parseLocalDate(new Date())
  if (!cursor) return 0
  let streak = 0
  for (const dateStr of sortedDates) {
    const expected = getLocalDateString(cursor)
    if (dateStr === expected) {
      streak++
      cursor.setDate(cursor.getDate() - 1)
    } else {
      break
    }
  }
  return streak
}

/**
 * 选出「当前该展示的那一档连续打卡成就」（v2 屏 02 成就分区的第一格）
 *
 * 规则（三档 7/30/100 天）：
 *   · 还没达标最早那一档 → 返回最早未达标档（卡片显示「还差 N 天」）；
 *   · 已过某档、还没到下一档 → 返回下一档（同样显示「还差 N 天」）；
 *   · 三档全达成 → 返回最后一档，卡片显示「已达成」。
 *
 * ⚠️ 不返回 null：原型里这一格是**常驻**的（哪怕连续 0 天也显示距离 7 天还差几天），
 * 返回 null 会让成就区在大多数用户那里直接少一格。
 *
 * @param streakDays - 当前连续打卡天数（真实值）
 */
function pickStreakAchievement(streakDays: number) {
  for (const item of STREAK_ACHIEVEMENTS) {
    if (streakDays < item.days) return item
  }
  // 三档全达成：返回最后一档（100 天）
  return STREAK_ACHIEVEMENTS[STREAK_ACHIEVEMENTS.length - 1]
}

/**
 * 从本次拉取到的真实数据里算出页头 / 速览 / 成就需要的计数（第 4b 波重写）
 *
 * 【每个数字按什么算 —— 逐条写明，屏幕上的每个数字都能在这里对上】
 *   · memoryDays      = 用户回忆覆盖的**天数**（events 里能解析出 YYYY-MM-DD 的日期去重）
 *                       → 页头副标题「N 天的记录」
 *   · checkinDays     = 有打卡记录的**天数**（逐只宠物的 entries 日期去重）
 *                       → 速览第四格「打卡天数」
 *   · streak          = 连续打卡天数（算法与 checkinService 一致）
 *                       → 成就第一格「已连续 N 天 · 还差 M 天」
 *   · monthMemoryDays = 本月用户回忆覆盖的天数（去重）
 *                       → 成就第二格副行「本月新增 N 条记录」
 *   · monthPhotos     = 本月用户回忆里的真实照片张数
 *                       → 成就第二格主标题「N 张照片」
 *
 * 【第 4b 波改口径的两处，都是为了不许数字与列表对不上】
 *   ① memoryDays 是新增的：改前页头借的是**打卡天数**，于是天天打卡、从没写回忆的用户
 *      会看到页头写「30 天的记录」而下面一张卡都没有；
 *   ② monthMemoryDays / monthPhotos 改吃 events（用户回忆），不再吃原来那份混排 feed ——
 *      日记已经离开本页，再把它算进本月新增就是拿屏幕上看不见的东西充数。
 *
 * 【为什么本页还保留打卡口径的数字】速览的「打卡天数」与成就第一格的「连续 N 天」都有
 * 明确自己的标签，且与健康档案页「打卡记录」同源（同一次 getCheckins）—— 用户在这一页
 * 顺带看一眼坚持情况，不等于把打卡内容混进时光线；真正会误导人的是没有标签的打卡内容。
 *
 * @param perPetEntries - 每只宠物的打卡记录（loadTimelineData 里那一次拉取的结果）
 * @param events - 时光线上的全部卡片（用户回忆 + 已加入的旧时光提醒）
 * @returns TimelineSummary
 */
function buildTimelineSummary(
  perPetEntries: { entries: PetHealthEntry[] }[],
  events: TimelineEvent[],
): TimelineSummary {
  const todayStr = getLocalDateString()
  const allEntries = perPetEntries.flatMap((p) => p.entries)
  // 按本地日历日去重：天数要的是天数，同一天补记 3 次仍算 1 天
  // （与 checkinService 的 totalDays / monthlyDays 同一口径）
  const checkinDates = Array.from(new Set(allEntries.map(entryDateStr).filter((d) => d !== '')))

  // 回忆的日期：只认 YYYY-MM-DD。旧时光那条是「N 年前」文案，匹配不上这个正则，
  // 会被自然排除在天数之外 —— 它本来也不代表某个具体日历日。
  const memoryDates = events.map((e) => e.date).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
  // 本月：同一条正则的边界在这里由 isInCurrentMonth 兜住（'N年前'.slice(0,7) 不等于本月前缀）
  const monthEvents = events.filter((e) => isInCurrentMonth(e.date, todayStr))

  return {
    memoryDays: new Set(memoryDates).size,
    checkinDays: checkinDates.length,
    streak: calcStreakFromEntries(allEntries),
    monthMemoryDays: new Set(monthEvents.map((e) => e.date)).size,
    monthPhotos: monthEvents.reduce((sum, e) => sum + e.photos.length, 0),
  }
}
/**
 * 把 YYYY-MM-DD 显示成「9 月 12 日」
 *
 * 【为什么不用 event.date 原文】卡面上的日期原来直接显示 `2026-09-11`，
 * 一列卡片看下来全是 ISO 串、读起来费劲；原型卡面上写的是「今天 09:12」「9 月 8 日」。
 * 这里只做月/日（年份已经在分组的月份标题上写着了，卡面再写一遍是噪音）。
 *
 * @param dateStr - YYYY-MM-DD；不是这个格式时原样返回（旧时光那种「N年前」文案）
 * @param todayStr - 今天，用来把当天显示成「今天」（原型写法）
 */
function formatCardDate(dateStr: string, todayStr: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr
  if (dateStr === todayStr) return '今天'
  return `${Number(dateStr.slice(5, 7))} 月 ${Number(dateStr.slice(8, 10))} 日`
}

/**
 * 取某条事件的分月键（'YYYY-MM' 或 'undated'）
 *
 * 与 groupEventsByMonth 的分组规则保持同一口径（那边是按日期串切前 7 位）。
 * 「N 年前」这种非日期文案（flashback 的 date）一律归 'undated'，
 * 分组时它会被放进「旧时光」那一组，而不是凭空造一个「N年前 月」的标题。
 */
function timelinePeriodOf(event: TimelineEvent): string {
  return /^\d{4}-\d{2}/.test(event.date) ? event.date.slice(0, 7) : 'undated'
}

/**
 * 把日期映射成可直接字典序比较的串（用于时光线排序）
 *
 * 【为什么要这一步】旧时光条目的 date 是「3年前」这种文案，直接 localeCompare
 * 会把它和 'YYYY-MM-DD' 混在一起比出奇怪的结果。这里把认不出日期的统一映射成
 * '9999-99-99'：等价于「最旧的一条」，稳定地排在时间轴末尾，与分组里
 * 「旧时光」永远垫底的表现一致。
 *
 * @param dateStr - 事件的 date 字段
 */
function sortableDate(dateStr: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(dateStr) ? dateStr : '9999-99-99'
}

/**
 * 按月分组（第 4b 波：从"吃混排 feed"退回只吃事件数组）
 *
 * 【为什么退回】第 4 波把分组写成吃 TimelineFeedItem，是因为时间轴上混进了第二类条目
 * （日记）；第 4b 波日记整批撤走后，这条流上只剩一类东西 —— 用户回忆（含旧时光提醒），
 * 留着判别联合加 keep 回调（心情筛选）就成了"只有一个分支的抽象"加"永远返回 true 的参数"，
 * 属于典型死代码。现在按最朴素的写法只吃 TimelineEvent[]。
 *
 * 【月份标签与旧时光组】与改前完全一致：'YYYY-MM' 的标签写成「2026 年 9 月」
 * （月份去掉前导零），认不出月份的（flashback 的「N 年前」）归到「旧时光」组。
 *
 * @param events - 已排序的事件（新的在前；「N 年前」那条已被 sortableDate 垫到最后）
 */
function groupEventsByMonth(
  events: TimelineEvent[],
): { key: string; label: string; count: number; items: TimelineEvent[] }[] {
  const groups: { key: string; label: string; count: number; items: TimelineEvent[] }[] = []
  for (const event of events) {
    const ym = timelinePeriodOf(event)
    const year = ym === 'undated' ? '' : ym.slice(0, 4)
    const label = ym === 'undated' ? '旧时光' : `${year} 年 ${Number(ym.slice(5, 7))} 月`
    const last = groups[groups.length - 1]
    if (last && last.key === ym) {
      last.items.push(event)
      last.count += 1
    } else {
      groups.push({ key: ym, label, count: 1, items: [event] })
    }
  }
  return groups
}
/**
 * 「N 年前的今天」旧时光提醒 —— 数据来源逐个核对（2026-09-12 第 4b 波的重点之一）
 *
 * 【为什么要逐个核对】用户的要求是时光里每一张卡都要能回答『这是我自己记的』，
 * 而这条提醒是**系统按日期算出来**的，所以必须先看清它吃的每个字段是谁的数据：
 *   · pet.birthDate —— **宠物档案里用户自己填的生日** → 保留；
 *   · pet.createdAt —— 宠物档案的建档时间（用户把这只毛孩子加进 App 的那天）→ 保留：
 *     它同样来自档案本身，不是打卡算出来的；
 *   · entries（打卡记录）—— 原实现还有三支：紧急预警「渡过难关」、打卡备注「往日时光」、
 *     体重「体重记录」。这三支**全部来自 pet_health_entries**，正是这一波要清掉的东西：
 *     它们会在时光线上凭空造出用户没记过的内容（体重/预警都是打卡数据）。
 *     备注那一支原文虽然是用户写的，但它就是**打卡记录里的备注**，归宿是健康档案页
 *     「打卡记录」分区（那里本来就逐条显示 note），所以整支一并删除、内容没丢。
 * 【结论】现在只剩「生日 / 加入家庭」两支，且只在月日正好对上今天时才会出现 ——
 * 两者都是用户自己填进档案的日期，符合本页的口径。
 *
 * ⚠️ 提醒不等于记录：用户点过「添加到时光线」之后（flashbackAdded）它才成为一张卡片。
 *
 * @param pet - 宠物档案（生日与建档时间都取自这里）
 * @returns 命中的提醒文案；没有则 null
 */
function findFlashbackMemory(pet: PetProfile | null): FlashbackMemory | null {
  if (!pet) return null

  const today = new Date()
  const todayMD = `${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
  const currentYear = today.getFullYear()

  const birthday = pet.birthDate
  if (birthday) {
    const birthMD = getMonthDay(birthday)
    if (birthMD === todayMD) {
      const years = currentYear - (parseLocalDate(birthday)?.getFullYear() ?? currentYear)
      if (years >= 1) {
        return {
          title: `${pet.name}的生日`,
          emoji: '🎂',
          description: `${years}年前的今天，${pet.name}来到了这个世界`,
          yearsAgo: years,
        }
      }
    }
  }

  const createdAt = pet.createdAt || ''
  if (createdAt && getMonthDay(createdAt) === todayMD) {
    const adoptYear = parseLocalDate(createdAt)?.getFullYear() ?? currentYear
    const yearsAgo = currentYear - adoptYear
    if (yearsAgo >= 1 && (!birthday || getMonthDay(birthday) !== todayMD)) {
      return {
        title: '加入家庭',
        emoji: '🏠',
        description: `${yearsAgo}年前的今天，${pet.name}成为了家庭的一员`,
        yearsAgo,
      }
    }
  }

  // 【第 4b 波删除】原来这里还有一段翻打卡记录找去年的今天：
  // 紧急预警 / 打卡备注 / 体重三支，全部由 pet_health_entries 派生。判断依据见函数头注释。
  return null
}

// 【已删除】generateTimelineFromData（打卡记录 → 时光线事件）：
// 第 4 波它已经退化成"恒返回空数组"的占位实现，当时的理由是"调用点还要靠它完成
// 逐只宠物拉打卡的 IO"—— 但实际调用点（loadTimelineData ②）是自己直接调 getCheckins 的，
// 这个函数**从头到尾没有任何调用方**（第 4b 波用全仓检索复核过）。
// 留着一个没有调用方、又恒返回 [] 的函数，只会让后来人以为时光线上还有系统生成的卡片，
// 所以本波直接删掉；打卡数据的 IO 仍在 loadTimelineData 里，一行没少。
//
/**
 * 真实回忆（pet_moments）→ 时间线事件
 * 用户手动添加的回忆帖是时光线的核心内容，必须展示（原实现漏加载导致"打不开"）
 * 兼容后端 snake_case 字段（happened_at/created_at）与前端 camelCase（happenedAt/createdAt）
 *
 * 2026-09-11 共用回忆录改造：标题统一为「回忆」，宠物归属改由卡片上的宠物小标签呈现
 * （原先是把宠物名拼进标题「可乐的回忆」，混排后会与标签重复，且没存名字的老数据会显示成"回忆"而丢失归属感）。
 * @param moment - 后端返回的回忆记录
 */
function momentToTimelineEvent(moment: PetMoment): TimelineEvent {
  const raw = moment as PetMoment & Record<string, unknown>
  const content = (moment.content || {}) as {
    description?: string
    petName?: string
    petEmoji?: string
    pets?: { id: string; name: string; emoji: string }[]
  }
  // 补记日期优先取 happened_at（happenedAt），未补记时回退 created_at
  const happened = (raw.happenedAt as string) || (raw.happened_at as string) || ''
  const created = (raw.createdAt as string) || (raw.created_at as string) || ''
  // 只取**本地日历日**：created_at 是带时间的 ISO 串，slice(0,10) 拿到的是 UTC 日期，
  // 东八区 00:00-08:00 记的回忆会被算成前一天（与同页打卡口径 entryDateStr 不一致）。
  // localDateString 内部走 parseLocalDate，同时兼容后端 DATE 型的 'YYYY-MM-DD'。
  const dateStr = localDateString(happened || created) || (happened || created).slice(0, 10)
  const photos = Array.isArray(moment.photos) ? moment.photos : []
  // 多宠共同回忆：服务端写入的 content.pets（老数据没有 → 回退到单值 petName/petEmoji）
  const petTags = Array.isArray(content.pets) && content.pets.length
    ? content.pets.filter((p) => p && typeof p.id === 'string' && typeof p.name === 'string')
    : undefined
  return {
    id: `moment-${moment.id}`,
    sourceId: moment.id,
    date: dateStr,
    title: '回忆',
    type: 'memory',
    emoji: petTags?.[0]?.emoji || content.petEmoji || '💭',
    photos,
    description: content.description || (raw.aiSummary as string) || '',
    petId: moment.petId || (raw.pet_id as string) || undefined,
    petName: content.petName || petTags?.[0]?.name,
    petEmoji: content.petEmoji || petTags?.[0]?.emoji,
    petTags,
  }
}

// 【已删除】tagPetEvents（给单只宠物的事件补归属 + id 加宠物前缀）：
// 第 4 波它就已经没有调用点了（当时被以后可能还要用的理由保留下来）。
// 第 4b 波复核：本页唯一还会新增事件的地方是 momentToTimelineEvent —— 它拿到的回忆
// 自带服务端写入的 content.pets 归属，id 本身就是 `moment-<id>` 全局唯一，不经过这里。
// 按只被本页用到、又没人用的就删干净的口径一并删除；将来真要重做系统事件，
// 需要的是重新设计归属与 id 规则，而不是这段为旧结构写的映射。
//

export default function TimelinePage() {
  const [showBanner, setShowBanner] = useState(true)
  // 真实回忆事件（pet_moments）：时光线上用户亲手记的那一类内容，新增回忆后就地插入避免整页重拉
  const [momentEvents, setMomentEvents] = useState<TimelineEvent[]>([])
  // 【已删除】dynamicEvents（2026-09-12 第 4 波拆分）：它原本装打卡里程碑 + 打卡明细事件，
  //   那两类已按用户要求撤出时光线（明细搬去健康档案页），产出的数组恒为空 ——
  //   留着一个永远是 [] 的 state 只会让后来人以为这条流上还有打卡内容。
  // 【已删除】diaryRecords（2026-09-12 IA 第 2c 批并入的「宠物日记」）：
  // 那批内容（diaryEngine 按每条打卡 1:1 生成的正文）是打卡数据的衍生品，不是用户记的回忆，
  // 第 4b 波按用户要求整批移出本页 —— 生成逻辑与渲染都搬到了健康档案页（pagesPet/trends）
  // 的「打卡记录」分区。本页因此不再持有、也不再渲染任何自动生成的内容。
  /**
   * 用户是否**手动改过**「记给谁」（新增回忆弹窗里的宠物胶囊）
   *
   * 手动改过之后就不再被正文自动识别覆盖 —— 否则用户选好归属、回头补一句提到别的宠物，
   * 选择会被悄悄改掉（这正是 AI 自动选宠物最容易惹人烦的地方）。
   *
   * 【位置】与其它 state 放在一起（原先夹在 applyAutoPetSelection 与打开弹窗之间）。
   */
  const petSelectionTouchedRef = useRef(false)
  // 【已删除】toneFilter（6 档心情筛选）：日记卡离开本页后它筛不了任何东西
  // （本页剩下的回忆卡没有心情档位，硬套一个只能靠猜），所以随日记一起搬到
  // 健康档案页的「打卡记录」分区 —— 那里筛的是每条打卡自动生成的心情档位。
  const [flashback, setFlashback] = useState<FlashbackMemory | null>(null)
  const [flashbackAdded, setFlashbackAdded] = useState(false)
  /**
   * 页头副标题、速览与成就分区要用的真实计数（2026-09-12 v2 屏 02 新增，第 4b 波改口径）
   *
   * 由 loadTimelineData **同一次拉取**里现算（回忆 + 打卡两批数据都是刚拉到的），
   * 保证页头的「N 天的记录」、速览的「时光记录」与时间线上的条数不会各说各话。
   * 每个字段数的是打卡还是回忆，见 TimelineSummary / buildTimelineSummary 的注释。
   */
  const [timelineSummary, setTimelineSummary] = useState<TimelineSummary>(EMPTY_TIMELINE_SUMMARY)
  const themeClass = useThemeClass()
  /**
   * 广播「当前选中的是第 2 个 tab」给自定义 tabBar 组件（时光 = 下标 1）。
   *
   * 【为什么必须由页面主动广播】微信给**每个 tab 页各创建一个**自定义 tabBar 实例
   * （官方文档原话：每个 tab 页下的自定义 tabBar 组件实例是不同的），实例建好后就不随
   * `switchTab` 重新挂载，React 也不会因路由变化自动重渲染它 —— 选中态只能由 tab 页在
   * `useDidShow` 时推进来。
   * 本页下方另有一个自己的 `useDidShow`（刷数据用），两者各挂各的回调、互不影响：
   * 那个回调里有 `isFirstShowRef` 提前 return，若把广播并进去，首次进入本页就不会广播高亮。
   *
   * 位置要求：组件函数体顶层、与其它 hook 同级（无条件调用）。
   */
  useTabBarSelected('/pages/timeline/index')

  /**
   * 登录态三件套（2026-09-12 补齐「时光没有绑定登录」）
   *
   * 【为什么本页此前没有（代码事实，不是历史猜测）】本页改造前从头到尾没有出现过
   * authStore / authGuard：数据加载只兜了一道 `if (userId && petsList.length)`，
   * 而 userId 来自 petStore（下面那行 `usePetStore((s) => s.userId)`），跟登录态并不是一回事 ——
   * 于是未登录用户能直接进到本页，退出登录 / 换账号后也没人把用户送回登录页。
   * 另外三个 tab 页（mine、creative、pet-profile）都已按 redirectToLoginIfNeeded 收口，本页对齐。
   */
  const user = useAuthStore((s) => s.user)
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  const isInitialized = useAuthStore((s) => s.isInitialized)

  /**
   * 页面级未登录守卫：未登录进入时光页时统一走 redirectToLoginIfNeeded 收口跳登录页
   * （与 mine / creative / pet-profile 三个 tab 页同款，2026-09-12 补齐）。
   *
   * 【为什么必须先判 isInitialized（关键）】authStore 的初始值就是
   * `isAuthenticated: false`（stores/authStore.ts:41），真正的登录态要等 `initialize()`
   * 从本地存储恢复完才落定。若这里直接判「!isAuthenticated 就跳」，冷启动那一瞬会把
   * **已经登录的用户**也弹去登录页 —— 所以初始化没跑完时一律不动，等它变 true 再判。
   *
   * 【位置】与其它 hook 同级、无条件调用：不能塞进条件分支或循环里，否则 hook 调用顺序会漂。
   *
   * 依赖数组按三个对照页的口径写（isInitialized / isAuthenticated / user）：
   * 初始化完成、登录态翻转、换账号（user 对象引用变化）都会重新判一次。
   */
  useEffect(() => {
    if (!isInitialized) return
    if (!isAuthenticated || !user) {
      // 未登录统一走收口守卫：已是登录页时不再 reLaunch（避免路由竞态报 routeDone not found）
      redirectToLoginIfNeeded()
      return
    }
  }, [isInitialized, isAuthenticated, user])
  // 【已删除】useAnalytics/trackEvent：本页唯一的埋点是日记卡的「分享这篇日记」（share_diary），
  // 随日记卡一起搬去了趋势页；本页现在不产生任何埋点事件，遂一并撤掉这次 hook 调用。
  const currentPet = usePetStore((s) => s.currentPet)
  const userId = usePetStore((s) => s.userId)
  // 【本页的宠物归属口径（2026-09-11 两轮反复后的最终结论）】
  //   第一轮："多宠物场景不能只固定一只" → 加宠物切换条，整页（列表 + 数字）跟着选中那只变。
  //   第二轮：用户否掉第一轮 —— "时光页面 所有宠物应该共用一个回忆录吧 你怎么做分类了？？"
  //           → 切换条整体移除，所有宠物共用**一条时间线**，每条卡片上标注是哪只宠物；
  //             速览数字改成全宠口径。
  //   因此这里只保留宠物列表本身，用途收窄为：①冷启动时兜底加载 ②新增回忆时选归属宠物。
  const pets = usePetStore((s) => s.pets)
  const fetchPets = usePetStore((s) => s.fetchPets)
  /**
   * 宠物 id 拼串：既是 loadTimelineData 的依赖（值语义，避免数组引用抖动引发后台白跑），
   * 也是"增删宠物后要不要重新加载"的判据。
   */
  const petsKey = pets.map((p) => p.id).join(',')

  // 新增回忆弹窗状态
  const [showAddMemoryModal, setShowAddMemoryModal] = useState(false)
  const [memoryText, setMemoryText] = useState('')
  /**
   * 这条新回忆记给**哪些**宠物（多选，2026-09-11 多宠共同回忆改造）
   *
   * · 默认当前宠物；第一只即"主宠物"（落库到 pet_moments.pet_id，兼容所有旧读取路径）。
   * · 弹窗里可多选（"两只一起打闹"这类共同回忆不必拆成两条）。
   * · 切换条移除后本页没有"当前宠物"入口，所以归属必须能在弹窗里自己选/自己改。
   */
  const [memoryPetIds, setMemoryPetIds] = useState<string[]>([])
  // 多图支持：本地临时路径数组（最多 9 张），与后端 photos 上限对齐
  const [memoryPhotoPaths, setMemoryPhotoPaths] = useState<string[]>([])
  // 补记日期（YYYY-MM-DD），默认今天，可手动选过去任意一天
  const [memoryDate, setMemoryDate] = useState(() => getLocalDateString())
  const [isMemorySubmitting, setIsMemorySubmitting] = useState(false)
  // AI 生成/润色 loading（防止重复点击）
  const [isAiDescribeLoading, setIsAiDescribeLoading] = useState(false)
  const [isAiPolishLoading, setIsAiPolishLoading] = useState(false)

  // 回忆详情弹窗状态：点击时间线条目时打开
  const [detailEvent, setDetailEvent] = useState<TimelineEvent | null>(null)
  // 【已移除】moments 原始记录状态：全程只写不读（详情用的是 detailEvent、删除用的是 detailEvent.sourceId），
  // 属重构后遗留的只写状态，本次一并清掉（2026-09-11）。

  // 宠物对象的最新引用：回调里读它拿名字/出生日期等展示字段（比把对象塞进依赖更稳）
  const currentPetRef = useRef(currentPet)
  currentPetRef.current = currentPet
  /**
   * 请求序号：丢弃过期响应。
   * 切回本页的瞬间可能同时有两个请求在飞（切走前那个 + 新触发的），
   * 若旧响应（不含刚记的回忆）晚到，就会把新快照覆盖掉——"看不到新记录"当场复现一次
   * （2026-09-11 双 Agent 审查 P1-2）。
   */
  const loadSeqRef = useRef(0)
  /** 是否成功加载过一次：决定加载失败时"保留旧列表"还是"降级为空态" */
  const hasLoadedRef = useRef(false)
  /**
   * 上一次加载时的账号 id。
   * 【为什么要它】hasLoadedRef 的"失败时保留旧列表"只对**同一个账号**成立：
   * 换账号后若回忆接口恰好失败，旧账号的回忆会留在屏幕上（2026-09-11 审查 P3-6）。
   * 账号一变就把标志清零并清空列表，从根上避免跨账号串数据。
   */
  const lastUserIdRef = useRef<string | null>(null)
  // 【已删除】loadedPetIdRef：它原本用来判断"屏幕上这份列表属于哪只宠物"，
  // 以便换宠物后的首次失败要清空、同一只的刷新失败可保留旧列表。
  // 共用回忆录改造后列表是"全账号"的，不存在"列表属于某只宠物"这回事，该 ref 一并移除。

  /**
   * 加载时光线数据：**所有宠物共用的回忆录**（真实回忆 pet_moments + 旧时光提醒）
   * 外带一次「逐只宠物拉打卡」—— 后者不产出任何卡片，只喂给页头/速览/成就的打卡数字（第 4b 波）。
   *
   * 【2026-09-11 改造：从"按当前宠物分开"改为"一本共用回忆录"】
   *   用户原话："时光页面 所有宠物应该共用一个回忆录吧 你怎么做分类了？？"
   *   改前：`getMoments(当前宠物id)` + `getCheckins(当前宠物id)` → 列表与数字都只属于选中那只，
   *         顶部还有宠物切换条（那就是用户说的"分类"）。
   *   改后：回忆一次性拉**本账号下全部**（不传 petId 即为全量），
   *         每条回忆都带宠物归属（卡片上显示"谁的回忆"，见 momentToTimelineEvent）。
   *
   * 抽成 useCallback 是为了让「首次进入」与「切回本页」共用同一份加载逻辑（见下方 useDidShow）。
   *
   * 依赖用 pets 的 id 拼串而不是数组引用（2026-09-11 审查 P1-2 的延伸）：
   *   petStore.fetchPets 每次都用服务端新数组重建对象引用，「我的」等 tab 页每次 show 都会 fetchPets，
   *   依赖引用就会让本页在**不可见的后台**白跑一遍全部请求；用 id 串后语义不变、请求数不增。
   */
  const loadTimelineData = useCallback(async () => {
    const seq = ++loadSeqRef.current
    /** 本次请求是否已被更新的请求取代（取代则丢弃结果，不写状态） */
    const isStale = () => seq !== loadSeqRef.current
    // 账号切换（登录/退出/换号）：清空上一账号的列表与"已加载"标志，
    // 否则接口失败时"保留旧列表"会把别人的回忆留在屏幕上（审查 P3-6）
    if (lastUserIdRef.current !== (userId ?? null)) {
      lastUserIdRef.current = userId ?? null
      hasLoadedRef.current = false
      setMomentEvents([])
      // 打卡里程碑事件已不再生成（2026-09-12 第 4 波），故这一支无需再清 dynamicEvents
      setFlashback(null)
      // 计数同理：页头「N 天的记录」与速览的数字都是上一账号的，不清理就会串号显示
      setTimelineSummary(EMPTY_TIMELINE_SUMMARY)
    }
    // 宠物列表以 store 为准；冷启动时 store 可能还没加载，用 currentPet 兜底成"只有一只"
    const storePets = usePetStore.getState().pets
    const petsList = storePets.length ? storePets : (currentPetRef.current ? [currentPetRef.current] : [])
    /**
      * 本次加载得到的时光线卡片（用户回忆 + 已加入的旧时光提醒）
      *
      * 【为什么提升到 try 外层】两条兜底分支（没账号 / 刷新失败）要它保持为空，
      * 而且 ⑤ 的计数必须吃**本次这批**数据（state 更新是异步的，此刻读不到新值）。
      * 初始为 [] 也就是「这次没拉到东西」，两条兜底分支不必再各自写一遍。
      */
    let eventsForSummary: TimelineEvent[] = []
    try {
      if (userId && petsList.length) {
        /* ① 回忆：不传 petId = 拉本账号下**所有宠物**的回忆（共用一本回忆录的关键一行）。
         *
         * 回忆与下面的打卡**各自兜错**（2026-09-11 改造时特意分开的）：
         * 回忆接口挂掉时，旧时光提醒/页头数字仍然应该照常显示，
         * 不能因为一个接口失败就把整条时间线降级成空白。
         */
        let fetchedMoments: PetMoment[] = []
        let momentsFailed = false
        try {
          fetchedMoments = await timelineService.getMoments()
        } catch {
          momentsFailed = true
        }
        if (isStale()) return
        if (momentsFailed) {
          // 刷新失败：**绝不把已经显示出来的回忆清空**（2026-09-11 审查 P2-1 事故）。
          // 本函数每次切回都会跑，若「失败即置空」，一次网络抖动就会让用户看到
          // 「还没有时光记录」——那比「看不到新记录」更严重（数据其实在库里）。
          if (hasLoadedRef.current) {
            Taro.showToast({ title: '刷新失败，请稍后重试', icon: 'none' })
          } else {
            setMomentEvents([])
          }
        } else {
          setMomentEvents(fetchedMoments.map(momentToTimelineEvent))
        }

        // ② 打卡：逐只宠物各拉一次（宠物数量通常 ≤4，并发拉取）。
        //    【2026-09-12 第 4 波】这批打卡**不再生成时光线事件**（明细已搬到健康档案页），
        //    【第 4b 波】日记也搬走了，于是它只剩一个用途：喂给 ⑤ 算速览与成就里的
        //    **打卡口径**数字（打卡天数 / 连续天数）。单只失败不拖垮整页：该只按没有打卡算。
        const perPetEvents = await Promise.all(
          petsList.map(async (pet) => {
            try {
              const entries = await getCheckins(pet.id, userId)
              return { pet, entries }
            } catch {
              return { pet, entries: [] as PetHealthEntry[] }
            }
          }),
        )
        if (isStale()) return

        // ③ 旧时光提醒：扫全部宠物，取第一只有「往年今天」的（横幅文案里已含宠物名）
        //    第 4b 波起它只认宠物档案里的日期（生日 / 建档日），不再翻打卡记录 ——
        //    判断依据写在 findFlashbackMemory 的函数头注释里。
        let memory: FlashbackMemory | null = null
        for (const { pet } of perPetEvents) {
          memory = findFlashbackMemory(pet)
          if (memory) break
        }
        setFlashback(memory)

        /**
         * ④ 页头副标题 + 速览 + 成就分区的真实计数（2026-09-12 v2 屏 02；第 4b 波改口径）
         *
         * 【为什么放在这里、吃同一批数据】页头写「N 天的记录」、成就写「本月新增 N 条」，
         * 若另起一次请求去算，就会出现「页头说 12 天、时间线上只有 9 天」这种同屏自相矛盾。
         * 这里用的正是上面 ① 拉到的回忆与 ② 拉到的打卡，与渲染的是同一份数据。
         *
         * 【为什么就地拼一份事件数组、而不是读 state】state 更新是异步的（下一个渲染周期才生效），
         * 此刻读到的还是上一轮的值。而「本月新增 N 条」必须包含本次刚拉到的回忆
         * —— 所以就地用本次结果拼出与渲染时**同一个算法**的事件数组，只是不等 state。
         * 拼法与 timelineEvents 那个 memo 一一对应（回忆 + 已加入的旧时光提醒）。
         *
         * 【回忆用哪个变量】回忆接口失败时会保留旧列表（不 setMomentEvents），
         * 所以这里吃的是**本次成功拉到的** fetchedMoments；
         * 失败（momentsFailed）时按 0 算 —— 计数少算好过虚高。
         */
        eventsForSummary = [
          ...(momentsFailed ? [] : fetchedMoments.map(momentToTimelineEvent)),
          // 旧时光条目只有用户点过「添加到时光线」才在线上（flashbackAdded），与渲染口径一致
          ...(flashbackAdded && memory
            ? [{
                id: 'flashback-auto',
                date: `${memory.yearsAgo}年前`,
                title: memory.title,
                type: 'flashback' as const,
                emoji: memory.emoji,
                photos: [] as string[],
                description: memory.description,
                flashbackYear: memory.yearsAgo,
              }]
            : []),
        ]
        setTimelineSummary(buildTimelineSummary(perPetEvents, eventsForSummary))

        hasLoadedRef.current = true
      } else if (currentPetRef.current) {
        // 账号信息还没到位（极少见）：没有账号就拉不到任何真实数据，
        // 本页退化成「只有宠物档案、没有内容」的形态 —— 但绝不给假数据凑数。
        // 需要说明的是：这里**不再**放生日/建档里程碑（2026-09-12 第 4 波已把它们撤出时光线），
        // 唯一与档案有关的只剩下面这条「旧时光提醒」横幅（用户点「添加到时光线」才会变成卡片）。
        setMomentEvents([])
        setFlashback(findFlashbackMemory(currentPetRef.current))
        // 同理：没拉过任何数据，计数必须归零，不能把上一账号的数字留在页头上
        setTimelineSummary(EMPTY_TIMELINE_SUMMARY)
        hasLoadedRef.current = true
      }
    } catch {
      if (isStale()) return
      // 兜底（正常不会走到：上面两条链路都已各自 try/catch）：
      // 保留旧列表并提示，绝不把用户已经看到的回忆清空。
      // （列表是「全账号共用」的，不再有「保留的旧列表属于别的宠物」那种串号问题，
      //   原先按宠物核对归属的 loadedPetIdRef 判断随之删除。）
      if (hasLoadedRef.current) {
        Taro.showToast({ title: '刷新失败，请稍后重试', icon: 'none' })
        return
      }
      if (currentPetRef.current) {
        const pet = currentPetRef.current
        setMomentEvents([])
        // 同上一支：这里只会在「从未加载成功过」时走到
        setFlashback(findFlashbackMemory(pet))
        // 兜底支同样要把计数归零：否则页头会留着上一轮的「N 天的记录」
        setTimelineSummary(EMPTY_TIMELINE_SUMMARY)
      }
    }
    // pets 用 id 串做依赖（值语义）：换宠物/增删宠物都会重载，而数组引用抖动不会
    // （pets 本身从 store 闭包读，不在依赖里，故 eslint 需要这行豁免）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [petsKey, userId])

  // 首次进入本页 / 宠物列表变化 / 账号切换时加载
  // 「旧时光提醒 → 添加到时光线」的重置放在这里、而不是放进 loadTimelineData：
  // 该函数现在每次切回都会跑，重置写在里面会让用户刚添加的旧时光条目在切一次 tab 后凭空消失，
  // 而横幅此刻已被关闭（showBanner=false）→ 本页再也点不出这个入口（2026-09-11 审查 P2-2）。
  useEffect(() => {
    setFlashbackAdded(false)
    // 关掉两个弹窗并清空草稿：
    // 「时光」是 tabBar 页、切走再切回**不重挂载**，而原生 tabBar 由客户端渲染在页面
    // fixed 遮罩之上 —— 用户可以开着「新增回忆」弹窗去别的页面（比如宠物档案）换选中宠物再回来。
    // 共用回忆录改造后，回忆的归属由弹窗里自己选的宠物决定（memoryPetIds，可多选），
    // 所以这个 effect 只负责"别把上一轮的草稿留在屏幕上"，不再需要处理归属串号。
    setShowAddMemoryModal(false)
    setMemoryText('')
    setMemoryPhotoPaths([])
    setDetailEvent(null)
    void loadTimelineData()
  }, [loadTimelineData])

  /**
   * 切回本页时重新拉取（2026-09-11 修复「AI 里记了回忆，时光里看不到新记录」）
   *
   * 坑点：「时光」是 tabBar 页面，微信小程序切走再切回**不会重新挂载页面实例**，
   * 上面的 useEffect 不会再执行，列表就永远停在切走前的快照——用户在 AI 页记完回忆
   * 再点「时光」，新记录一直不出现。生产实测证据：2026-09-11 04:11:04 保存回忆
   * 返回 200，之后到 04:15 该用户没有任何 GET /api/timeline/moments 请求，
   * 即页面从未重新加载。onShow（useDidShow）是唯一可靠的「回到本页」时机。
   *
   * 首次 show 与上面的 useEffect 时机重叠，用 ref 跳过，避免刚进页面就连发两次请求。
   */
  const isFirstShowRef = useRef(true)
  useDidShow(() => {
    // 宠物列表兜底加载（仅在列表为空时）：共用回忆录要"全部宠物的 id"才能拉全量回忆，
    // 而 store 里的列表依赖「先进过首页/档案页」，用户若直接从「时光」tab 冷启动就会是空的
    // → 会退化成"只按 currentPet 兜底"的残缺列表。
    //
    // ⚠️ 不能每次 show 都无脑 fetchPets：petStore.fetchPets 会用服务端返回的新数组
    // 重建 currentPet **对象引用**（`pets.find(...)`），本页多处展示字段都吃这个对象；
    // 而列表已有数据时本页并不需要它——交给其它页面（我的/宠物档案）去刷新即可。
    // （loadTimelineData 的依赖是 petsKey 值，引用抖动不会再触发无谓重载。）
    if (userId && pets.length === 0) void fetchPets(userId)

    if (isFirstShowRef.current) {
      isFirstShowRef.current = false
      return
    }
    void loadTimelineData()
  })

  /**
   * 页面分享（2026-09-12 IA 第 2c 批）
   *
   * 【为什么要在这里注册】本页是**被删掉的「宠物日记」页的分享落地页**：
   * 原日记页注册了 useShareAppMessage/useShareTimeline，其 path 硬编码指向它自己那条路由
   * （全仓唯一一条指向被删路由的硬编码分享 path）。路由删掉后那条 path 就是死链，因此：
   *   · path 改指本页 /pages/timeline/index；
   *   · 标题从「宠物日记」改为「时光线」，与页头文案一致。
   * ⚠️ 已经发出去的旧分享卡片仍指向**已删除的日记页路由**，微信小程序分享卡片 **path 无法重定向**，
   *   只能失效 —— 这项取舍在交付自述里单独交代（清单原本建议留 20 行 redirect 页，本批按任务书
   *   硬约束「删目录」执行，未留 redirect）。
   * ⚠️ 不注册 share hook 的话，右上角「转发」会被小程序隐藏（微信只在页面注册了回调时才露出转发入口）。
   * 【第 4b 波】原来这里还补了一句日记卡上的分享按钮也要靠它—— 日记卡已搬去健康档案页，
   * 本页现在只剩**页面级转发**这一个用途，但这条 hook 必须留着（否则本页没法分享）。
   */
  useShareAppMessage(() => ({
    title: '星河宠记 - 时光线',
    path: '/pages/timeline/index',
  }))
  useShareTimeline(() => ({
    title: '星河宠记 - 时光线',
  }))

  /**
   * 时光线的全部卡片（2026-09-12 第 4 波；第 4b 波起这是本页**唯一**的内容来源）
   *
   * 【包含哪些】① 用户手记的真实回忆（momentEvents）；② 用户点过「添加到时光线」的旧时光提醒。
   * 【不包含哪些】**打卡里程碑与打卡明细已经整批移除** —— 用户在时间线上看到的内容应当是
   * 「自己留下过什么」，而打卡明细与自动生成的日记现在都归健康档案页（见文件头 4b 那段）。
   * 【排序】按 date 降序；旧时光那条是「N年前」文案，认不出日期，会被 sortableDate 兜到最后，
   * 于是它既排在末尾、又落进分组里的「旧时光」组。改前这一步在 buildTimelineFeedItems 里，
   * 那个函数随日记一起删除后，排序就近放回本 memo（它本来就只服务于这条线）。
   */
  const timelineEvents = useMemo(() => {
    const allEvents: TimelineEvent[] = []

    if (flashback && flashbackAdded) {
      allEvents.push({
        id: 'flashback-auto',
        date: `${flashback.yearsAgo}年前`,
        title: flashback.title,
        type: 'flashback',
        emoji: flashback.emoji,
        photos: [],
        description: flashback.description,
        flashbackYear: flashback.yearsAgo,
      })
    }

    // 用户手记的真实回忆：按日期降序（新的在前）
    allEvents.push(...momentEvents)

    // 整体排序：'YYYY-MM-DD' 按字典序降序；旧时光那条经 sortableDate 变成 '9999-99-99' 垫底
    return allEvents.sort(
      (a, b) => sortableDate(b.date).localeCompare(sortableDate(a.date)),
    )
  }, [momentEvents, flashback, flashbackAdded])

  /**
   * 今天（本地日历日），供卡面日期与本月判断使用
   *
   * 【为什么放在这里】2026-09-12 第 4 波起它就被上移到数据区（当时 feed 排序要用）；
   * 第 4b 波删掉 feed 后它仍然被渲染层用着（卡面上的「今天」）。取法不变：
   * 本地日历日、每次渲染取一次。本页是个长驻的 tab 页，跨零点不会自己重渲染，
   * 但跨零点时用户总要切走再切回（useDidShow 会重新拉数据、连带这次渲染），
   * 所以不需要为此挂计时器 —— 那样反而多一个常驻定时器。
   */
  const todayStr = getLocalDateString()

  /**
   * 时光线按月分组（渲染直接吃它，第 4b 波起不再有第二份"筛选后的"分组）
   *
   * 【为什么单独一个 memo】分组只该算一次：下面渲染要按组渲染、速览的数字要从同一份结果里数，
   * 两处吃同一份才能保证「数字与列表对得上」。
   * 【第 4b 波】原来的"心情筛选 → 可见分组"两级结构拆掉了：日记离开本页后没有可筛的东西，
   * 屏幕上渲染的就是这里的分组，不再有第二套口径。
   */
  const monthGroups = useMemo(() => groupEventsByMonth(timelineEvents), [timelineEvents])

  /**
   * 速览「时光记录」那一格的数字
   *
   * 【口径】= 时光线上**实际渲染的卡片数**（用户回忆 + 已加入的旧时光提醒），
   * 直接从渲染用的分组里数出来 —— 屏幕上有几张卡，这里就是几，不存在第二种口径。
   */
  const recordCount = useMemo(
    () => monthGroups.reduce((sum, group) => sum + group.count, 0),
    [monthGroups],
  )

  /**
   * 页头副标题里的「N 天的记录」
   *
   * 【第 4b 波改口径】改前取的是**打卡天数**：天天打卡但从没写过回忆的用户，
   * 页头会写着「30 天的记录」而下面一张卡都没有 —— 正是"数字与列表对不上"。
   * 现在取的是**用户回忆覆盖的天数**（buildTimelineSummary.memoryDays，按本地日历日去重），
   * 与屏幕上这条时光线同源。
   *
   * 为 0 时返回空串 → 页头只显示「时光」，不显示「0 天的记录」这种丧气文案（原型也没有）。
   */
  const recordDaysLabel = timelineSummary.memoryDays > 0 ? `${timelineSummary.memoryDays} 天的记录` : ''

  /**
   * 成就分区第一格（连续打卡）当前展示的那一档
   *
   * 三档 7/30/100 天全达成时返回最后一档（卡片显示「已达成」），永不返回 null。
   * 【为什么这一格仍是打卡口径】它本身就是"坚持打卡"的成就，与速览的「打卡天数」同源
   * （同一次 getCheckins），见 buildTimelineSummary 的注释。
   */
  const streakItem = useMemo(() => pickStreakAchievement(timelineSummary.streak), [timelineSummary.streak])

  /**
   * 点页头右侧的爪印圆钮 → 打开宠物档案
   *
   * ⚠️ 必须用 navigateTo：宠物档案（pages/pet-profile/index）已于 2026-09-12
   * 退出 tabBar.list，变成**普通页面**；对非 tab 页调 switchTab 会**静默失败**
   * （不抛错、不报错，用户点了毫无反应）。反过来本页自己是 tab 页，
   * 从别的页面回本页才需要 switchTab —— 本页没有这种入口。
   *
   * 一只宠物都没有时不跳转（档案页对空列表有自己的空态，跳过去只会让用户多绕一圈），
   * 改为提示去添加，避免出现"点了没反应"的假按钮。
   */
  const handleOpenPetProfile = () => {
    if (!pets.length) {
      Taro.showToast({ title: '先去添加一只毛孩子吧', icon: 'none' })
      return
    }
    Taro.navigateTo({ url: '/pages/pet-profile/index' })
  }

  /**
   * 从回忆正文里**自动认宠物**（2026-09-11 新增，用户点名要的能力）
   *
   * 实现抽到 utils/petMatching（AI 对话页记回忆也要用同一套规则，避免两处口径分叉）。
   * 这里只做一层包装：把本地宠物列表与当前宠物传进去。
   */
  const detectPets = (text: string) =>
    detectPetsInText(text, pets, currentPet?.id)

  /**
   * 正文变化时刷新"记给谁"的默认值（统一的入口，onInput 与 AI 生成/润色都要走它）
   *
   * 【为什么要抽出来】AI 生成描述 / AI 润色是**程序化** setMemoryText，
   * 不会触发 Textarea 的 onInput —— 只挂在 onInput 上时，"先写今天去公园（默认可乐）、
   * 再点润色得到含「布丁」的文案"这条真实路径归属会错（2026-09-11 审查 P2-3）。
   */
  const applyAutoPetSelection = (text: string) => {
    if (petSelectionTouchedRef.current) return
    const detected = detectPets(text)
    if (detected.length) setMemoryPetIds(detected)
  }

  /**
   * 打开「新增回忆」弹窗
   *
   * 共用回忆录改造后不再依赖"当前宠物"是否已选：只要账号下有宠物就能记，
   * 归属由弹窗里选的宠物决定（默认当前宠物；正文里提到谁就先默认给谁，用户可改）。
   *
   * ⚠️ 冷启动兜底（2026-09-11 审查 P2-4）：用户直接从「时光」tab 冷启动时，
   * store 里的宠物列表可能还没到位（其它页面负责刷新，本页只在列表为空时补拉一次，
   * 而补拉是异步的）——此时若直接判定"没有宠物"会误报"请先添加宠物"。
   * 所以这里先等一次补拉，再决定是否拦截。
   */
  const handleAddMemory = async () => {
    let list = pets
    if (!list.length && userId) {
      await fetchPets(userId)
      list = usePetStore.getState().pets
    }
    if (!list.length) {
      Taro.showToast({ title: '请先添加宠物', icon: 'none' })
      return
    }
    // 每次打开弹窗重置表单：清空文字/照片，日期默认今天，归属默认当前宠物
    setMemoryText('')
    setMemoryPhotoPaths([])
    setMemoryDate(getLocalDateString())
    petSelectionTouchedRef.current = false
    setMemoryPetIds([currentPet?.id && list.some((p) => p.id === currentPet.id) ? currentPet.id : list[0].id])
    setShowAddMemoryModal(true)
  }

  /** 选择回忆照片（支持多选，最多 9 张，与后端 photos 上限一致） */
  const handleAddMemoryPhoto = async () => {
    try {
      const remaining = 9 - memoryPhotoPaths.length
      if (remaining <= 0) {
        Taro.showToast({ title: '最多上传 9 张照片', icon: 'none' })
        return
      }
      const res = await chooseImageWithPrivacy({
        count: remaining,
        sizeType: ['compressed'],
        sourceType: ['album', 'camera'],
      })
      if (!res.tempFilePaths.length) return
      setMemoryPhotoPaths((prev) => [...prev, ...res.tempFilePaths].slice(0, 9))
    } catch (err) {
      if ((err as { errMsg?: string }).errMsg?.includes('cancel')) return
      Taro.showToast({ title: '选择照片失败', icon: 'none' })
    }
  }

  /** 移除已选照片（多图编辑） */
  const handleRemoveMemoryPhoto = (index: number) => {
    setMemoryPhotoPaths((prev) => prev.filter((_, i) => i !== index))
  }

  /**
   * AI 生成回忆描述：取第一张照片上传 → 视觉模型生成温暖文案
   * 生成的文案填入输入框（用户可编辑后再保存）
   */
  const handleAiDescribe = async () => {
    if (isAiDescribeLoading) return
    if (!memoryPhotoPaths.length) {
      Taro.showToast({ title: '请先上传照片', icon: 'none' })
      return
    }
    setIsAiDescribeLoading(true)
    try {
      const description = await timelineService.aiDescribe(memoryPhotoPaths[0])
      if (description) {
        setMemoryText(description)
        // AI 写出来的文案同样要认一遍宠物（程序化赋值不会触发 onInput）
        applyAutoPetSelection(description)
        Taro.showToast({ title: 'AI 已生成描述，可编辑', icon: 'success' })
      } else {
        Taro.showToast({ title: 'AI 生成失败，请重试', icon: 'none' })
      }
    } catch {
      Taro.showToast({ title: 'AI 生成失败，请重试', icon: 'none' })
    } finally {
      setIsAiDescribeLoading(false)
    }
  }

  /** AI 润色回忆文案：把用户写的草稿扩写成温暖文案 */
  const handleAiPolish = async () => {
    if (isAiPolishLoading) return
    const text = memoryText.trim()
    if (!text) {
      Taro.showToast({ title: '请先选择宠物', icon: 'none' })
      return
    }
    setIsAiPolishLoading(true)
    try {
      const polished = await timelineService.aiPolish(text)
      if (polished) {
        setMemoryText(polished)
        // 润色后的文案可能提到了别的宠物（"布丁也在旁边"）→ 同样重新识别一次
        applyAutoPetSelection(polished)
        Taro.showToast({ title: 'AI 已润色', icon: 'success' })
      } else {
        Taro.showToast({ title: 'AI 润色失败，请重试', icon: 'none' })
      }
    } catch {
      Taro.showToast({ title: 'AI 润色失败，请重试', icon: 'none' })
    } finally {
      setIsAiPolishLoading(false)
    }
  }

  /**
   * 提交回忆：逐张上传照片 → 携带补记日期（happenedAt）保存
   * 保存成功后刷新本地回忆列表（不用整页重拉，避免闪烁）
   *
   * 归属宠物＝弹窗里选中的那些（memoryPetIds，可多选），不再取全局 currentPet ——
   * 共用回忆录里"当前宠物"未必是用户想记的那只（本页也再无切换当前宠物的入口）。
   */
  const handleAddMemorySubmit = async () => {
    const text = memoryText.trim()
    if (!text) {
      Taro.showToast({ title: '请写一段回忆描述', icon: 'none' })
      return
    }
    /**
     * 归属宠物＝弹窗里明确选中的那些（memoryPetIds，可多选）。
     *
     * ⚠️ 不做静默兜底（2026-09-11 审查 P2-5）：如果用户选中的宠物已经不在列表里
     * （例如刚在别的页面删掉了它），原先的 `|| currentPet || pets[0]` 会把这条回忆
     * **悄悄记到另一只名下**——用户看不出来，数据归属就错了。宁可拦下来让用户重选。
     */
    const targetPets = memoryPetIds
      .map((id) => pets.find((p) => p.id === id))
      .filter((p): p is PetProfile => !!p)
    if (!targetPets.length) {
      Taro.showToast({ title: '宠物信息已变化，请重新选择', icon: 'none' })
      return
    }
    if (!userId) return

    setIsMemorySubmitting(true)
    try {
      // 逐张上传照片，收集服务器返回的 URL（相对路径，展示时再补全）
      const photoUrls: string[] = []
      const token = storage.getToken()
      for (const filePath of memoryPhotoPaths) {
        const uploadRes = await Taro.uploadFile({
          url: `${CONFIG.API_BASE_URL}/api/timeline/photo/upload`,
          filePath,
          name: 'photo',
          header: token ? { Authorization: `Bearer ${token}` } : {},
        })
        const uploadData = JSON.parse(uploadRes.data) as { success: boolean; data?: { url: string } }
        if (uploadData.success && uploadData.data?.url) {
          photoUrls.push(uploadData.data.url)
        }
      }

      /**
       * 提交：petId = 第一只（主宠物，落库到 pet_moments.pet_id，兼容旧读取路径），
       * petIds = 全部选中的宠物 → 服务端校验归属后用库里的权威名字写入 content.pets。
       * 前端这里的 content.petName/petEmoji 只是"服务端不上报时"的兜底，服务端会覆盖成权威值。
       */
      const primary = targetPets[0]
      const saved = await timelineService.addMoment({
        userId,
        petId: primary.id,
        petIds: targetPets.map((p) => p.id),
        type: 'memory',
        content: {
          petName: primary.name,
          petEmoji: primary.species === 'cat' ? '🐱' : primary.species === 'dog' ? '🐕' : '🐾',
          description: text,
        },
        photos: photoUrls,
        // 补记日期：直接传 YYYY-MM-DD 纯日期（不拼本地时间，避免跨时区偏移），
        // 服务端按日解析存储，前端展示时 slice(0,10) 与所选日期完全一致
        happenedAt: memoryDate || undefined,
      })

      setShowAddMemoryModal(false)
      Taro.showToast({ title: '回忆已保存 ✦', icon: 'success' })

      // 本地插入新回忆，避免整页重拉。
      // 用服务端返回的 saved（含 content.pets）；若服务端没回这一段（旧版本/离线），
      // 就地补上本地已知的宠物标签，保证新记录立刻显示归属。
      const savedMoment = (saved && typeof saved === 'object')
        ? {
            ...saved,
            content: {
              ...(saved.content || {}),
              pets: (saved.content as { pets?: unknown })?.pets || toPetTags(targetPets),
            },
          } as PetMoment
        : null
      if (savedMoment) {
        setMomentEvents((prev) => [momentToTimelineEvent(savedMoment), ...prev])
      }
    } catch {
      Taro.showToast({ title: '保存失败，请重试', icon: 'none' })
    } finally {
      setIsMemorySubmitting(false)
    }
  }

  /** 点击时间线条目：统一点开详情弹窗（标题/日期/描述/大图）。
   * 【第 4b 波】时光线上只剩用户回忆与旧时光提醒两类卡片，所以不再需要
   * "系统生成的条目也给它一个详情"这个说法 —— 每一条都是可看、可删的真实内容。
   * 删除按钮仅对有 sourceId 的真实回忆显示（归属校验在 handleDeleteMoment 内），查看与删除权限分离。 */
  const handleEventClick = (event: TimelineEvent) => {
    setDetailEvent(event)
  }

  // 【已删除】handleDiaryShare（日记卡的「分享这篇日记」）：日记卡已经不在本页，
  // 这个按钮与它的埋点（share_diary）一并搬到了健康档案页的「打卡记录」分区。
  // 本页注册的 useShareAppMessage 仍然保留 —— 它是**页面级**的转发出口（右上角「…」→ 转发），
  // 与日记卡无关，删掉反而会让用户在本页没法分享（见上方 useShareAppMessage 的注释）。

  /** 预览大图：支持单张/多张轮播 */
  const handlePreviewPhotos = (urls: string[], current: string) => {
    if (!urls.length) return
    Taro.previewImage({ urls, current })
  }

  /** 删除回忆：确认后调接口，成功后从本地列表移除 */
  const handleDeleteMoment = async () => {
    if (!detailEvent?.sourceId) return
    const confirm = await new Promise<boolean>((resolve) => {
      Taro.showModal({
        title: '删除这条回忆？',
        content: '删除后不可恢复',
        confirmText: '删除',
        confirmColor: '#FF4D4F',
        success: (r) => resolve(!!r.confirm),
        fail: () => resolve(false),
      })
    })
    if (!confirm) return

    try {
      await timelineService.deleteMoment(detailEvent.sourceId)
      // 本地移除，保持界面即时响应
      setMomentEvents((prev) => prev.filter((e) => e.sourceId !== detailEvent.sourceId))
      setDetailEvent(null)
      Taro.showToast({ title: '已删除', icon: 'success' })
    } catch {
      Taro.showToast({ title: '删除失败，请重试', icon: 'none' })
    }
  }

  const handleFlashbackAction = () => {
    if (flashback && !flashbackAdded) {
      setFlashbackAdded(true)
      setShowBanner(false)
      Taro.showToast({ title: `已添加到时光线`, icon: 'success' })
    }
  }

  /**
   * 【2026-09-11 已撤掉「相伴天数」】
   *
   * 原来这一格显示"最早建档那只至今"的天数（副行 N 只毛孩子）。用户看完直接否掉：
   *   "把相伴天数删掉 换成其他的"。
   * 原因也站得住：它算的是**建档口径**（老用户往往先养了几年才建档），
   * 却被读成"陪了它多少天"——一个数字同时暗示两种含义，怎么标注都会有人误读。
   * 现在这一格换成**不带歧义的纯计数**：毛孩子 N 只（见下方速览区）。
   * 注意：`pets` 仍是"增删宠物后要不要重新加载"的判据（petsKey），别因为撤掉数字就删它。
   */

  /**
   * 速览第三格「珍藏照片」：时光线上累计的照片张数
   *
   * 【口径】= timelineEvents 里所有卡片的 photos 张数之和（只可能来自用户回忆，
   * 旧时光提醒固定 photos: []）—— 用户真实拍下/上传的照片，不含任何占位图。
   * 【第 4b 波】改前它也是这么数的（日记条目没有 photos 字段），所以这次口径没变、数字不会跳。
   */
  const photoCount = useMemo(
    () => timelineEvents.reduce((sum, e) => sum + e.photos.length, 0),
    [timelineEvents],
  )

  // todayStr（今天，本地日历日）在数据区就已经取好了：卡面的「今天」、分组、成就与速览数字
  // 都吃它，取法不变（渲染期取一次、不挂计时器）。

  return (
    <View className={`timeline-page ${themeClass}`}>
      {/* 全屏动态背景光斑层 */}
      <PageBackground />

      {/* 宠物切换条已移除（2026-09-11 共用回忆录改造）：
          用户要求"所有宠物共用一个回忆录"，顶部那条"可乐/布丁/…"的切换条就是他说的"分类"。 */}

      {/* ===== 固定顶部条（v2 屏 02 的 topbar）=====
          结构与原型一致：左「时光 + N 天的记录」，右一枚爪印圆钮进宠物档案。
          【为什么这里是固定层而不是跟着滚动】原型是整页滚动，但本页有自定义 tabBar 的
          底部让位契约（根容器写死 `height: calc(100vh - 160rpx - 安全区)` + 内部 ScrollView），
          把页头也塞进滚动区就得重做那套让位（任务书明确要求别破坏它）。
          固定条只有 104rpx 高，不会重演"顶部信息栏太大"那次的投诉。
          【不再放 PageHero】原来固定在顶部的是 <PageHero>（156rpx 插画卡），
          现在它挪进了滚动区当品牌横幅 —— v2 的品牌插画本来就在「记一条」上面、
          不占固定层；两条标题叠一起正是用户当初说"冲突了"的那个问题。 */}
      <View className='timeline-topbar'>
        <View className='timeline-topbar-head'>
          <Text className='timeline-topbar-brand'>时光</Text>
          {/* 副标题只在真有记录时渲染：没记录时显示「0 天的记录」是丧气文案，原型也没有 */}
          {recordDaysLabel ? <Text className='timeline-topbar-sub'>{recordDaysLabel}</Text> : null}
        </View>
        <View className='timeline-topbar-btn' onClick={handleOpenPetProfile}>
          <Icon name='paw-print' size={19} tone='primary' />
        </View>
      </View>

      {/* ===== 可滚动区域：品牌横幅 + 记一条 + 时光速览 + 旧时光横幅 + 时光线 + 成就 ===== */}
      <ScrollView className='timeline-scroll' scrollY>
        {/* 品牌横幅：文案沿用原型（每一条记录，都是它来过人间的证据 / 按月份自动整理，可一键成片）。
            仍然用 <PageHero> 而不是原型那种"整图 + 底部文案条"：本页插画是 1254×1254 方图，
            铺成整宽横幅要吃掉约 750rpx 高（口径：本页横幅槽位是**通栏** —— `.timeline-scroll`
            只有 padding-top、没有左右内边距，<PageHero> 自身也没有横向 margin，故宽 = 750rpx；
            方图 1:1，高度≈宽度。原先写的 694 是"750 − 28×2"那套旧内边距口径的残留），
            而且实测中段横裁会切掉猫耳与狗头顶（look.cjs 结论），
            方图 aspectFit 又会留大片奶油边。PageHero 正是为这批方图设计的（左图右文、不裁切）。 */}
        <PageHero
          illustration='page-timeline'
          title='每一条记录，都是它来过人间的证据'
          subtitle='按月份自动整理，可一键成片'
        />

        {/* ===== 「记一条」写入口（v2 屏 02 的那条橙色渐变主 CTA）=====
            IA 定的唯一写入口：时光页只留「记一条」，记录类动作不放这儿。
            原实现把写入口塞在**滚动区最底部**（.timeline-add-main-btn），首屏根本看不见 ——
            这正是本波任务书说的"5 块里 2 缺"之一。
            点击开的是本页既有的「新增回忆」弹窗（日期补记 + 多图 + AI 辅助），
            不是新造的第二套记录流程。 */}
        <View className='timeline-cta' onClick={handleAddMemory}>
          <View className='timeline-cta-icon-wrap'>
            <Text className='timeline-cta-icon'>✍️</Text>
          </View>
          <View className='timeline-cta-body'>
            <Text className='timeline-cta-title'>记一条</Text>
            <Text className='timeline-cta-desc'>添加时光记录 · 随手写一句、配张照片，团团会自动归档</Text>
          </View>
          <View className='timeline-cta-go'>
            <Text className='timeline-cta-go-text'>开始</Text>
          </View>
        </View>

        {/* 时光速览：用真实数据撑起页面（原「回忆精选」撤掉后留下的空间，
            换成对用户有信息量的数字，而不是拿装饰硬填） */}
        <View className='timeline-overview'>
          {/* 第一格：毛孩子 N 只（2026-09-11 替换掉原「相伴天数」）
              用户原话："把相伴天数删掉 换成其他的" —— 那个数字是建档口径却容易被读成"陪了它多久"，
              换成不带歧义的纯计数；也与本页"所有宠物共用一本回忆录"的定位对得上（家有几只，一眼可见）。 */}
          {pets.length > 0 && (
            <>
              <View className='timeline-overview-item'>
                <Icon name='paw-print' size={18} tone='primary' />
                <Text className='timeline-overview-value'>{pets.length}</Text>
                <Text className='timeline-overview-label'>毛孩子</Text>
              </View>
              <View className='timeline-overview-divider' />
            </>
          )}
          {/* 第二格：时光记录（第 4b 波口径 = recordCount）。
              数的是时光线上**实际渲染的卡片数**（用户回忆 + 已加入的旧时光提醒），
              直接从渲染用的分组里现数：屏幕上有几张卡，这里就是几 —— 数字与列表永远一致。
              改前它数的是「事件数」（照片回忆 + 打卡里程碑），日记还在时又漏掉日记那一半，
              两次都对不上屏幕；现在只有这一种口径，也不再有心情筛选能让它变小。 */}
          <View className='timeline-overview-item'>
            <Icon name='note-pencil' size={18} tone='primary' />
            <Text className='timeline-overview-value'>{recordCount}</Text>
            <Text className='timeline-overview-label'>时光记录</Text>
          </View>
          <View className='timeline-overview-divider' />
          <View className='timeline-overview-item'>
            <Icon name='image' size={18} tone='primary' />
            <Text className='timeline-overview-value'>{photoCount}</Text>
            <Text className='timeline-overview-label'>珍藏照片</Text>
          </View>
          {/* 第四格：打卡天数（2026-09-12 v2 屏 02 新增；第 4b 波保留并核对口径）。
              【为什么时光页还留一个打卡数字】它是**打卡口径**的数字，标签写得清清楚楚，
              与健康档案页「打卡记录」同源（同一次 getCheckins）；本页的速览与成就区一直
              承担"顺带看一眼坚持情况"的职责（成就第一格就是连续打卡）。
              用户抗议的是"没标签的打卡内容被当成我记的回忆"，不是这个带标签的计数。
              只在真的有打卡时渲染 —— 0 天时多一格"0 打卡天数"只是噪音。 */}
          {timelineSummary.checkinDays > 0 && (
            <>
              <View className='timeline-overview-divider' />
              <View className='timeline-overview-item'>
                <Icon name='checkin' size={18} tone='primary' />
                <Text className='timeline-overview-value'>{timelineSummary.checkinDays}</Text>
                <Text className='timeline-overview-label'>打卡天数</Text>
              </View>
            </>
          )}
        </View>

        {showBanner && (
          <View className='timeline-banner'>
            <View className={`timeline-banner-inner ${flashback ? 'timeline-banner-inner--flashback' : ''}`}>
              <View className='timeline-banner-glow' />
              <View className='timeline-banner-content'>
                <Text className='timeline-banner-icon'>
                  {flashback ? flashback.emoji : '💫'}
                </Text>
                <View className='timeline-banner-text-wrap'>
                  <Text className='timeline-banner-title'>
                    {flashback ? flashback.title : '旧时光提醒'}
                  </Text>
                  <Text className='timeline-banner-desc'>
                    {flashback
                      ? flashback.description
                      : '坚持打卡，把每一天留在时光里'
                    }
                  </Text>
                </View>
                {flashback && (
                  <View className='timeline-banner-action' onClick={handleFlashbackAction}>
                    <Text className='timeline-banner-action-text'>添加到时光线</Text>
                  </View>
                )}
              </View>
              <View className='timeline-banner-close' onClick={() => setShowBanner(false)}>
                <Text>✕</Text>
              </View>
            </View>
          </View>
        )}

        {/* ===== 时光线（第 4b 波：只剩「用户自己记的回忆」这一类卡片）===== */}
        <View className='timeline-list'>
          {/* 【已删除】心情筛选行（.timeline-feed-filter）：它筛的是 diaryEngine 给每篇日记算出的
              心情档位，日记卡离开本页后这里没有任何东西可筛 —— 该行与它的横滑容器样式一并清除，
              「按心情筛」的能力跟着日记搬到健康档案页「打卡记录」分区（在那里筛的是打卡记录）。
              同一条支线上的次级空态（.timeline-diary-empty「该心情下暂无日记」）同理删除。 */}

          {/* 按月分组（v2 屏 02）：月份小标题「● 2026 年 9 月 ——— 3 条」+ 该月卡片。
              分组吃的是 monthGroups（= 时光线上实际要渲染的全部卡片），与速览的「时光记录」
              同源，所以「标题写 N 条」和「组里真有 N 张卡」永远对得上。
              ⚠️ 空态挂在「一张卡都没有」上：改前这里判的是分组数组长度，而分组数恒大于等于 0 这件事
              很容易被后来人加工成「永远有值」，所以本波直接判 monthGroups 为空即空态。 */}
          {monthGroups.length > 0 ? (
            <View className='timeline-feed'>
              {monthGroups.map((group) => (
                <View key={group.key} className='timeline-month'>
                  <View className='timeline-month-head'>
                    <View className='timeline-month-dot' />
                    <Text className='timeline-month-title'>{group.label}</Text>
                    <Text className='timeline-month-count'>{group.count} 条</Text>
                  </View>
                  {group.items.map((event, index) => (
                    /* —— 用户回忆 / 旧时光提醒（两类都是「用户自己记的」）—— */
                    <View key={event.id} className='timeline-item' onClick={() => handleEventClick(event)}>
                      <View className='timeline-line-col'>
                        <View className={`timeline-dot timeline-dot--${event.type}`}>
                          <Text className='timeline-dot-emoji'>{event.emoji}</Text>
                        </View>
                        {index < group.items.length - 1 && (
                          <View className='timeline-line' />
                        )}
                      </View>
                      <View className={`timeline-card timeline-card--${event.type}`}>
                        <View className='timeline-card-date'>
                          {/* 卡面日期改成「今天」/「9 月 11 日」：原来是 2026-09-11 这种 ISO 串，
                              一列看下来既是噪音、年份也和月份标题重复（原型写法见 02-timeline.png） */}
                          <Text className='timeline-date-text'>{formatCardDate(event.date, todayStr)}</Text>
                          {/* 宠物标签：共用回忆录里每张卡都要能看出这是谁的回忆。
                              多宠共同回忆（content.pets 有 2 只以上）→ 渲染多枚标签；
                              单宠回忆 → 用单值 petName；旧数据缺名字时不渲染。
                              旧时光提醒没有归属字段（横幅文案里已含宠物名），自然不渲染标签。 */}
                          {(event.petTags?.length ? event.petTags : (event.petName ? [{ id: event.petId || 'p', name: event.petName, emoji: event.petEmoji || '🐾' }] : []))
                            .map((tag) => (
                              <View key={tag.id} className='timeline-pet-tag'>
                                <Text className='timeline-pet-tag-text'>{tag.emoji || '🐾'} {tag.name}</Text>
                              </View>
                            ))}
                          {event.type === 'memory' && (
                            <View className='timeline-memory-badge'>
                              <Text className='timeline-memory-badge-text'>回忆</Text>
                            </View>
                          )}
                          {event.type === 'flashback' && (
                            <View className='timeline-flashback-badge'>
                              <Text className='timeline-flashback-badge-text'>旧时光</Text>
                            </View>
                          )}
                        </View>
                        <Text className='timeline-card-title'>{event.title}</Text>
                        <Text className='timeline-card-desc'>{event.description}</Text>
                        {event.photos.length > 0 ? (
                          <View className='timeline-photo-grid'>
                            {event.photos.map((photo, pi) => (
                              // 真实照片展示（原实现只有占位符，无法看到照片内容）
                              <Image
                                key={pi}
                                className='timeline-photo-img'
                                src={resolveAvatarUrl(photo)}
                                mode='aspectFill'
                                onClick={() => handlePreviewPhotos(event.photos.map(resolveAvatarUrl), resolveAvatarUrl(photo))}
                              />
                            ))}
                          </View>
                        ) : (
                          // 原先是「+ 添加照片」的虚线按钮样式，但整张卡片点击只会打开详情、
                          // 并不支持给这条记录补照片 —— 是个点不出预期结果的假按钮。
                          // 改成不带按钮感的纯提示，不再误导用户去点。
                          <View className='timeline-photo-empty'>
                            <Icon name='camera' size={14} tone='muted' />
                            <Text className='timeline-photo-empty-text'>这条记录还没有照片</Text>
                          </View>
                        )}
                      </View>
                    </View>
                  ))}
                </View>
              ))}
            </View>
          ) : (
            /* 真实空态（第 4b 波明确要求：没记过任何回忆时给空态 + 指向「记一条」的引导）。
               · 它只可能在「本账号一条回忆都没有、且没把旧时光提醒加进线里」时出现；
               · 给的是**可点的行动**（actionText/onAction → 打开既有的「新增回忆」弹窗，
                 与页头那条「记一条」CTA 是同一个 handler），而不是一句「0 条记录」了事；
               · 文案里没有任何假数据，也没有「即将上线」之类的糊弄话。 */
            <EmptyState
              illustration='empty-timeline'
              title='还没有时光记录'
              desc='这里只放你自己记下的回忆：一句话、一张照片都算'
              actionText='记第一条回忆'
              onAction={handleAddMemory}
            />
          )}
        </View>

        {/* ===== 成就（v2 屏 02：原「成就墙」独立页在本页降级成一个展示分区）=====
            两块都吃真实数据，没有任何一处是编的：
              · 第一格 = 连续打卡成就进度，档位（7/30/100 天）取自 constants 的 ACHIEVEMENT_TYPES；
                它的图标位按 v2 屏 02 用**品牌插画** empty-achievement（原型 L800 的 ipCard('achievement')，
                随四季主题换图），档位 emoji 压在图下当加载失败时的兜底；
              · 第二格 = 本月新增照片与本月新增记录（第 4b 波起只数**用户回忆**，见下）。
            【为什么不做成「成就列表」】achievementService 那套是**每日弹层的一次性触发**
            （checkAllAchievements 返回「今天该弹哪个」，还有本地去重），它没有「已解锁成就清单」
            这个概念 —— 拿它渲染列表只会得到空。所以这里只渲染能从数据算出来的进度。
            2026-09-12 收口批次：原「成就墙」独立页（pagesPet/achievement）已下线，
            该页曾用「累计打卡次数」而非「连续天数」，且读的是只读本地缓存的 getCheckinStats；
            本分区沿用联网拉到的真实打卡数组算 streak，口径更强，故不回头搬那套累计口径。
            【2026-09-12 第 4 波改口径】第二格的「本月新增 N 条记录」不再把打卡里程碑算进去。
            【第 4b 波再改一次】它也**不再把日记算进去**（日记已整批搬去健康档案页）：
            现在数的是本月的用户回忆（按日期去重）+ 这些回忆里的真实照片张数，
            口径与屏幕上那条时光线一致 —— 屏幕上看不见的东西不参与计数。
            注意第二格只有当月数据为 0 时不渲染，避免「本月新增 0 张」这种丧气格子。 */}
        <View className='timeline-achv'>
          <View className='timeline-sec-head'>
            <View className='timeline-sec-dot' />
            <Text className='timeline-sec-title'>成就</Text>
          </View>
          <View className='timeline-achv-grid'>
            <View className='timeline-achv-tile'>
              <View className='timeline-achv-icon'>
                {/* 图标位按 v2 屏 02 换成**品牌插画**：key empty-achievement 在
                    data/illustrations.ts 的 SEASONAL_SLOT 里映射到 achievement-<季>-card.jpg
                    （四季图，服务器实测四张全 HEAD 200、1254x1254，与本页品牌横幅同一批资产）。
                    emoji 保留在底下当**降级兜底**：插画是网络图且 <Illustration> 加载失败时
                    整块返回 null，那时露出这枚档位 emoji，图标底不会变成一个空色块。 <Illustration>
                    在 scss 里是绝对定位，正常加载时一定盖住 emoji。 */}
                <Illustration
                  name='empty-achievement'
                  fill
                  mode='aspectFill'
                  className='timeline-achv-icon-illus'
                />
                <Text className='timeline-achv-icon-text'>{streakItem.icon}</Text>
              </View>
              <View className='timeline-achv-body'>
                <Text className='timeline-achv-title'>{streakItem.title}</Text>
                <Text className='timeline-achv-sub'>
                  {timelineSummary.streak >= streakItem.days
                    ? `${streakItem.days} 天已达成`
                    : `已连续 ${timelineSummary.streak} 天 · 还差 ${streakItem.days - timelineSummary.streak} 天`}
                </Text>
              </View>
            </View>
            {timelineSummary.monthPhotos > 0 || timelineSummary.monthMemoryDays > 0 ? (
              <View className='timeline-achv-tile'>
                <View className='timeline-achv-icon timeline-achv-icon--alt'>
                  <Text className='timeline-achv-icon-text'>📸</Text>
                </View>
                <View className='timeline-achv-body'>
                  {/* 两行必须说的是**同一件事**：先照片、没有照片就说记录条数。
                      ⚠️ 首版这里写死成「N 张照片」+「本月新增 N 条记录」，
                      真机取图时抓到了这个缺陷：用户本月只写了文字、没传照片时，
                      卡片会变成「0 张照片 / 本月新增 1 条记录」—— 主标题是个 0，看着像坏掉了。
                      所以条件渲染里主标题改成「有照片说照片、没照片说记录」。
                      【2026-09-12 第 4b 波】两个数字都改吃**用户回忆**（timelineSummary 的
                      monthPhotos / monthMemoryDays）：日记已经不是本页的内容，
                      再把它算进「本月新增」就是拿屏幕上看不见的东西充数。 */}
                  <Text className='timeline-achv-title'>
                    {timelineSummary.monthPhotos > 0
                      ? `${timelineSummary.monthPhotos} 张照片`
                      : `${timelineSummary.monthMemoryDays} 条记录`}
                  </Text>
                  <Text className='timeline-achv-sub'>
                    {timelineSummary.monthPhotos > 0
                      ? `本月新增 ${timelineSummary.monthMemoryDays} 条记录`
                      : '本月新增'}
                  </Text>
                </View>
              </View>
            ) : null}
          </View>
        </View>

        {/* 底部让位：滚动区自身高度只减掉了自定义 tabBar 的 160rpx（见 .timeline-page 的
            height 计算），这条 40rpx 是最后一张卡与底栏之间的呼吸位。
            原来这里还有一个「+ 添加时光记录」通栏按钮 —— 写入口已按 v2 提到页头下方
            （.timeline-cta），同页再放第二个写入口只会让用户以为有两个不同的功能。 */}
        <View className='timeline-bottom-safe' />
      </ScrollView>

      {/* ===== 新增回忆弹窗（日期补记 + 多图 + AI 辅助） ===== */}
      {showAddMemoryModal && (
        <View className='timeline-review-overlay' onClick={() => setShowAddMemoryModal(false)}>
          <View className='timeline-add-memory-modal' onClick={(e: { stopPropagation: () => void }) => e.stopPropagation()}>
            <View className='timeline-review-header'>
              <Text className='timeline-review-header-title'>新增回忆 ✦</Text>
              <View className='timeline-review-header-close' onClick={() => setShowAddMemoryModal(false)}>
                <Text>✕</Text>
              </View>
            </View>
            <View className='timeline-add-memory-body'>
              {/* 归属宠物（**多选**，2026-09-11）：共用回忆录里"这条回忆是谁的"由这里决定。
                  · 默认当前宠物；正文里提到某只宠物名时，提交时会自动把默认值换成那只（用户可改）
                  · 可多选（"两只一起晒太阳"这种共同回忆不必拆两条）
                  · 多宠家庭才渲染这一行；只有一只宠物时少一行噪音 */}
              {pets.length > 1 && (
                <View className='timeline-add-memory-pet-row'>
                  <View className='timeline-add-memory-pet-head'>
                    <Text className='timeline-add-memory-date-label'>🐾 记给谁</Text>
                    <Text className='timeline-add-memory-pet-hint'>可多选</Text>
                  </View>
                  <ScrollView className='timeline-add-memory-pet-scroll' scrollX showScrollbar={false}>
                    <View className='timeline-add-memory-pet-list'>
                      {pets.map((pet) => (
                        <View
                          key={pet.id}
                          className={`timeline-pet-chip ${memoryPetIds.includes(pet.id) ? 'timeline-pet-chip--active' : ''}`}
                          onClick={() => {
                            setMemoryPetIds((prev) => {
                              // 已选中：取消它（但至少保留一只 —— 全不选没法落库）
                              if (prev.includes(pet.id)) {
                                // 只有一只时是静默无操作 —— 此时**不置位** touched，
                                // 否则"首次点击=替换"的机会会被这一次无效点击悄悄消费掉（审查 P3）
                                if (prev.length <= 1) return prev
                                petSelectionTouchedRef.current = true
                                return prev.filter((id) => id !== pet.id)
                              }
                              /**
                               * 未选中的两种情况：
                               * · **第一次**手动点选且当前只有一只（那只是默认/自动识别的）→ **替换**它。
                               *   这样"记给另一只"仍然是一次点击，与改前的单选手感一致；
                               * · 其余情况 → 追加（多宠共同回忆）。
                               */
                              const wasTouched = petSelectionTouchedRef.current
                              petSelectionTouchedRef.current = true
                              if (!wasTouched && prev.length === 1) return [pet.id]
                              return [...prev, pet.id]
                            })
                          }}
                        >
                          <Text className='timeline-pet-chip-emoji'>
                            {pet.species === 'cat' ? '🐱' : pet.species === 'dog' ? '🐕' : '🐾'}
                          </Text>
                          <Text className='timeline-pet-chip-text'>{pet.name}</Text>
                        </View>
                      ))}
                    </View>
                  </ScrollView>
                </View>
              )}

              {/* 补记日期：默认今天，可手动选择过去任意一天 */}
              <View className='timeline-add-memory-date-row'>
                <Text className='timeline-add-memory-date-label'>📅 回忆日期</Text>
                <Picker mode='date' value={memoryDate} end={getLocalDateString()} onChange={(e) => setMemoryDate(e.detail.value)}>
                  <View className='timeline-add-memory-date-value'>
                    <Text>{memoryDate}</Text>
                    <Text className='timeline-add-memory-date-arrow'>▾</Text>
                  </View>
                </Picker>
              </View>

              <Textarea
                className='timeline-add-memory-textarea'
                placeholder='写下这个值得记住的瞬间...'
                value={memoryText}
                onInput={(e: { detail: { value: string } }) => {
                  const next = e.detail.value
                  setMemoryText(next)
                  // 正文里提到谁就自动把"记给谁"切到谁（用户手动改过之后不再覆盖，避免抢用户的选择）
                  applyAutoPetSelection(next)
                }}
                maxlength={500}
                autoHeight
              />

              {/* AI 辅助：生成描述 / 润色文案 */}
              <View className='timeline-add-memory-ai-row'>
                <View
                  className={`timeline-ai-btn ${isAiDescribeLoading || !memoryPhotoPaths.length ? 'timeline-ai-btn--disabled' : ''}`}
                  onClick={memoryPhotoPaths.length && !isAiDescribeLoading ? handleAiDescribe : undefined}
                >
                  <Text className='timeline-ai-btn-text'>{isAiDescribeLoading ? '✨ 生成中...' : '✨ AI 写描述'}</Text>
                </View>
                <View
                  className={`timeline-ai-btn ${isAiPolishLoading || !memoryText.trim() ? 'timeline-ai-btn--disabled' : ''}`}
                  onClick={memoryText.trim() && !isAiPolishLoading ? handleAiPolish : undefined}
                >
                  <Text className='timeline-ai-btn-text'>{isAiPolishLoading ? '✨ 润色中...' : '✨ AI 润色'}</Text>
                </View>
              </View>

              {/* 多图上传：九宫格预览，可删除单张 */}
              <View className='timeline-add-memory-photo-grid'>
                {memoryPhotoPaths.map((photoPath, pi) => (
                  <View key={pi} className='timeline-add-memory-photo-item'>
                    <Image className='timeline-add-memory-photo-img' src={photoPath} mode='aspectFill' />
                    <View className='timeline-add-memory-photo-remove' onClick={() => handleRemoveMemoryPhoto(pi)}>
                      <Text>✕</Text>
                    </View>
                  </View>
                ))}
                {memoryPhotoPaths.length < 9 && (
                  <View className='timeline-add-memory-photo-add' onClick={handleAddMemoryPhoto}>
                    <Icon name='camera' size={18} tone='primary' className='timeline-add-memory-photo-icon' />
                    <Text className='timeline-add-memory-photo-label'>{memoryPhotoPaths.length ? '继续添加' : '拍照/上传照片'}</Text>
                  </View>
                )}
              </View>
              <Text className='timeline-add-memory-photo-tip'>最多 9 张 · AI 描述基于第一张照片</Text>
            </View>
            <View className='timeline-review-actions'>
              <View
                className={`timeline-review-btn timeline-review-btn--primary ${isMemorySubmitting ? 'timeline-review-btn--disabled' : ''}`}
                onClick={isMemorySubmitting ? undefined : handleAddMemorySubmit}
              >
                <Text className='timeline-review-btn-text'>
                  {isMemorySubmitting ? '保存中...' : '💾 保存回忆'}
                </Text>
              </View>
              <View className='timeline-review-btn timeline-review-btn--outline' onClick={() => setShowAddMemoryModal(false)}>
                <Text className='timeline-review-btn-text'>取消</Text>
              </View>
            </View>
          </View>
        </View>
      )}

      {/* ===== 回忆详情弹窗（大图 + 完整文案 + 删除） ===== */}
      {detailEvent && (
        <View className='timeline-review-overlay' onClick={() => setDetailEvent(null)}>
          <View className='timeline-detail-modal' onClick={(e: { stopPropagation: () => void }) => e.stopPropagation()}>
            <View className='timeline-review-header'>
              <Text className='timeline-review-header-title'>{detailEvent.emoji} {detailEvent.title}</Text>
              <View className='timeline-review-header-close' onClick={() => setDetailEvent(null)}>
                <Text>✕</Text>
              </View>
            </View>
            <View className='timeline-detail-body'>
              <Text className='timeline-detail-date'>📅 {detailEvent.date}</Text>
              {detailEvent.photos.length > 0 ? (
                <ScrollView className='timeline-detail-photos' scrollX showScrollbar={false}>
                  <View className='timeline-detail-photos-row'>
                    {detailEvent.photos.map((photo, pi) => (
                      <Image
                        key={pi}
                        className='timeline-detail-photo'
                        src={resolveAvatarUrl(photo)}
                        mode='aspectFill'
                        onClick={() => handlePreviewPhotos(detailEvent.photos.map(resolveAvatarUrl), resolveAvatarUrl(photo))}
                      />
                    ))}
                  </View>
                </ScrollView>
              ) : null}
              <Text className='timeline-detail-desc'>{detailEvent.description || '这是一条没有文字说明的回忆。'}</Text>
            </View>
            {detailEvent.sourceId && (
              <View className='timeline-review-actions'>
                <View className='timeline-review-btn timeline-review-btn--danger' onClick={handleDeleteMoment}>
                  <Text className='timeline-review-btn-text'>🗑 删除这条回忆</Text>
                </View>
                <View className='timeline-review-btn timeline-review-btn--outline' onClick={() => setDetailEvent(null)}>
                  <Text className='timeline-review-btn-text'>关闭</Text>
                </View>
              </View>
            )}
          </View>
        </View>
      )}
    </View>
  )
}
