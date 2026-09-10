/**
 * 应用配置管理 - 集中管理所有环境变量和配置项
 * 从 .env 文件加载配置，提供统一的配置访问入口
 */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

/**
 * DeepSeek 官方入口（运行时唯一 AI 通道）
 *
 * 2026-09-10 用户决策：不再自动切换火山方舟入口，运行时一律走 DeepSeek 官方 API（AI_* 变量）。
 * 微信「深度合成-AI问答」类目的第三方合作协议按火山方舟签署存档，仅作为类目报备材料
 * （届时按平台要求提交），与实际调用入口解耦——即"报备材料走火山、运行时调用走官方"。
 * 如未来确需切回火山方舟，从 git 历史恢复 buildAiConfig 的 ARK 分支即可（本注释留档）。
 */
const DEEPSEEK_BASE_URL_DEFAULT = 'https://api.deepseek.com/v1';
const DEEPSEEK_MODEL_DEFAULT = 'deepseek-chat';

/**
 * 读取环境变量并去除首尾空白（避免纯空格 key 被当成有效配置）
 * @param key - 环境变量名
 * @returns trim 后的值（无则空串）
 */
function env(key: string): string {
  return (process.env[key] || '').trim();
}

/**
 * 构建 AI 连接配置（DeepSeek 官方整组语义）
 * 成组原则：baseUrl/model/apiKey 必须同源（AI_* 整组），缺项回落官方默认，
 * 绝不跨厂商混配；纯空格 key trim 后视为未配置，避免发出带空 key 的真实请求。
 * 注意：ARK_* 变量已不再参与运行时选择（即使误配也会被忽略，见顶部说明）。
 * @returns { apiKey, baseUrl, model } 三者语义一致
 */
function buildAiConfig(): { apiKey: string; baseUrl: string; model: string } {
  return {
    apiKey: env('AI_API_KEY'),
    baseUrl: env('AI_BASE_URL') || DEEPSEEK_BASE_URL_DEFAULT,
    model: env('AI_MODEL') || DEEPSEEK_MODEL_DEFAULT,
  };
}

/** 导出纯函数供单测覆盖 官方/全空/空格/误配 ARK 组合（不影响 config 构建行为） */
export { buildAiConfig };

/** 应用全局配置对象 */
export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  databaseUrl: process.env.DATABASE_URL || 'postgresql://postgres:password@localhost:5432/xinghechongji',
  jwtSecret: process.env.JWT_SECRET || '',
  /** 知识图谱审核后台管理员令牌（Phase 3；未配置时管理接口一律 403，fail-closed；env() 已 trim 防尾随空格恒 403） */
  adminToken: env('ADMIN_TOKEN'),
  ai: buildAiConfig(),
  pushplus: {
    token: process.env.PUSHPLUS_TOKEN || '',
  },
  bailian: {
    apiKey: process.env.BAILIAN_API_KEY || '',
    baseUrl: process.env.BAILIAN_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    visionModel: process.env.BAILIAN_VISION_MODEL || 'qwen3.6-plus',
    asrModel: process.env.BAILIAN_ASR_MODEL || 'fun-asr',
  },
  wechat: {
    appId: process.env.WECHAT_APPID || '',
    secret: process.env.WECHAT_SECRET || '',
  },
  seedream: {
    apiKey: process.env.SEEDREAM_API_KEY || '',
  },
  seedance: {
    apiKey: process.env.SEEDANCE_API_KEY || '',
    model: process.env.SEEDANCE_MODEL || 'doubao-seedance-1-5-pro-251215',
  },
  meshy: {
    apiKey: process.env.MESHY_API_KEY || '',
    baseUrl: 'https://api.meshy.ai',
  },
  moderate: {
    /** 旧单 key 形态已废弃（真实接口走 AK/SK 签名），保留字段兼容历史配置读取 */
    apiKey: process.env.MODERATE_API_KEY || '',
    /** 火山引擎 IAM AccessKey（AKLT… 开头）——内容安全/视觉智能 V4 签名鉴权 */
    accessKeyId: process.env.MODERATE_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.MODERATE_SECRET_ACCESS_KEY || '',
    /** 内容安全能力名（req_key），以控制台 API Explorer 实测为准，可经 .env 校准 */
    reqKey: process.env.MODERATE_REQ_KEY || '',
    /** 审核场景（色情/涉政/暴恐/广告），默认四场景 */
    scenarios: (process.env.MODERATE_SCENARIOS || 'porn,politician,terror,ad')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  },
  /** 回忆录旁白 TTS 配置（火山引擎豆包语音 Doubao Speech 2.0，回忆录 2.0 M3 模块） */
  doubaoSpeech: {
    /** 豆包语音新控制台 API Key（需在火山引擎控制台开通"语音技术/豆包语音"获取） */
    apiKey: process.env.DOUBAO_SPEECH_API_KEY || '',
    /** 资源 ID（豆包语音 2.0） */
    resourceId: process.env.DOUBAO_SPEECH_RESOURCE_ID || 'seed-tts-2.0',
    /** 默认音色（豆包语音 speaker ID） */
    voice: process.env.DOUBAO_SPEECH_VOICE || 'zh_female_vv_uranus_bigtts',
    /** 接口地址（异步合成：submit/query） */
    baseUrl: process.env.DOUBAO_SPEECH_BASE_URL || 'https://openspeech.bytedance.com/api/v3/tts',
  },
  /** 回忆录视频质量质检配置（DeepSeek 视觉模型，M5 模块） */
  qualityCheck: {
    /** 质检 API Key（缺省复用主 AI key；可单独配置） */
    apiKey: process.env.QUALITY_CHECK_API_KEY || '',
    /** 质检模型服务地址（默认 DeepSeek 官方 vision-exp） */
    baseUrl: process.env.QUALITY_CHECK_BASE_URL || 'https://api.deepseek.com/v1',
    /** 质检视觉模型（默认 DeepSeek 最新视觉模型） */
    model: process.env.QUALITY_CHECK_MODEL || 'deepseek-v4-flash-vision-exp',
  },
  wechatPay: {
    /** Mock 模式：true=本地开发模拟支付，不调真实微信 API；false=真实微信支付 V3 */
    mock: process.env.WECHAT_PAY_MOCK !== 'false',
    mchId: process.env.WECHAT_PAY_MCH_ID || '',
    apiV3Key: process.env.WECHAT_PAY_API_V3_KEY || '',
    privateKey: process.env.WECHAT_PAY_PRIVATE_KEY || '',
    certSerialNo: process.env.WECHAT_PAY_CERT_SERIAL_NO || '',
    platformCertSerialNo: process.env.WECHAT_PAY_PLATFORM_CERT_SERIAL_NO || '',
    platformCert: process.env.WECHAT_PAY_PLATFORM_CERT || '',
    notifyUrl: process.env.WECHAT_PAY_NOTIFY_URL || '',
  },
  uploadDir: process.env.UPLOAD_DIR || './uploads',
  /** 对外可访问的服务基础地址（用于生成视频/图片的完整 URL），未配置时返回相对路径 */
  publicBaseUrl: process.env.PUBLIC_BASE_URL || '',
  /** CORS 允许来源（逗号分隔）；未配置时默认允许所有来源（小程序端不受 CORS 限制） */
  allowedOrigins: (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
};

// ===== 生产环境启动守卫（2026-09 全项目双 Agent 审查 P0）=====
// 背景：Mock 模式下支付回调（decodeMockNotify）不做任何验签，向 /api/payment/wechat/notify
// 伪造 {"out_trade_no","trade_state":"SUCCESS"} 即可把任意 pending 订单标记为已支付（白嫖会员/回忆录）。
// 生产环境绝不允许 Mock 支付：这里 fail-fast 拒绝启动，杜绝「忘配 WECHAT_PAY_MOCK=false」的资损事故。
if (process.env.NODE_ENV === 'production' && config.wechatPay.mock) {
  throw new Error(
    '[config] 生产环境禁止开启支付 Mock（Mock 回调无验签，存在资损风险）。请在生产 .env 设置 WECHAT_PAY_MOCK=false 后重启。',
  );
}

// 生产环境缺失微信登录配置时给出醒目告警：auth 路由会拒绝登录（isDev 降级已按环境收口），
// 但配置缺失本身是部署事故，必须在启动日志里可见，而不是等用户登录失败才发现。
if (process.env.NODE_ENV === 'production' && (!config.wechat.appId || !config.wechat.secret)) {
  console.error('[config] 生产环境未配置 WECHAT_APPID/WECHAT_SECRET，微信登录将不可用！');
}

// CORS 白名单声称核实（审查 P0/P2）：ALLOWED_ORIGINS 未配置时 origin:true 放行所有来源（fail-open），
// 与《运营应急预案》声称的「CORS 白名单✅」不符。小程序不受 CORS 约束、同源管理后台也不受影响，
// 故不硬失败（避免误伤官网等跨域浏览器端），但生产环境必须给出告警推动补配。
if (process.env.NODE_ENV === 'production' && config.allowedOrigins.length === 0) {
  console.warn('[config] 生产环境未配置 ALLOWED_ORIGINS，CORS 当前放行所有来源（fail-open）。建议配置来源白名单。');
}

// 内容审核 AK/SK 缺失时 moderateVideo 会默认放行（fail-open），与《运营应急预案》声称的
// 「内容审核✅」不符。生产必须配置 MODERATE_ACCESS_KEY_ID/MODERATE_SECRET_ACCESS_KEY，缺失时醒目告警。
if (process.env.NODE_ENV === 'production' && !(config.moderate?.accessKeyId && config.moderate?.secretAccessKey)) {
  console.error('[config] 生产环境未配置 MODERATE_ACCESS_KEY_ID/MODERATE_SECRET_ACCESS_KEY，视频内容审核将默认放行（fail-open），存在合规风险！');
}

// ===== AI 连接配置启动校验 =====
// 2026-09-10 起运行时一律走 DeepSeek 官方（AI_*）；ARK_* 已不参与选择。
// 这里只做两件校验：①误配 ARK_* 时提醒（防止有人按旧文档继续配火山）；
// ②AI_API_KEY 缺失时提醒（AI 对话/记忆/Agent 将无法调用）。密钥本身不打印。
{
  const arkKeys = ['ARK_API_KEY', 'ARK_BASE_URL', 'ARK_MODEL'] as const;
  const anyArkSet = arkKeys.some((k) => (process.env[k] || '').trim() !== '');
  if (anyArkSet) {
    console.warn('[config] 检测到 ARK_* 配置，但运行时已切换为 DeepSeek 官方（AI_*），ARK_* 将被忽略（火山合作协议仅作微信类目报备材料，不参与实际调用）。');
  }
  if (!config.ai.apiKey) {
    console.warn('[config] AI_API_KEY 未配置，AI 对话/记忆/Agent 将无法调用（各 service 会返回占位或空）。');
  }
}

// ===== 回忆录三档位配置（2026-09-09 三档定价体系） =====

/** 回忆录档位：light 轻纪念 / standard 标准回忆录 / full 完整回忆录 */
export type MemoirTier = 'light' | 'standard' | 'full';

/** 档位配置（照片数与成片时长边界；生成管线由 videoGenerationService.mapTierToGenerationLine 决定） */
export const MEMOIR_TIER_CONFIG = {
  light: { minPhotos: 1, maxPhotos: 3, minDuration: 5, maxDuration: 30, defaultDuration: 20 },
  standard: { minPhotos: 5, maxPhotos: 7, minDuration: 40, maxDuration: 50, defaultDuration: 45 },
  full: { minPhotos: 8, maxPhotos: 15, minDuration: 60, maxDuration: 90, defaultDuration: 75 },
} as const;

/** 档位中文名（错误提示用） */
export const MEMOIR_TIER_LABELS: Record<MemoirTier, string> = {
  light: '轻纪念',
  standard: '标准回忆录',
  full: '完整回忆录',
};

/** 三档定价表（单位：分；2026-09-09 用户拍板：非会员 2590/5900/9900，会员 1890/4500/7900） */
export const MEMOIR_TIER_PRICES: Record<MemoirTier, { member: number; free: number }> = {
  light: { member: 1890, free: 2590 },
  standard: { member: 4500, free: 5900 },
  full: { member: 7900, free: 9900 },
};
