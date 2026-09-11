/**
 * 品牌插画注册表
 *
 * 【为什么走服务器】24 张插画合计 1.6MB，而主包已 1.82MB / 2MB（微信上限），
 * 根本塞不进去；且空态分散在 pagesPet / pagesUser / pagesMemoir / 主包四个包里，
 * 靠分包也覆盖不了。因此与 20 张宠物预选头像采用同一套机制：
 * 图片放服务器 uploads/illustrations/ 静态托管，前端按 key 拼 URL。
 * （坑：/uploads 的 CORP 头此前给过 same-origin，会拦掉跨域 <img>，
 *   已由服务端 uploadsResourcePolicy 中间件修成 cross-origin，24 张已逐张验过 200。）
 *
 * 【风格】3D 黏土毛绒（羊毛毡）质感，同角色（橘虎斑猫 + 奶油卷毛狗）、同配色。
 * 角色一致性靠「把品牌 IP 当参考图喂 Seedream + 逐字重复角色锚点」双保险实现，
 * 生成器见 02-UI设计/插画系统/gen-illustrations.mjs。
 *
 * 【品牌 IP 为什么不在这个表里】logo-catdog-01.png 用在加载 logo / 首页 Hero /
 * 登录页徽章，是关键路径资产，依赖网络会在弱网白屏，因此留在本地包（仅 46KB）。
 */
import { resolveAvatarUrl } from '../services/api'

/** 服务端静态目录（相对路径，由 resolveAvatarUrl 拼上 API_BASE_URL） */
const ILLUSTRATION_DIR = '/uploads/illustrations'

/** 空态插画（600×600，角色居中、四周留白） */
export type EmptyIllustration =
  | 'empty-timeline' // 时光线为空
  | 'empty-checkin' // 还没打卡
  | 'empty-pet' // 还没添加宠物
  | 'empty-search' // 搜索无结果
  | 'empty-photo' // 还没有照片
  | 'empty-chart' // 暂无健康数据
  | 'empty-vaccine' // 还没有疫苗记录
  | 'empty-family' // 还差一位家人
  | 'empty-achievement' // 还没有成就
  | 'empty-message' // 暂无对话

/** 功能头图（960×540，16:9，主体偏左、右侧留标题位） */
export type HeaderIllustration =
  | 'header-memoir' // 回忆录馆
  | 'header-avatar-studio' // 形象工坊
  | 'header-health' // 健康报告
  | 'header-family-photo' // 全家福
  | 'header-naming' // AI 取名

/** 激励时刻（600×600，主体偏下、上方留文字位） */
export type MomentIllustration =
  | 'moment-streak-7' // 连续 7 天
  | 'moment-streak-30' // 连续 30 天
  | 'moment-birthday' // 生日快乐
  | 'moment-anniversary' // 周年纪念
  | 'moment-achievement' // 成就解锁
  | 'moment-first-checkin' // 首次打卡

/** 页面头图（16:9，主体偏左、右侧留白；用于页面顶部「插画 + 标题」）
 *
 *  为什么专门有这一类：空态插画只有「没有数据」的用户才看得到，
 *  老用户有数据时永远触发不到 —— 页面要让人感觉到变好了，必须改**始终可见**的区域。
 */
export type PageHeaderIllustration =
  | 'page-pet-profile' // 宠物档案：猫狗共看档案册
  | 'page-mine' // 我的：猫狗抬头看主人
  | 'page-family' // 家庭：猫狗坐在小屋前
  | 'page-home' // 今天：猫狗在温馨的家里等主人
  | 'page-creative' // 创作：猫狗一起画画
  | 'page-timeline' // 时光：猫狗走在摆满相框的小路上

/** 分享卡背景（主体缩小靠边、中心留空放内容） */
export type ShareIllustration =
  | 'share-card-warm' // 暖色横版
  | 'share-card-starry' // 星空竖版
  | 'share-card-soft' // 夕阳竖版

/** 功能入口插画（600×600，主体居中偏近景；创作页「今日 / 更多」六个入口专用）
 *
 *  为什么单独开一类：这批是**功能入口的说明图**，既不是空态、也不是页面头图。
 *  构图刻意比空态那批更"近"（猫狗合计占画面约三分之二）——
 *  卡片里只展示约 106pt，沿用空态那种"四周大片留白"会被缩得看不清主体。
 */
export type GridIllustration =
  | 'grid-checkin' // 健康打卡：一起看打卡板
  | 'grid-agent' // AI 管家：凑近小音箱
  | 'grid-lineage' // 家庭图谱：头顶一圈相连的小相框
  | 'grid-weekly' // 周报：一起看周报板
  | 'grid-vaccine' // 疫苗日历：一起看小台历
  | 'grid-report' // 健康报告：一起看报告单

export type IllustrationName =
  | EmptyIllustration
  | HeaderIllustration
  | PageHeaderIllustration
  | MomentIllustration
  | ShareIllustration
  | GridIllustration

/** 全部合法 key（供测试断言与遍历用） */
export const ILLUSTRATION_NAMES: IllustrationName[] = [
  'empty-timeline',
  'empty-checkin',
  'empty-pet',
  'empty-search',
  'empty-photo',
  'empty-chart',
  'empty-vaccine',
  'empty-family',
  'empty-achievement',
  'empty-message',
  'header-memoir',
  'header-avatar-studio',
  'header-health',
  'header-family-photo',
  'header-naming',
  'page-pet-profile',
  'page-mine',
  'page-family',
  'page-home',
  'page-creative',
  'page-timeline',
  'moment-streak-7',
  'moment-streak-30',
  'moment-birthday',
  'moment-anniversary',
  'moment-achievement',
  'moment-first-checkin',
  'share-card-warm',
  'share-card-starry',
  'share-card-soft',
  'grid-checkin',
  'grid-agent',
  'grid-lineage',
  'grid-weekly',
  'grid-vaccine',
  'grid-report',
]

/**
 * 取插画完整 URL
 * @param name 插画 key
 * @returns 如 https://api.xinghuanhai.com/uploads/illustrations/empty-timeline.jpg
 */
export function illustrationUrl(name: IllustrationName): string {
  return resolveAvatarUrl(`${ILLUSTRATION_DIR}/${name}.jpg`)
}
