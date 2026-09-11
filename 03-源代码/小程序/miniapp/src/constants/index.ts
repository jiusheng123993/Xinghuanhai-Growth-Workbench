/**
 * 应用全局常量
 * 包含版本号、客服热线、NPS 配置、头像样式、成就类型等核心常量
 */
export const APP_VERSION = '1.0.0';
export const HOTLINE_NUMBER = '400-161-9995';
export const INVITE_CODE_LENGTH = 6;
export const INVITE_CODE_MAX_USE = 50;
export const NPS_MIN_SCORE = 0;
export const NPS_MAX_SCORE = 10;
export const NPS_COOLDOWN_DAYS = 30;
export const NPS_DAY7_TRIGGER = 7;
export const NPS_DAY30_TRIGGER = 30;
export const SHARE_REWARD_INVITES = 3;
/** 邀请达标后发放的会员天数（须与后端 server/src/routes/invites.ts 的 REWARD_DAYS 一致，改一处要同步另一处） */
export const SHARE_REWARD_DAYS = 7;

export const AVATAR_STYLES = {
  q_cute: { label: 'Q萌风', key: 'q_cute' as const },
  japanese_healing: { label: '日系治愈风', key: 'japanese_healing' as const },
  american_cartoon: { label: '美式卡通风', key: 'american_cartoon' as const },
} as const;

export const AVATAR_FREE_GENERATIONS = 1;
export const AVATAR_MEMBER_GENERATIONS = -1;

export const AVATAR_BASE_COLORS = [
  { label: '暖黄', value: '#FFD93D' },
  { label: '奶白', value: '#FFF8E7' },
  { label: '浅棕', value: '#D4A574' },
  { label: '深棕', value: '#8B6914' },
  { label: '灰色', value: '#B0B0B0' },
  { label: '黑色', value: '#333333' },
  { label: '橘色', value: '#FF8C42' },
  { label: '奶油', value: '#FFFDD0' },
] as const;

export const ACHIEVEMENT_TYPES = {
  birthday: { title: '生日快乐', subtitle: '毛孩子又长大一岁啦', icon: '🎂', color: '#FF6B9D' },
  vaccine_complete: { title: '疫苗卫士', subtitle: '全部疫苗接种完成', icon: '🛡️', color: '#52C41A' },
  streak_7: { title: '坚持一周', subtitle: '连续打卡7天', icon: '🔥', color: '#FF8C42' },
  streak_30: { title: '月度之星', subtitle: '连续打卡30天', icon: '⭐', color: '#FAAD14' },
  streak_100: { title: '百日守护', subtitle: '连续打卡100天', icon: '💎', color: '#722ED1' },
  rainbow_bridge: { title: '彩虹桥纪念', subtitle: '永远在心中', icon: '🌈', color: '#B37FEB' },
  holiday: { title: '节日快乐', subtitle: '和毛孩子一起过节', icon: '🎄', color: '#F5222D' },
} as const;

export const AVATAR_EXPRESSIONS = [
  { key: 'happy', label: '开心', emoji: '😊' },
  { key: 'sad', label: '难过', emoji: '😢' },
  { key: 'excited', label: '兴奋', emoji: '🤩' },
  { key: 'sleepy', label: '困倦', emoji: '😴' },
  { key: 'love', label: '爱心', emoji: '🥰' },
  { key: 'cool', label: '得意', emoji: '😎' },
  { key: 'angry', label: '生气', emoji: '😤' },
  { key: 'thinking', label: '思考', emoji: '🤔' },
  { key: 'surprised', label: '惊讶', emoji: '😱' },
  { key: 'crying', label: '哭泣', emoji: '😭' },
  { key: 'celebrate', label: '庆祝', emoji: '🥳' },
  { key: 'naughty', label: '调皮', emoji: '😜' },
] as const;

export const AVATAR_ACTIONS = [
  { key: 'sit', label: '坐着', emoji: '🧘' },
  { key: 'stand', label: '站着', emoji: '🧍' },
  { key: 'lie', label: '趴着', emoji: '🛌' },
  { key: 'jump', label: '跳跃', emoji: '🦘' },
  { key: 'wave', label: '招手', emoji: '🐾' },
  { key: 'eat', label: '吃东西', emoji: '🍖' },
  { key: 'play', label: '玩球', emoji: '🎾' },
  { key: 'sleep', label: '睡觉', emoji: '💤' },
] as const;

export const AVATAR_ANGLES = [
  { key: 'front', label: '正面' },
  { key: 'left', label: '左侧' },
  { key: 'right', label: '右侧' },
  { key: 'back', label: '背面' },
  { key: 'left45', label: '45°左' },
  { key: 'right45', label: '45°右' },
] as const;

export const AVATAR_ACTION_ANGLES = AVATAR_ANGLES.slice(0, 3);

export const AVATAR_PHOTO_FREE_COUNT = 1;
/** 会员每月"照片专属多风格头像"生成次数（3 风格照片生成共用） */
export const AVATAR_PHOTO_MEMBER_MONTHLY_LIMIT = 3;
export const AVATAR_3D_MONTHLY_LIMIT = 3;

export const STORAGE_KEYS = {
  AVATAR_2D_TASK_ID: 'xhh_avatar_2d_task_id',
  AVATAR_3D_TASK_ID: 'xhh_avatar_3d_task_id',
  AVATAR_PHOTO_COUNT: 'xhh_avatar_photo_count',
  AVATAR_3D_COUNT: 'xhh_avatar_3d_count',
  AVATAR_3D_COUNT_DATE: 'xhh_avatar_3d_count_date',
  // 微信头像昵称绑定引导：用户点过"暂不绑定"后记录，避免每次登录都打断
  WECHAT_BIND_SKIPPED: 'xhh_wechat_bind_skipped',
} as const;
