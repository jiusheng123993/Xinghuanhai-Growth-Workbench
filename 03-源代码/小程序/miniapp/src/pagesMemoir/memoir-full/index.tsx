/**
 * 纪念Vlog页面（2026-09-09 B2 三档定价体系改造）
 * 7屏流程：素材盘点 → 选照片(本地+库内) → 选记忆 → 写叙事 → 选BGM → 确认支付(三档卡) → 完成
 *
 * 关键变化（对齐 B1 后端契约）：
 * - 支付链真实化：POST /api/payment/memoir/order → 微信支付 → 轮询回调创建的任务
 *   （旧 handlePayment 调用不存在的 /memoir/pay 且硬编码 99/149，已废除）
 * - 本地照片先上传服务器再提交（wxfile:// 临时路径会被后端白名单拒绝——生产视频链
 *   从未跑通的根因之一），选完即异步上传，提交前校验全部就绪
 * - 库内素材：素材盘点首屏（material-check）+ 照片池勾选（photo-pool）+ 时光线回忆勾选
 *   （selected_moment_ids 直达旁白锚定）
 * - 三档价格：确认页三档卡，价格取自 membership 端点 memoirPrices 表（会员/非会员分价）
 * - 剧本确认闸门保留（立项 v0.2 P0-2）：分镜生成后等待确认，确认后才烧视频成本
 */
import { View, Text, ScrollView, Image, Textarea } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { useState, useEffect, useCallback, useRef } from 'react'
import { CONFIG } from '../../config'
import { MEMOIR_TAG_OPTIONS } from '../../constants/memoirTags'
import { chooseImageWithPrivacy } from '../../utils/privacy'
import { wsClient } from '../../services/wsClient'
import {
  getMaterialCheck,
  getPhotoPool,
  getMemoirPricing,
  uploadLocalPhoto,
  uploadMemoirBgm,
  createMemoirOrder,
  payWithWechat,
  waitForNewTask,
  getLatestStatus,
  snapshotLatestTaskId,
  confirmScript,
  rejectScript,
  getPromptPreview,
  refinePrompt,
  confirmPrompt,
  mapBGMKeyToMusicStyle,
  type MaterialCheck,
  type MemoirPricing,
  type MemoirTaskStatus,
  type MemoirPromptScript,
  type PromptSegment,
} from '../../services/memoirService'
import {
  MEMOIR_TIER_ORDER,
  MEMOIR_TIER_BOUNDS,
  TIER_META,
  isTierAvailable,
  recommendTier,
  pickTierPrice,
  formatYuan,
  tierUnavailableReason,
  tierFromRoutePath,
  type MemoirTier,
} from '../../utils/memoirTier'
import './index.scss'
import { PageBackground, Icon  } from '../../components'

// ==================== 类型定义 ====================

/** 已选照片项：本地照片需上传换 remoteUrl；库内照片自带 poolUrl（服务端原始路径） */
interface PhotoItem {
  /** 稳定唯一 key（上传回写按 key 匹配——按 index 回写在删除照片后会错位写脏其他照片） */
  key: string
  /** 展示用地址（本地临时路径或库内绝对 URL） */
  path: string
  size: number
  /** 上传后的服务端相对路径（/uploads/...，提交用；库内照片=原始路径，本地上传后回填） */
  remoteUrl?: string
  /** 本地照片上传中 */
  uploading?: boolean
  /** 上传失败（点击重试） */
  failed?: boolean
}

/** BGM 选项 */
interface BGMOption {
  key: string
  emoji: string
  name: string
  tag: string
  /** BGM 预览音频 URL */
  previewUrl: string
}

/** 待确认剧本（立项 P0-2）：segments 已归一化为数组，渲染侧无需再判空 */
interface ScriptConfirmState {
  taskId: string
  title: string
  theme: string
  segments: Array<{
    photo_index?: number
    duration_sec?: number
    narration?: string
    subtitle?: string
  }>
}

// ==================== 常量 ====================

// 背景音乐（全部为 incompetech.com 的 Kevin MacLeod 作品，CC BY 3.0 免费可商用，需署名）
const BGM_OPTIONS: BGMOption[] = [
  { key: 'piano', emoji: '🎵', name: '温柔时光', tag: '钢琴曲', previewUrl: `${CONFIG.ASSETS_BASE_URL}/bgm/piano-preview.mp3` },
  { key: 'guitar', emoji: '🎵', name: '暖心回忆', tag: '轻快', previewUrl: `${CONFIG.ASSETS_BASE_URL}/bgm/guitar-preview.mp3` },
  { key: 'strings', emoji: '🎵', name: '深情告白', tag: '弦乐', previewUrl: `${CONFIG.ASSETS_BASE_URL}/bgm/strings-preview.mp3` },
  { key: 'upbeat', emoji: '🎵', name: '欢快瞬间', tag: '轻快节奏', previewUrl: `${CONFIG.ASSETS_BASE_URL}/bgm/upbeat-preview.mp3` },
]

// 7 屏流程指示（0 盘点 / 1 选照片 / 2 选记忆 / 3 叙事 / 4 BGM / 5 确认 / 6 完成）
const STEP_LABELS = ['盘点', '选照片', '选记忆', '叙事', 'BGM', '确认', '完成']

const LOADING_STEPS = ['提交成功', '处理中', 'AI编排中', '生成视频中']

// 本页服务的档位由**路由**推导（memoir-full → 完整档 8-15 张；memoir-vlog → 标准档 5-7 张），
// 照片边界一律从 MEMOIR_TIER_BOUNDS 派生，边界值见下方组件内 pageTier / PHOTO_LIMIT / PHOTO_MIN。
//
// 2026-09-11 修复存量 P0：此前这里把边界硬编码成 standard（5-7），而 memoir-full 与 memoir-vlog
// 又是两份逐字节相同的实现，于是**完整档页面的选照片上限被死锁在 7 张**，
// isTierAvailable('full', n≤7) 恒为 false —— 最贵的完整档（8-15 张）在任何入口都选不出来。
// 根因是"复制页面时连档位边界一起复制"，故本次改为按路由分档，禁止再在页面里硬编码档位边界。
const MAX_MOMENTS = 10
const NARRATIVE_MAX_LENGTH = 500

/** 画风/氛围预设（2026-09-09 用户拍板 4 画风；key 与后端 STYLE_PRESET_HINTS 对齐，随记忆到提示词预览/生成） */
const STYLE_OPTIONS: Array<{ key: string; emoji: string; name: string; desc: string }> = [
  { key: 'cinematic', emoji: '🎬', name: '电影感', desc: '电影级运镜·调色·浅景深' },
  { key: 'anime', emoji: '🎨', name: '动画风', desc: '二次元治愈·柔和色板' },
  { key: 'realistic', emoji: '📷', name: '写实记录', desc: '纪实照片级·自然真实' },
  { key: 'warmheal', emoji: '🌤️', name: '温暖治愈', desc: '暖调柔光·抚慰治愈' },
]

/** 顶部参考样例视频（2026-09-09）：用户提供成品视频 URL 后填入即可在顶部播放；为空显示占位 */
const SAMPLE_VIDEO_URL = 'https://api.xinghuanhai.com/uploads/memoir-sample/sample-light-1.mp4'

/** 选照片步骤的两个 tab */
type PhotoTab = 'local' | 'pool'

// ==================== 组件 ====================

export default function MemoirVlog() {
  const router = Taro.getCurrentInstance().router
  const routerParams = router?.params as Record<string, string> | undefined
  // 本页服务的档位（按路由分档）与照片边界（唯一事实源 MEMOIR_TIER_BOUNDS）
  const pageTier = tierFromRoutePath(router?.path)
  const pageTierName = TIER_META[pageTier].name
  const PHOTO_LIMIT = MEMOIR_TIER_BOUNDS[pageTier].maxPhotos
  const PHOTO_MIN = MEMOIR_TIER_BOUNDS[pageTier].minPhotos
  const petId = routerParams?.petId || ''
  // 回忆录馆（memoir-center）档位卡直达：?tier=standard/full 预选档位（确认页 effect 会自动纠正不可用档）
  const presetTier = routerParams?.tier === 'standard' || routerParams?.tier === 'full'
    ? (routerParams.tier as MemoirTier)
    : null

  // —— 步骤控制 ——
  const [step, setStep] = useState(0)
  const [animKey, setAnimKey] = useState(0)

  // —— 步骤0：素材盘点 ——
  const [material, setMaterial] = useState<MaterialCheck | null>(null)
  const [checkingMaterial, setCheckingMaterial] = useState(false)
  /** 盘点加载失败（与「确无回忆」区分，选记忆屏显示重试入口） */
  const [materialFailed, setMaterialFailed] = useState(false)

  // —— 步骤1：选照片（本地 + 库内双来源） ——
  const [photos, setPhotos] = useState<PhotoItem[]>([])
  const [photoTab, setPhotoTab] = useState<PhotoTab>('local')
  const [photoPool, setPhotoPool] = useState<Awaited<ReturnType<typeof getPhotoPool>> | null>(null)
  const [loadingPool, setLoadingPool] = useState(false)
  /** 照片池加载失败（阻断自动重试死循环，重试交用户手动——审查 P1） */
  const [poolLoadFailed, setPoolLoadFailed] = useState(false)

  // —— 步骤2：选记忆（勾选的时光线回忆直达旁白锚定） ——
  const [selectedMomentIds, setSelectedMomentIds] = useState<string[]>([])

  // —— 步骤3：写叙事 ——
  const [narrative, setNarrative] = useState('')
  // 回忆标签（F4 记忆驱动）：选中的标签传给服务端按标签筛核心层记忆作分镜素材
  const [selectedTags, setSelectedTags] = useState<string[]>([])

  /** 切换回忆标签选中态（最多 8 个，与服务端 schema 上限一致） */
  const toggleTag = useCallback((key: string) => {
    setSelectedTags(prev =>
      prev.includes(key) ? prev.filter(t => t !== key) : [...prev, key],
    )
  }, [])

  // —— 步骤4：选BGM ——
  const [selectedBGM, setSelectedBGM] = useState('piano')
  const [playingBGM, setPlayingBGM] = useState<string | null>(null)
  const bgmAudioRef = useRef<Taro.InnerAudioContext | null>(null)
  // —— 步骤4：画风/氛围 ——
  const [selectedStyle, setSelectedStyle] = useState('cinematic')
  // —— 步骤4：用户导入 BGM（版权归用户） ——
  const [customBgmUrl, setCustomBgmUrl] = useState('')
  const [customBgmName, setCustomBgmName] = useState('')
  const [uploadingBgm, setUploadingBgm] = useState(false)

  // —— 步骤5：确认支付（三档卡） ——
  const [pricing, setPricing] = useState<MemoirPricing | null>(null)
  // 外部预选档位（回忆录馆档位卡直达）：标准/完整走本页多段管线
  const [selectedTier, setSelectedTier] = useState<MemoirTier | null>(presetTier)
  const [paying, setPaying] = useState(false)

  // —— 步骤5：提示词人机协同（2026-09-09 块①，生成前确认最终版防扯皮） ——
  const [promptScript, setPromptScript] = useState<MemoirPromptScript | null>(null)
  const [promptVersion, setPromptVersion] = useState(0)
  const [promptDraft, setPromptDraft] = useState('')
  const [promptConfirmed, setPromptConfirmed] = useState(false)
  const [previewingPrompt, setPreviewingPrompt] = useState(false)

  // —— 步骤6：生成与结果 ——
  const [loading, setLoading] = useState(false)
  const [loadingText, setLoadingText] = useState('')
  const [loadingStepIndex, setLoadingStepIndex] = useState(0)
  const [outputUrl, setOutputUrl] = useState('')
  const [polling, setPolling] = useState(false)
  /**
   * 轮询消费过滤锚（审查 P1 双语义修复，替代原单一 newTaskId）：
   * - trackTaskId 非空 = 只消费该任务（支付成功拿到新任务 id / 挂载恢复已知任务）
   * - excludeTaskId 非空 = 只排除该任务（支付回调超时降级：latest 仍是旧任务时绝不消费，
   *   等回调创建的新任务出现即消费——旧任务 completed 不得误当本轮结果）
   */
  const [trackTaskId, setTrackTaskId] = useState('')
  const [excludeTaskId, setExcludeTaskId] = useState('')
  /** WS 事件触发计数：收到 memoir_status 时自增，驱动立即刷新（替代等待轮询） */
  const [refreshKey, setRefreshKey] = useState(0)
  const loadingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  /**
   * 剧本确认闸门（立项 v0.2 P0-2）：轮询到 awaiting_confirmation=true 时记录待确认剧本，
   * 渲染确认卡（确认→回队生成视频 / 放弃→任务终止且服务端自动退款）
   */
  const [scriptConfirm, setScriptConfirm] = useState<ScriptConfirmState | null>(null)

  // ==================== 步骤切换 ====================

  const goToStep = useCallback((next: number) => {
    setAnimKey(prev => prev + 1)
    setStep(next)
  }, [])

  /** 停止加载进度动画（生成成功/失败/剧本闸门时统一调用） */
  const stopLoadingAnim = useCallback(() => {
    setLoading(false)
    if (loadingTimerRef.current) {
      clearInterval(loadingTimerRef.current)
      loadingTimerRef.current = null
    }
  }, [])

  /** 启动加载进度动画（提交后/剧本确认后） */
  const startLoadingAnim = useCallback((fromStep: number) => {
    setLoading(true)
    setLoadingText(LOADING_STEPS[fromStep] || '处理中')
    setLoadingStepIndex(fromStep)
    loadingTimerRef.current = setInterval(() => {
      setLoadingStepIndex(prev => {
        const next = prev + 1
        if (next < LOADING_STEPS.length) {
          setLoadingText(LOADING_STEPS[next])
          return next
        }
        return prev
      })
    }, 3000)
  }, [])

  // ==================== 步骤0：素材盘点 ====================

  /** 进入页面即拉取素材盘点（档案照片/时光线回忆/建议档位） */
  useEffect(() => {
    if (!petId) return
    setCheckingMaterial(true)
    getMaterialCheck(petId)
      .then(setMaterial)
      .catch(() => {
        // 盘点失败不阻断：用户仍可本地上传照片走轻纪念，仅库内能力受限
        // （与「确无回忆」区分：选记忆屏对失败态显示重试入口——审查 P3）
        setMaterialFailed(true)
      })
      .finally(() => setCheckingMaterial(false))
  }, [petId])

  // ==================== 挂载恢复：进行中任务/剧本闸门孤儿（审查 P1） ====================

  /**
   * 页面挂载时检查该宠物最新任务：
   * - awaiting_confirmation → 直接恢复闸门卡（支付成功后退出页面/杀进程的场景，
   *   服务端闸门任务计入创建互斥，不恢复确认入口会让已付款项既不交付也不退款）
   * - pending/processing → 恢复进度轮询（重进页面能看到进度）
   * - completed → 直达结果屏（避免用户重走漏斗再次付款）
   * - failed/null → 正常进入流程
   */
  useEffect(() => {
    if (!petId) return
    let cancelled = false
    getLatestStatus(petId).then((task) => {
      if (cancelled || !task) return
      if (task.awaiting_confirmation && task.script) {
        setScriptConfirm({
          taskId: task.id,
          title: task.script.title || '分镜脚本',
          theme: task.script.theme || '',
          segments: Array.isArray(task.script.segments) ? task.script.segments : [],
        })
        // 锚定该闸门任务：确认剧本后轮询继续跟踪同一任务（直到服务端推进到完成/失败）
        setTrackTaskId(task.id)
      } else if (task.status === 'pending' || task.status === 'processing') {
        setTrackTaskId(task.id)
        startLoadingAnim(task.status === 'processing' ? 1 : 0)
        setPolling(true)
      } else if (task.status === 'completed' && task.video_url) {
        setOutputUrl(task.video_url)
        goToStep(6)
      }
    }).catch(() => {})
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅挂载时恢复一次
  }, [petId])

  // ==================== 步骤1：选照片 ====================

  /**
   * 切到库内 tab 时懒加载照片池（档案相册 + 时光线照片）
   * poolLoadFailed 阻断自动重试（否则失败→loadingPool 复位→effect 重跑→无限循环+无限 toast）
   */
  useEffect(() => {
    if (step !== 1 || photoTab !== 'pool' || photoPool || loadingPool || poolLoadFailed || !petId) return
    setLoadingPool(true)
    getPhotoPool(petId)
      .then(setPhotoPool)
      .catch(() => setPoolLoadFailed(true))
      .finally(() => setLoadingPool(false))
  }, [step, photoTab, photoPool, loadingPool, poolLoadFailed, petId])

  /** 照片池加载失败后的手动重试入口 */
  const handleRetryPool = useCallback(() => {
    setPoolLoadFailed(false)
  }, [])

  /** 素材盘点失败后的手动重试入口 */
  const handleRetryMaterial = useCallback(() => {
    if (!petId) return
    setMaterialFailed(false)
    setCheckingMaterial(true)
    getMaterialCheck(petId)
      .then((m) => {
        setMaterial(m)
        setMaterialFailed(false)
      })
      .catch(() => setMaterialFailed(true))
      .finally(() => setCheckingMaterial(false))
  }, [petId])

  /** 照片 key 自增序号（模块级简单自增即可保证单页会话内唯一） */
  const photoKeySeq = useRef(0)
  /** 串行上传队列链尾（真正逐张错峰，防止 forEach 瞬时并发触发 10次/分钟限流——审查 P2） */
  const uploadChainRef = useRef<Promise<void>>(Promise.resolve())

  /**
   * 本地照片选择后异步上传（wxfile:// 临时路径无法进 source_photos，
   * 必须先传服务器换 /uploads/ URL）。加入串行队列尾逐张执行。
   * 回写按稳定 key 匹配（按 index 回写：先删 A 再等 B 上传完成会把 A 的 URL 写到 B 上）
   */
  const uploadPhotoItem = useCallback((itemKey: string, filePath: string) => {
    setPhotos(prev => prev.map(p => (p.key === itemKey ? { ...p, uploading: true, failed: false } : p)))
    const job = uploadChainRef.current.then(async () => {
      try {
        const remoteUrl = await uploadLocalPhoto(filePath)
        setPhotos(prev => prev.map(p => (p.key === itemKey ? { ...p, remoteUrl, uploading: false, failed: false } : p)))
      } catch (err) {
        setPhotos(prev => prev.map(p => (p.key === itemKey ? { ...p, uploading: false, failed: true } : p)))
        Taro.showToast({ title: err instanceof Error ? err.message : '照片上传失败', icon: 'none' })
      }
    })
    // 队列容错：单张失败不阻塞后续照片上传
    uploadChainRef.current = job
  }, [])

  const handleAddPhoto = useCallback(() => {
    const remain = PHOTO_LIMIT - photos.length
    if (remain <= 0) {
      Taro.showToast({ title: `${pageTierName}最多 ${PHOTO_LIMIT} 张照片`, icon: 'none' })
      return
    }

    // 统一走隐私选图入口（前置官方授权弹窗 + 失败统一提示），返回为 chooseImage 形状
    chooseImageWithPrivacy({ count: remain, sizeType: ['compressed'] })
      .then((res) => {
        const added: Array<{ key: string; filePath: string }> = []
        const newPhotos: PhotoItem[] = res.tempFiles.map((f) => {
          const key = `local_${++photoKeySeq.current}`
          added.push({ key, filePath: f.path })
          return { key, path: f.path, size: f.size || 0, uploading: true }
        })
        // 函数式更新（连点添加时 prev 恒为最新，不会基于旧闭包长度截断）
        setPhotos(prev => [...prev, ...newPhotos].slice(0, PHOTO_LIMIT))
        // 逐张进入串行上传队列
        added.forEach(({ key, filePath }) => uploadPhotoItem(key, filePath))
      })
      .catch(() => {
        // 用户取消选择/拒绝授权等已在 privacy 层反馈，此处静默
      })
  }, [photos, uploadPhotoItem, PHOTO_LIMIT, pageTierName])

  /** 点击上传失败的照片重试上传（按 key 找回本地临时路径） */
  const handleRetryUpload = useCallback((itemKey: string) => {
    const photo = photos.find(p => p.key === itemKey)
    if (!photo || photo.uploading) return
    uploadPhotoItem(itemKey, photo.path)
  }, [photos, uploadPhotoItem])

  const handleDeletePhoto = useCallback((index: number) => {
    setPhotos(prev => prev.filter((_, i) => i !== index))
  }, [])

  const handlePreviewPhoto = useCallback((index: number) => {
    const urls = photos.map(p => p.path)
    Taro.previewImage({
      current: urls[index],
      urls,
    })
  }, [photos])

  /** 勾选/取消库内照片（去重：同一 URL 只出现一次；key 用 pool_ 前缀防与本地 key 冲突） */
  const togglePoolPhoto = useCallback((rawUrl: string, displayUrl: string) => {
    setPhotos(prev => {
      const existed = prev.find(p => p.remoteUrl === rawUrl)
      if (existed) return prev.filter(p => p.remoteUrl !== rawUrl)
      if (prev.length >= PHOTO_LIMIT) {
        // 文案与实际上限必须同源（此前后端上限是 7 却写死"最多选择15张照片"，自相矛盾）
        Taro.showToast({ title: `最多选择 ${PHOTO_LIMIT} 张照片`, icon: 'none' })
        return prev
      }
      // 库内照片无需上传，直接带服务端原始路径
      return [...prev, { key: `pool_${rawUrl}`, path: displayUrl, size: 0, remoteUrl: rawUrl }]
    })
  }, [PHOTO_LIMIT])

  // ==================== 步骤2：选记忆 ====================

  /** 勾选/取消时光线回忆（上限 10，与服务端 schema 一致） */
  const toggleMoment = useCallback((momentId: string) => {
    setSelectedMomentIds(prev => {
      if (prev.includes(momentId)) return prev.filter(id => id !== momentId)
      if (prev.length >= MAX_MOMENTS) {
        Taro.showToast({ title: '最多勾选10条回忆', icon: 'none' })
        return prev
      }
      return [...prev, momentId]
    })
  }, [])

  // ==================== 步骤4：BGM 预览 ====================

  const handleBGMPreview = useCallback((bgmKey: string, previewUrl: string) => {
    // 如果正在播放同一首 BGM，则停止
    if (playingBGM === bgmKey) {
      if (bgmAudioRef.current) {
        bgmAudioRef.current.stop()
        bgmAudioRef.current.destroy()
        bgmAudioRef.current = null
      }
      setPlayingBGM(null)
      return
    }

    // 停止当前播放的 BGM
    if (bgmAudioRef.current) {
      bgmAudioRef.current.stop()
      bgmAudioRef.current.destroy()
      bgmAudioRef.current = null
    }

    // 创建新的音频上下文
    const audioCtx = Taro.createInnerAudioContext()
    audioCtx.src = previewUrl
    audioCtx.autoplay = true
    audioCtx.loop = false

    audioCtx.onPlay(() => {
      setPlayingBGM(bgmKey)
    })

    audioCtx.onEnded(() => {
      setPlayingBGM(null)
      if (bgmAudioRef.current) {
        bgmAudioRef.current.destroy()
        bgmAudioRef.current = null
      }
    })

    audioCtx.onError((err) => {
      console.warn('[BGM Preview] 音频播放失败:', err.errMsg)
      setPlayingBGM(null)
      if (bgmAudioRef.current) {
        bgmAudioRef.current.destroy()
        bgmAudioRef.current = null
      }
      Taro.showToast({ title: '试听暂不可用', icon: 'none' })
    })

    bgmAudioRef.current = audioCtx
  }, [playingBGM])

  /**
   * 导入我的音乐（2026-09-09 用户导入 BGM）：微信选音频文件 → 上传 → 得 URL，选中为自定义 BGM。
   * 版权归用户：页面上已注明「请确认拥有该音频的授权」。
   */
  const handleImportBGM = useCallback(() => {
    if (!petId) {
      Taro.showToast({ title: '宠物信息缺失', icon: 'none' })
      return
    }
    if (uploadingBgm) {
      return
    }
    Taro.chooseMessageFile({
      count: 1,
      type: 'file',
      extension: ['mp3', 'm4a', 'aac', 'wav'],
    }).then(async (res) => {
      const file = res.tempFiles?.[0]
      if (!file || !file.path) {
        return
      }
      setUploadingBgm(true)
      try {
        const url = await uploadMemoirBgm(petId, file.path)
        setCustomBgmUrl(url)
        setCustomBgmName((file.name || '我的音乐').replace(/\.(mp3|m4a|aac|wav)$/i, ''))
        setSelectedBGM('custom')
        Taro.showToast({ title: '已导入我的音乐', icon: 'success' })
      } catch (err) {
        Taro.showToast({ title: err instanceof Error ? err.message : '导入失败', icon: 'none' })
      } finally {
        setUploadingBgm(false)
      }
    }).catch(() => {
      // 用户取消选择静默
    })
  }, [petId, uploadingBgm])

  // 组件卸载时清理音频与加载动画定时器（loading interval 泄漏会在退出页面后空转 setState）
  useEffect(() => {
    return () => {
      if (bgmAudioRef.current) {
        bgmAudioRef.current.stop()
        bgmAudioRef.current.destroy()
        bgmAudioRef.current = null
      }
      if (loadingTimerRef.current) {
        clearInterval(loadingTimerRef.current)
        loadingTimerRef.current = null
      }
    }
  }, [])

  // ==================== 步骤5：确认支付 ====================

  /** 进入确认步骤时拉取三档价格与会员身份 */
  useEffect(() => {
    if (step !== 5 || !petId) return
    getMemoirPricing(petId).then(setPricing)
  }, [step, petId])

  /** 步骤切换到确认页时按已选照片数设置/校正默认档：残留档位不可用（照片数变了）自动重算推荐档 */
  useEffect(() => {
    if (step === 5) {
      if (selectedTier === null || !isTierAvailable(selectedTier, photos.length)) {
        setSelectedTier(recommendTier(photos.length))
      }
    }
  }, [step, selectedTier, photos.length])

  // ==================== 提示词人机协同（2026-09-09 块①） ====================

  /**
   * 预览第一版提示词：按 照片+画风+BGM 从服务端取「将用提示词」给用户看。
   */
  const handlePreviewPrompt = useCallback(async () => {
    if (!petId) {
      Taro.showToast({ title: '宠物信息缺失', icon: 'none' })
      return
    }
    if (!selectedTier) {
      Taro.showToast({ title: '请先选择档位', icon: 'none' })
      return
    }
    const uploading = photos.filter(p => p.uploading).length
    if (uploading > 0) {
      Taro.showToast({ title: `还有 ${uploading} 张照片上传中`, icon: 'none' })
      return
    }
    const remotePhotos = photos
      .map(p => p.remoteUrl)
      .filter((u): u is string => !!u)
    if (remotePhotos.length === 0) {
      Taro.showToast({ title: '请先添加并上传照片', icon: 'none' })
      return
    }
    if (!isTierAvailable(selectedTier, photos.length)) {
      Taro.showToast({ title: `照片数不满足${TIER_META[selectedTier].name}要求`, icon: 'none' })
      return
    }
    // 防连点：请求进行中拒绝再次触发（审查 P1：否则并发多次视觉+LLM 付费调用）
    if (previewingPrompt) {
      return
    }
    setPreviewingPrompt(true)
    try {
      const script = await getPromptPreview(petId, {
        memoir_type: 'memorial',
        tier: selectedTier,
        source_photos: remotePhotos,
        source_text: narrative.trim() || undefined,
        music_style: selectedBGM === 'custom' ? 'warm' : mapBGMKeyToMusicStyle(selectedBGM),
        // 画风（2026-09-09）：与下单一致，透传后端注入 GLOBAL STYLE
        style_preset: selectedStyle,
        tags: selectedTags.length > 0 ? selectedTags : undefined,
        selected_moment_ids: selectedMomentIds.length > 0 ? selectedMomentIds : undefined,
      })
      setPromptScript(script)
      setPromptVersion(v => v + 1)
      setPromptConfirmed(false)
      setPromptDraft('')
    } catch (err) {
      Taro.showToast({ title: err instanceof Error ? err.message : '提示词预览失败', icon: 'none' })
    } finally {
      setPreviewingPrompt(false)
    }
  }, [petId, selectedTier, photos, narrative, selectedBGM, selectedStyle, selectedMomentIds, selectedTags, previewingPrompt])

  /** 生成下一版提示词：用户提修改要求 → LLM 改写。 */
  const handleRefinePrompt = useCallback(async () => {
    if (!petId || !promptScript) {
      Taro.showToast({ title: '请先预览提示词', icon: 'none' })
      return
    }
    if (!promptDraft.trim()) {
      Taro.showToast({ title: '请先填写修改要求', icon: 'none' })
      return
    }
    // 防连点（审查 P1）
    if (previewingPrompt) {
      return
    }
    setPreviewingPrompt(true)
    try {
      const segments = await refinePrompt(petId, promptScript.segments as PromptSegment[], promptDraft.trim())
      setPromptScript({ ...promptScript, segments })
      setPromptVersion(v => v + 1)
      setPromptConfirmed(false)
      setPromptDraft('')
      // 版本号：setPromptVersion 用函数式，但 toast 用闭包值——新版本号 = promptVersion + 1（修复 off-by-one）
      Taro.showToast({ title: `已生成第 ${promptVersion + 1} 版提示词`, icon: 'none' })
    } catch (err) {
      Taro.showToast({ title: err instanceof Error ? err.message : '改写失败', icon: 'none' })
    } finally {
      setPreviewingPrompt(false)
    }
  }, [petId, promptScript, promptDraft, promptVersion, previewingPrompt])

  /** 确认最终版提示词：留存作证，才允许进入支付/生成。 */
  const handleConfirmPrompt = useCallback(async () => {
    if (!petId || !promptScript || !selectedTier) {
      return
    }
    // 防连点（审查 P1）
    if (previewingPrompt) {
      return
    }
    setPreviewingPrompt(true)
    try {
      await confirmPrompt(petId, selectedTier, promptScript)
      setPromptConfirmed(true)
      Taro.showToast({ title: '已确认最终版提示词', icon: 'success' })
    } catch (err) {
      Taro.showToast({ title: err instanceof Error ? err.message : '确认失败', icon: 'none' })
    } finally {
      setPreviewingPrompt(false)
    }
  }, [petId, promptScript, selectedTier, previewingPrompt])

  // ==================== 提示词确认态时效性（审查 P0 修复：素材/档位变化或重置时清确认，防「确认了A又用B生成」资损） ====================

  const resetPromptState = useCallback(() => {
    setPromptScript(null)
    setPromptVersion(0)
    setPromptDraft('')
    setPromptConfirmed(false)
  }, [])

  // 记录上次预览所依赖的素材指纹（照片数/档位/BGM/叙事/标签/勾选记忆 数），任一变化即认为确认版失效
  const promptFingerprintRef = useRef('')
  useEffect(() => {
    const fingerprint = [
      photos.length,
      selectedTier ?? '',
      selectedBGM,
      narrative,
      selectedTags.join(','),
      selectedMomentIds.length,
    ].join('|')
    const prev = promptFingerprintRef.current
    promptFingerprintRef.current = fingerprint
    // 首次记录不触发；此后素材或档位变化 → 清空确认态（改照片/切档位/改BGM/叙事/标签后必须重新预览确认）
    if (prev !== '' && prev !== fingerprint && promptConfirmed) {
      resetPromptState()
      Taro.showToast({ title: '素材或档位已变化，请重新确认提示词', icon: 'none' })
    }
  }, [photos.length, selectedTier, selectedBGM, narrative, selectedTags, selectedMomentIds.length, promptConfirmed, resetPromptState])
  // ==================== 支付链：下单 → 微信支付 → 等任务 → 轮询 ====================

  /** 支付并开始生成（确认页主按钮） */
  const handlePayAndGenerate = useCallback(async () => {
    if (!petId) {
      Taro.showToast({ title: '宠物信息缺失', icon: 'none' })
      return
    }
    // 提示词人机协同硬门槛（2026-09-09）：生成前必须把提示词确认成最终版，防「这不是我生成的」扯皮
    if (!promptConfirmed) {
      Taro.showModal({
        title: '请先确认提示词',
        content: '生成前请预览提示词，并将它确认为最终版；无修改时可只预览后直接确认',
        showCancel: false,
        confirmText: '去确认',
      })
      return
    }
    if (!selectedTier) {
      Taro.showToast({ title: '请先选择回忆录档位', icon: 'none' })
      return
    }
    // 提交前校验：全部照片必须已上传就绪（本地照片异步上传，可能未完成）
    const uploading = photos.filter(p => p.uploading).length
    if (uploading > 0) {
      Taro.showToast({ title: `还有 ${uploading} 张照片上传中，请稍候`, icon: 'none' })
      return
    }
    const failed = photos.filter(p => p.failed).length
    if (failed > 0) {
      Taro.showToast({ title: `有 ${failed} 张照片上传失败，请点击重试`, icon: 'none' })
      return
    }
    // 服务端档位照片数校验的前端预检（4 张等空隙档位给出明确引导）
    if (!isTierAvailable(selectedTier, photos.length)) {
      Taro.showToast({ title: `当前照片数不满足${TIER_META[selectedTier].name}要求`, icon: 'none' })
      return
    }

    setPaying(true)
    // 提交前快照最新任务 id（严格模式：失败重试 3 次，仍失败阻断——审查 P1：
    // 置 null 会把库内旧任务误判为新任务，新订单反被并发互斥自动退款）
    const preTaskId = await snapshotLatestTaskId(petId)
    if (preTaskId === undefined) {
      setPaying(false)
      Taro.showModal({
        title: '网络不稳定',
        content: '无法确认当前任务状态，为避免重复扣款已暂停下单，请稍后重试',
        showCancel: false,
        confirmText: '知道了',
      })
      return
    }

    try {
      // 1. 下单（服务端返回微信支付参数与订单号；musicStyle 传 BGM key，service 内部统一转换枚举）
      const order = await createMemoirOrder({
        petId,
        memoirType: 'memorial',
        tier: selectedTier,
        // 提交前就绪校验已保证全部 remoteUrl 就绪；防御性兜底显式报错不静默回退 wxfile://
        sourcePhotos: photos.map(p => {
          if (!p.remoteUrl) {
            throw new Error('有照片尚未上传完成，请稍候或删除后重试')
          }
          return p.remoteUrl
        }),
        sourceText: narrative.trim() || undefined,
        musicStyle: selectedBGM === 'custom' ? undefined : selectedBGM,
        stylePreset: selectedStyle,
        customBgmUrl: selectedBGM === 'custom' ? customBgmUrl : undefined,
        tags: selectedTags.length > 0 ? selectedTags : undefined,
        selectedMomentIds: selectedMomentIds.length > 0 ? selectedMomentIds : undefined,
      })

      // 2. 拉起微信支付（false=用户取消，停留确认页；真实支付失败由 platform 层 reject 透传原因）
      const paid = await payWithWechat(order.payment)
      setPaying(false)
      if (!paid) {
        Taro.showToast({ title: '已取消支付', icon: 'none' })
        return
      }

      // 3. 支付完成 → 等待服务端回调创建任务（1~10s 异步延迟）
      goToStep(6)
      startLoadingAnim(0)
      const task = await waitForNewTask(petId, preTaskId, {
        onTick: (elapsed) => {
          if (elapsed >= 8000) setLoadingText('支付确认中，请稍候...')
        },
      })

      if (!task) {
        // 超时兜底：订单已支付，任务可能仍在队列——降级为轮询接管（勿引导重新下单防双扣）。
        // 排除锚 = preTaskId（旧任务）：latest 仍是旧任务时绝不消费（防旧 completed 误当本轮结果），
        // 等回调创建的新任务出现即消费（Agent A 复验 P1：不能用「锚定 preTaskId」语义——
        // 那会放行旧任务、忽略新任务，正好与目标相反）
        setExcludeTaskId(preTaskId ?? '')
        setLoadingText('任务确认中...')
        setPolling(true)
        Taro.showModal({
          title: '生成任务确认中',
          content: '支付已受理，视频任务正在排队创建，请勿重复下单；请保持页面打开，稍候即可看到进度',
          showCancel: false,
          confirmText: '知道了',
        })
        return
      }

      // 4. 新任务出现 → 进入既有轮询状态机（剧本闸门/完成/失败统一在轮询 effect 处理）
      setTrackTaskId(task.id)
      setPolling(true)
    } catch (err) {
      // 下单失败（402 价格变动/400 校验/网络）与真实支付失败均透传原因
      setPaying(false)
      Taro.showToast({ title: err instanceof Error ? err.message : '支付失败，请重试', icon: 'none' })
    }
  }, [petId, selectedTier, photos, narrative, selectedTags, selectedBGM, selectedStyle, selectedMomentIds, goToStep, startLoadingAnim, promptConfirmed, customBgmUrl])

  // ==================== 轮询任务状态 ====================

  // 订阅 WS 事件：视频生成完成/失败时立即触发刷新（替代等待下一次轮询）
  useEffect(() => {
    if (!polling || !petId) return

    const unsubscribe = wsClient.on('memoir_status', () => {
      setRefreshKey((k) => k + 1)
    })
    return unsubscribe
  }, [polling, petId])

  // 轮询状态机：剧本确认闸门 / 完成 / 失败 / 继续轮询（带总时长上限与任务 id 比对）
  useEffect(() => {
    if (!polling || !petId) return

    let timer: ReturnType<typeof setTimeout> | null = null
    let stopped = false
    // 总时长上限 30 分钟（视频分段生成可能较久，超时引导退出重进看进度而非永久挂起）
    const startedAt = Date.now()
    const MAX_POLL_MS = 30 * 60 * 1000

    const poll = async () => {
      if (stopped) return

      const task: MemoirTaskStatus | null = await getLatestStatus(petId)

      if (stopped) return

      // 任务 id 过滤（审查 P1 双语义锚，互斥使用，两者皆空=不过滤）：
      // - trackTaskId 非空：只消费该任务（支付成功/挂载恢复锚定），期间被替换的任务不消费
      // - excludeTaskId 非空：只排除该任务（支付回调超时降级等新任务，旧任务绝不消费）
      // 例外：awaiting_confirmation 的闸门任务永远可达（闸门卡是唯一确认入口，错过即资金滞留）
      const shouldSkip = task?.id && !task.awaiting_confirmation && (
        trackTaskId
          ? task.id !== trackTaskId
          : excludeTaskId
            ? task.id === excludeTaskId
            : false
      )
      if (shouldSkip) {
        timer = setTimeout(poll, 2000)
        return
      }

      if (task?.awaiting_confirmation) {
        // 剧本确认闸门（立项 P0-2）：分镜已生成，暂停等待用户确认；
        // 停止轮询与加载动画，展示确认卡（确认后重新入队，Seedance 成本才发生）
        stopLoadingAnim()
        setPolling(false)
        setScriptConfirm({
          taskId: task.id,
          title: task.script?.title || '分镜脚本',
          theme: task.script?.theme || '',
          segments: Array.isArray(task.script?.segments) ? task.script!.segments! : [],
        })
      } else if (task?.status === 'completed') {
        setOutputUrl(task.video_url || '')
        stopLoadingAnim()
        setPolling(false)
        Taro.showToast({ title: '生成成功', icon: 'success' })
        goToStep(6)
      } else if (task?.status === 'failed') {
        stopLoadingAnim()
        setPolling(false)
        // 生成失败服务端已自动退款（B1 退款闭环），文案给用户确定感
        Taro.showModal({
          title: '生成失败',
          content: '本次生成未成功，已支付费用将自动原路退回',
          showCancel: false,
          confirmText: '知道了',
        })
      } else if (Date.now() - startedAt > MAX_POLL_MS) {
        // 轮询总时长超限（30 分钟）：停止挂起，引导退出重进（mount 恢复逻辑会接管进度）
        stopLoadingAnim()
        setPolling(false)
        Taro.showModal({
          title: '生成时间较长',
          content: '视频仍在生成中，已为你保留任务；请稍后重新进入本页查看结果',
          showCancel: false,
          confirmText: '知道了',
        })
      } else {
        // pending/processing/暂无任务：继续轮询
        timer = setTimeout(poll, 2000)
      }
    }

    poll()

    return () => {
      stopped = true
      if (timer) clearTimeout(timer)
    }
  }, [polling, petId, goToStep, refreshKey, stopLoadingAnim, trackTaskId, excludeTaskId])

  // ==================== 重新制作 ====================

  const handleReset = useCallback(() => {
    setPhotos([])
    setSelectedMomentIds([])
    setNarrative('')
    setSelectedTags([])
    setSelectedBGM('piano')
    setSelectedTier(null)
    setOutputUrl('')
    setPhotoPool(null)
    setPhotoTab('local')
    setPoolLoadFailed(false)
    setPricing(null)
    setScriptConfirm(null)
    setTrackTaskId('')
    setExcludeTaskId('')
    // 提示词确认态一并清空（审查 P0：否则「重新制作」免预览沿用旧确认版）
    resetPromptState()
    setLoading(false)
    setPolling(false)
    goToStep(0)
  }, [goToStep, resetPromptState])

  const handleShare = useCallback(() => {
    Taro.showShareMenu({
      withShareTicket: true,
    })
  }, [])

  // ==================== 剧本确认闸门（立项 v0.2 P0-2） ====================

  /** 确认分镜脚本：任务重新入队，处理器直接进入视频生成（此时才发生视频成本） */
  const handleConfirmScript = useCallback(async () => {
    if (!scriptConfirm || !petId) return

    try {
      await confirmScript(petId, scriptConfirm.taskId)
      setScriptConfirm(null)
      startLoadingAnim(2)
      setPolling(true)
      Taro.showToast({ title: '已确认，开始生成视频', icon: 'none' })
    } catch (err) {
      Taro.showToast({ title: err instanceof Error ? err.message : '确认失败，请重试', icon: 'none' })
    }
  }, [scriptConfirm, petId, startLoadingAnim])

  /** 放弃分镜脚本：二次确认后终止任务（放弃发生在视频生成之前，不产生视频费用，服务端自动退款） */
  const handleRejectScript = useCallback(() => {
    Taro.showModal({
      title: '放弃本次生成？',
      content: '放弃后本次任务作废，已支付费用将自动原路退回，可重新提交生成',
      confirmText: '放弃',
      cancelText: '再想想',
      success: async (modalRes) => {
        if (!modalRes.confirm || !scriptConfirm || !petId) return

        try {
          await rejectScript(petId, scriptConfirm.taskId)
          setScriptConfirm(null)
          handleReset()
          Taro.showToast({ title: '已放弃，费用将自动退回', icon: 'none' })
        } catch (err) {
          Taro.showToast({ title: err instanceof Error ? err.message : '操作失败，请重试', icon: 'none' })
        }
      },
    })
  }, [scriptConfirm, petId, handleReset])

  const handlePlayVideo = useCallback(() => {
    if (outputUrl) {
      Taro.previewMedia({
        sources: [{ url: outputUrl, type: 'video' }],
        current: 0,
      }).catch(() => {
        Taro.showToast({ title: '视频播放失败', icon: 'none' })
      })
    }
  }, [outputUrl])

  // ==================== 渲染参考样例视频区（顶部，2026-09-09） ====================

  const renderSampleVideo = () => (
    <View
      className='memoir-vlog__sample'
      onClick={() => {
        if (SAMPLE_VIDEO_URL) {
          Taro.previewMedia({ sources: [{ url: SAMPLE_VIDEO_URL, type: 'video' }] }).catch(() => {})
        } else {
          Taro.showToast({ title: '示例视频制作中，敬请期待', icon: 'none' })
        }
      }}
    >
      <View className='memoir-vlog__sample-glow' />
        <PageBackground />
      <View className='memoir-vlog__sample-fallback'>
        <Text className='memoir-vlog__sample-emoji'>🎞️</Text>
        <Text className='memoir-vlog__sample-label'>参考样例 · AI 时光电影</Text>
        <Text className='memoir-vlog__sample-hint'>点击观看示例成片</Text>
      </View>
      <View className='memoir-vlog__sample-play'><Text>▶</Text></View>
    </View>
  )

  // ==================== 渲染步骤指示器 ====================

  const renderStepIndicator = () => (
    <View className='memoir-vlog__steps'>
      {STEP_LABELS.map((label, i) => (
        <View key={label} style={{ display: 'flex', alignItems: 'center', gap: '12rpx' }}>
          <View
            className={`memoir-vlog__step-dot${
              i === step ? ' memoir-vlog__step-dot--active' : ''
            }${i < step ? ' memoir-vlog__step-dot--done' : ''}`}
          />
          {i < STEP_LABELS.length - 1 && (
            <View className='memoir-vlog__step-connector' />
          )}
        </View>
      ))}
    </View>
  )

  // ==================== 步骤0：素材盘点 ====================

  const renderStepMaterial = () => {
    if (checkingMaterial) {
      return (
        <View className='memoir-vlog__step-enter'>
          <Text className='memoir-vlog__title'>素材盘点中...</Text>
          <View className='memoir-vlog__material-loading'>
            <Icon name='magnifying-glass' size={36} tone='primary' className='memoir-vlog__material-loading-icon' />
            <Text className='memoir-vlog__material-loading-text'>正在盘点你们的回忆素材</Text>
          </View>
        </View>
      )
    }

    const profileCount = material?.profile_photo_count ?? 0
    const momentPhotoCount = material?.moment_photo_count ?? 0
    const momentCount = material?.moment_with_description_count ?? 0
    const suggested = material?.suggested_tier
    const suggestedMeta = suggested ? TIER_META[suggested] : null

    return (
      <View className='memoir-vlog__step-enter'>
        <Text className='memoir-vlog__title'>开始前，先看看 <Text className='gold-accent'>你们的素材</Text></Text>
        <Text className='memoir-vlog__hint'>真实素材决定回忆录的品质，AI 只用你的真实照片和回忆讲故事</Text>

        <View className='memoir-vlog__material-cards'>
          <View className='memoir-vlog__material-card'>
            <Text className='memoir-vlog__material-num'>{profileCount}</Text>
            <Text className='memoir-vlog__material-label'>档案照片</Text>
          </View>
          <View className='memoir-vlog__material-card'>
            <Text className='memoir-vlog__material-num'>{momentPhotoCount}</Text>
            <Text className='memoir-vlog__material-label'>时光线照片</Text>
          </View>
          <View className='memoir-vlog__material-card'>
            <Text className='memoir-vlog__material-num'>{momentCount}</Text>
            <Text className='memoir-vlog__material-label'>时光线回忆</Text>
          </View>
        </View>

        {suggestedMeta && (
          <View className='memoir-vlog__material-suggest'>
            <Text className='memoir-vlog__material-suggest-title'>
              {suggestedMeta.emoji} 建议「{suggestedMeta.name}」
            </Text>
            <Text className='memoir-vlog__material-suggest-reason'>
              {material?.suggestion_reason}
            </Text>
          </View>
        )}

        <View className='memoir-vlog__material-tips'>
          <Text className='memoir-vlog__material-tip'>📷 没有合适的照片？下一步可以从库内勾选</Text>
          <Text className='memoir-vlog__material-tip'>📝 补写时光线回忆，旁白就能讲真实故事</Text>
        </View>
      </View>
    )
  }

  // ==================== 步骤1：选照片 ====================

  const renderStepPhoto = () => {
    const rec = recommendTier(photos.length)
    const recMeta = rec ? TIER_META[rec] : null

    return (
      <View className='memoir-vlog__step-enter'>
        <View className='memoir-vlog__photo-header'>
          <Text className='memoir-vlog__title'>
            选择照片·<Text className='gold-accent'>{pageTierName} {PHOTO_MIN}-{PHOTO_LIMIT} 张</Text>
          </Text>
          <Text className='memoir-vlog__photo-count'>已选 {photos.length}/{PHOTO_LIMIT} 张</Text>
        </View>
        <Text className='memoir-vlog__hint'>
          {recMeta
            ? `当前可选：${recMeta.name}（${recMeta.desc}）`
            : `照片数量需 ${PHOTO_MIN}-${PHOTO_LIMIT} 张，请补充后再继续`}
        </Text>

        {/* 档位精选指引：告诉用户挑什么样的照片最出片（张数按本页档位取，不再写死标准档 5-7） */}
        <View className='memoir-vlog__pick-guide'>
          <Text className='memoir-vlog__pick-guide-title'>📌 这样挑最出片</Text>
          <Text className='memoir-vlog__pick-guide-item'>· {PHOTO_MIN}-{PHOTO_LIMIT} 张**成长节点**：到家、生日、学会新技能的瞬间</Text>
          <Text className='memoir-vlog__pick-guide-item'>· 混搭**生活日常**：吃饭、发呆、玩耍——越真实越动人</Text>
          <Text className='memoir-vlog__pick-guide-item'>· 选**清晰正面**、光线好的；模糊背影尽量不选</Text>
        </View>

        {/* 双 tab：本地上传 / 库内勾选（设计 §五 步骤1） */}
        <View className='memoir-vlog__photo-tabs'>
          <View
            className={`memoir-vlog__photo-tab${photoTab === 'local' ? ' memoir-vlog__photo-tab--active' : ''}`}
            onClick={() => setPhotoTab('local')}
          >
            <Text>📷 本地上传</Text>
          </View>
          <View
            className={`memoir-vlog__photo-tab${photoTab === 'pool' ? ' memoir-vlog__photo-tab--active' : ''}`}
            onClick={() => setPhotoTab('pool')}
          >
            <Text>🗂️ 库内勾选</Text>
          </View>
        </View>

        {photoTab === 'local' ? (
          <View className='memoir-vlog__photo-grid'>
            {/* 不过滤直接 map：key 用稳定 photo.key（删除后其余照片的 key 不变，上传回写不错位） */}
            {photos.map((photo) => (
              <View
                key={photo.key}
                className='memoir-vlog__photo-item'
                onClick={() => handlePreviewPhoto(photos.findIndex(p => p.key === photo.key))}
              >
                <Image
                  className='memoir-vlog__photo-image'
                  src={photo.path}
                  mode='aspectFill'
                />
                {/* 本地照片上传状态徽标（库内照片 uploading 恒 false 无徽标） */}
                {photo.uploading && (
                  <View className='memoir-vlog__photo-badge memoir-vlog__photo-badge--uploading'>
                    <Text>上传中</Text>
                  </View>
                )}
                {photo.failed && (
                  <View
                    className='memoir-vlog__photo-badge memoir-vlog__photo-badge--failed'
                    onClick={(e) => {
                      e.stopPropagation()
                      handleRetryUpload(photo.key)
                    }}
                  >
                    <Text>失败·点重试</Text>
                  </View>
                )}
                <View
                  className='memoir-vlog__photo-delete'
                  onClick={(e) => {
                    e.stopPropagation()
                    handleDeletePhoto(photos.findIndex(p => p.key === photo.key))
                  }}
                >
                  ✕
                </View>
              </View>
            ))}

            {photos.length < PHOTO_LIMIT && (
              <View className='memoir-vlog__photo-add' onClick={handleAddPhoto}>
                <Text className='memoir-vlog__photo-add-icon'>+</Text>
                <Text className='memoir-vlog__photo-add-text'>
                  {photos.length === 0 ? '添加照片' : '继续添加'}
                </Text>
              </View>
            )}
          </View>
        ) : (
          <View className='memoir-vlog__pool'>
            {loadingPool && (
              <Text className='memoir-vlog__pool-loading'>库内照片加载中...</Text>
            )}
            {!loadingPool && poolLoadFailed && (
              <View className='memoir-vlog__pool-retry' onClick={handleRetryPool}>
                <Text className='memoir-vlog__pool-retry-text'>库内照片加载失败，点击重试</Text>
              </View>
            )}
            {!loadingPool && !poolLoadFailed && photoPool && photoPool.profile_photos.length === 0 && photoPool.moment_photos.length === 0 && (
              <Text className='memoir-vlog__pool-empty'>库里还没有照片，先在本地上传吧</Text>
            )}
            {photoPool && photoPool.profile_photos.length > 0 && (
              <>
                <Text className='memoir-vlog__pool-section'>🏠 档案相册</Text>
                <View className='memoir-vlog__pool-grid'>
                  {/* 勾选提交用 Raw 原始路径（服务端返回值），展示用补全后的绝对 URL */}
                  {photoPool.profilePhotosRaw.map((rawUrl, i) => {
                    const displayUrl = photoPool.profile_photos[i]
                    const selected = photos.some(p => p.remoteUrl === rawUrl)
                    return (
                      <View
                        key={rawUrl}
                        className={`memoir-vlog__pool-item${selected ? ' memoir-vlog__pool-item--selected' : ''}`}
                        onClick={() => togglePoolPhoto(rawUrl, displayUrl)}
                      >
                        <Image className='memoir-vlog__pool-img' src={displayUrl} mode='aspectFill' />
                        {selected && <View className='memoir-vlog__pool-check'><Text>✓</Text></View>}
                      </View>
                    )
                  })}
                </View>
              </>
            )}
            {photoPool && photoPool.moment_photos.length > 0 && (
              <>
                <Text className='memoir-vlog__pool-section'>🕰️ 时光线照片</Text>
                <View className='memoir-vlog__pool-grid'>
                  {photoPool.momentPhotosRaw.map((m, i) => {
                    const displayUrl = photoPool.moment_photos[i].url
                    const selected = photos.some(p => p.remoteUrl === m.url)
                    return (
                      <View
                        key={`${m.moment_id}-${m.url}`}
                        className={`memoir-vlog__pool-item${selected ? ' memoir-vlog__pool-item--selected' : ''}`}
                        onClick={() => togglePoolPhoto(m.url, displayUrl)}
                      >
                        <Image className='memoir-vlog__pool-img' src={displayUrl} mode='aspectFill' />
                        <Text className='memoir-vlog__pool-day'>{m.day}</Text>
                        {selected && <View className='memoir-vlog__pool-check'><Text>✓</Text></View>}
                      </View>
                    )
                  })}
                </View>
              </>
            )}
          </View>
        )}
      </View>
    )
  }

  // ==================== 步骤2：选记忆 ====================

  const renderStepMoments = () => {
    const moments = material?.moments ?? []

    return (
      <View className='memoir-vlog__step-enter'>
        <Text className='memoir-vlog__title'>选几段 <Text className='gold-accent'>真实回忆</Text></Text>
        <Text className='memoir-vlog__hint'>
          勾选的回忆会作为旁白的锚点讲进视频里（{selectedMomentIds.length}/{MAX_MOMENTS}）；不勾选则由 AI 按标签和照片自由编排
        </Text>

        {materialFailed ? (
          <View className='memoir-vlog__moments-empty'>
            <Icon name='warning' size={36} tone='primary' className='memoir-vlog__moments-empty-icon' />
            <Text className='memoir-vlog__moments-empty-text'>回忆列表加载失败</Text>
            <View className='memoir-vlog__pool-retry' style={{ marginTop: '24rpx' }} onClick={handleRetryMaterial}>
              <Text className='memoir-vlog__pool-retry-text'>点击重试</Text>
            </View>
          </View>
        ) : moments.length === 0 ? (
          <View className='memoir-vlog__moments-empty'>
            <Icon name='book-open' size={36} tone='primary' className='memoir-vlog__moments-empty-icon' />
            <Text className='memoir-vlog__moments-empty-text'>
              还没有写过回忆。去「时光线」补写几条，回忆录的旁白就能讲你们真实的故事
            </Text>
          </View>
        ) : (
          <View className='memoir-vlog__moments-list'>
            {moments.map((m) => {
              const active = selectedMomentIds.includes(m.id)
              return (
                <View
                  key={m.id}
                  className={`memoir-vlog__moment${active ? ' memoir-vlog__moment--active' : ''}`}
                  onClick={() => toggleMoment(m.id)}
                >
                  <View className={`memoir-vlog__moment-check${active ? ' memoir-vlog__moment-check--on' : ''}`}>
                    {active && <Text>✓</Text>}
                  </View>
                  <View className='memoir-vlog__moment-body'>
                    <Text className='memoir-vlog__moment-summary'>{m.summary || '（无描述）'}</Text>
                    <View className='memoir-vlog__moment-meta'>
                      <Text className='memoir-vlog__moment-day'>{m.day}</Text>
                      {m.has_photo && <Text className='memoir-vlog__moment-photo'>📷 有照片</Text>}
                    </View>
                  </View>
                </View>
              )
            })}
          </View>
        )}
      </View>
    )
  }

  // ==================== 步骤3：写叙事文字 ====================

  const renderStepNarrative = () => (
    <View className='memoir-vlog__step-enter'>
      <Text className='memoir-vlog__title'>写下你想说的故事</Text>
      <Text className='memoir-vlog__hint'>AI 会优先使用你在小程序里沉淀的回忆生成旁白</Text>

      {/* 回忆标签：勾选后服务端按标签取真实记忆作叙事素材，无标签则用全部记忆 */}
      <View className='memoir-vlog__tags'>
        <Text className='memoir-vlog__tags-title'>它属于哪些回忆？（可多选，让旁白更懂你们）</Text>
        <View className='memoir-vlog__tags-list'>
          {MEMOIR_TAG_OPTIONS.map((tag) => {
            const active = selectedTags.includes(tag.key)
            return (
              <View
                key={tag.key}
                className={`memoir-vlog__tag${active ? ' memoir-vlog__tag--active' : ''}`}
                onClick={() => toggleTag(tag.key)}
              >
                <Text>{tag.emoji} {tag.label}{active ? ' ✓' : ''}</Text>
              </View>
            )
          })}
        </View>
      </View>

      <Textarea
        className='memoir-vlog__narrative-textarea'
        placeholder='写下你们的真实回忆（到家的那天、最爱的玩具、生过的病、去过的地方…），旁白将优先使用你的回忆；留空则只基于照片事实生成，不会编故事。'
        value={narrative}
        onInput={(e) => {
          const val = e.detail.value
          if (val.length <= NARRATIVE_MAX_LENGTH) {
            setNarrative(val)
          }
        }}
        maxlength={NARRATIVE_MAX_LENGTH}
        autoFocus={false}
        showCount
      />
    </View>
  )

  // ==================== 步骤4：选BGM ====================

  const renderStepBGM = () => (
    <View className='memoir-vlog__step-enter'>
      <Text className='memoir-vlog__title'>选择背景音乐</Text>
      <Text className='memoir-vlog__hint'>选择一首你喜欢的背景音乐</Text>

      <View className='memoir-vlog__bgm-list'>
        {BGM_OPTIONS.map((bgm) => (
          <View
            key={bgm.key}
            className={`memoir-vlog__bgm-card${
              selectedBGM === bgm.key ? ' memoir-vlog__bgm-card--active' : ''
            }`}
            onClick={() => setSelectedBGM(bgm.key)}
          >
            <View className='memoir-vlog__bgm-card-emoji'>
              <Text>{bgm.emoji}</Text>
            </View>
            <View className='memoir-vlog__bgm-card-info'>
              <Text className='memoir-vlog__bgm-card-name'>{bgm.name}</Text>
              <Text className='memoir-vlog__bgm-card-tag'>{bgm.tag}</Text>
            </View>
            <View
              className={`memoir-vlog__bgm-card-preview${playingBGM === bgm.key ? ' memoir-vlog__bgm-card-preview--playing' : ''}`}
              onClick={(e) => {
                e.stopPropagation()
                handleBGMPreview(bgm.key, bgm.previewUrl)
              }}
            >
              <Text>{playingBGM === bgm.key ? '⏸' : '▶'}</Text>
            </View>
            <View
              className={`memoir-vlog__bgm-card-check${
                selectedBGM === bgm.key ? ' memoir-vlog__bgm-card-check--checked' : ''
              }`}
            >
              {selectedBGM === bgm.key && <Text>✓</Text>}
            </View>
          </View>
        ))}
      </View>
      {/* 用户导入 BGM（2026-09-09 版权归用户）：卡片选中即用自定义音频，生成合成优先使用 */}
      <View
        className={`memoir-vlog__bgm-card memoir-vlog__bgm-card--custom${
          selectedBGM === 'custom' ? ' memoir-vlog__bgm-card--active' : ''
        }`}
        onClick={() => customBgmUrl && setSelectedBGM('custom')}
      >
        <View className='memoir-vlog__bgm-card-emoji'><Text>🎤</Text></View>
        <View className='memoir-vlog__bgm-card-info'>
          <Text className='memoir-vlog__bgm-card-name'>{customBgmUrl ? `我的音乐：${customBgmName}` : '导入我的音乐'}</Text>
          <Text className='memoir-vlog__bgm-card-tag'>{customBgmUrl ? '已导入' : '用你喜欢/有意义的歌'}</Text>
        </View>
        <View className='memoir-vlog__bgm-btn' onClick={(e) => { e.stopPropagation(); handleImportBGM() }}>
          <Text>{uploadingBgm ? '上传中...' : customBgmUrl ? '重新导入' : '🎵 导入'}</Text>
        </View>
        <View className={`memoir-vlog__bgm-card-check${selectedBGM === 'custom' ? ' memoir-vlog__bgm-card-check--checked' : ''}`}>
          {selectedBGM === 'custom' && <Text>✓</Text>}
        </View>
      </View>
      {customBgmUrl && (
        <Text style={{ marginTop: '8rpx', fontSize: '20rpx', color: '#999' }}>
          你导入的音频版权归你所有，请确认拥有其授权；生成将使用这段音乐。
        </Text>
      )}

      {/* B 级曲目（CC BY 3.0）需署名：来源说明常驻展示，满足授权要求 */}
      <Text style={{ marginTop: '16rpx', fontSize: '20rpx', color: '#999' }}>
        音乐：Kevin MacLeod（incompetech.com）· CC BY 3.0
      </Text>

      {/* 画风/氛围选择（2026-09-09 用户拍板 4 画风；影响分镜 GLOBAL STYLE 质感） */}
      <View className='memoir-vlog__style-section'>
        <Text className='memoir-vlog__style-title'>🎬 选择画风</Text>
        <View className='memoir-vlog__style-list'>
          {STYLE_OPTIONS.map((style) => (
            <View
              key={style.key}
              className={`memoir-vlog__style-chip${
                selectedStyle === style.key ? ' memoir-vlog__style-chip--active' : ''
              }`}
              onClick={() => setSelectedStyle(style.key)}
            >
              <Text className='memoir-vlog__style-chip-emoji'>{style.emoji}</Text>
              <Text className='memoir-vlog__style-chip-name'>{style.name}</Text>
              <Text className='memoir-vlog__style-chip-desc'>{style.desc}</Text>
            </View>
          ))}
        </View>
      </View>
    </View>
  )

  // ==================== 步骤5：确认与支付（三档卡） ====================

  const renderStepConfirm = () => {
    const narrativeSummary = narrative.trim()
      ? narrative.trim().substring(0, 20) + '...'
      : '无'
    const isMember = pricing?.isMember ?? false

    return (
      <View className='memoir-vlog__step-enter'>
        <Text className='memoir-vlog__title'>选择档位，确认制作</Text>
        <Text className='memoir-vlog__hint'>按你已选的 {photos.length} 张照片，三档可选范围如下</Text>

        {/* 三档卡（2026-09-09 三档定价）：不可用档置灰+原因，默认推荐最重可用档 */}
        <View className='memoir-vlog__tier-list'>
          {MEMOIR_TIER_ORDER.map((tier) => {
            const meta = TIER_META[tier]
            const available = isTierAvailable(tier, photos.length)
            const active = selectedTier === tier
            const price = pricing?.prices ? pickTierPrice(pricing.prices, tier, isMember) : null
            return (
              <View
                key={tier}
                className={`memoir-vlog__tier-card${
                  active ? ' memoir-vlog__tier-card--active' : ''
                }${!available ? ' memoir-vlog__tier-card--disabled' : ''}`}
                onClick={() => {
                  if (!available) {
                    Taro.showToast({ title: tierUnavailableReason(tier, photos.length), icon: 'none' })
                    return
                  }
                  setSelectedTier(tier)
                }}
              >
                <View className='memoir-vlog__tier-head'>
                  <Text className='memoir-vlog__tier-name'>{meta.emoji} {meta.name}</Text>
                  {price !== null && (
                    <Text className='memoir-vlog__tier-price'>
                      ¥{formatYuan(price)}<Text className='memoir-vlog__tier-price-suffix'>/次</Text>
                    </Text>
                  )}
                </View>
                <Text className='memoir-vlog__tier-desc'>{meta.desc}</Text>
                {!available && (
                  <Text className='memoir-vlog__tier-unavailable'>{tierUnavailableReason(tier, photos.length)}</Text>
                )}
                {isMember && available && price !== null && (
                  <Text className='memoir-vlog__tier-member-tag'>会员价</Text>
                )}
              </View>
            )
          })}
        </View>

        <View className='memoir-vlog__confirm-summary'>
          <View className='memoir-vlog__confirm-item'>
            <Icon name='camera' size={16} tone='primary' className='memoir-vlog__confirm-item-icon' />
            <View style={{ flex: 1 }}>
              <Text className='memoir-vlog__confirm-item-text'>{photos.length}张照片</Text>
              <Text className='memoir-vlog__confirm-item-label'>本地与库内照片将按顺序编排</Text>
            </View>
          </View>

          <View className='memoir-vlog__confirm-item'>
            <Icon name='book-open' size={16} tone='primary' className='memoir-vlog__confirm-item-icon' />
            <View style={{ flex: 1 }}>
              <Text className='memoir-vlog__confirm-item-text'>
                {selectedMomentIds.length > 0 ? `已勾选 ${selectedMomentIds.length} 条回忆` : '未勾选回忆'}
              </Text>
              <Text className='memoir-vlog__confirm-item-label'>
                {selectedMomentIds.length > 0 ? '旁白将围绕勾选的回忆讲述' : 'AI 按标签与照片自由编排'}
              </Text>
            </View>
          </View>

          <View className='memoir-vlog__confirm-item'>
            <Text className='memoir-vlog__confirm-item-icon'>✍</Text>
            <View style={{ flex: 1 }}>
              <Text className='memoir-vlog__confirm-item-text'>叙事文字：{narrativeSummary}</Text>
              <Text className='memoir-vlog__confirm-item-label'>AI会根据文字编排视频叙事</Text>
            </View>
          </View>

          <View className='memoir-vlog__confirm-item'>
            <Text className='memoir-vlog__confirm-item-icon'>🎵</Text>
            <View style={{ flex: 1 }}>
              <Text className='memoir-vlog__confirm-item-text'>
                已选BGM：{BGM_OPTIONS.find(b => b.key === selectedBGM)?.name || selectedBGM}
              </Text>
              <Text className='memoir-vlog__confirm-item-label'>背景音乐</Text>
            </View>
          </View>
        </View>

        {/* 提示词人机协同（2026-09-09 块①）：生成前预览→多轮修改→确认最终版才可支付 */}
        <View className='memoir-vlog__prompt-confirm'>
          <View className='memoir-vlog__prompt-confirm-head'>
            <Text className='memoir-vlog__prompt-confirm-title'>🧠 提示词确认</Text>
            <Text className='memoir-vlog__prompt-confirm-version'>
              {promptScript ? `第 ${promptVersion} 版` : '未预览'}
            </Text>
          </View>

          {!promptScript ? (
            <Text className='memoir-vlog__prompt-confirm-hint'>
              生成前我们会按照片+风格+BGM 生成提示词；请先预览，确认无误后再生成
            </Text>
          ) : (
            <View className='memoir-vlog__prompt-segments'>
              {promptScript.segments.map((seg, i) => (
                <View key={i} className='memoir-vlog__prompt-segment'>
                  <Text className='memoir-vlog__prompt-segment-label'>第 {seg.photo_index + 1} 镜</Text>
                  <Text className='memoir-vlog__prompt-segment-text'>{seg.seedance_prompt}</Text>
                  {seg.narration && (
                    <Text className='memoir-vlog__prompt-segment-narr'>旁白：{seg.narration}</Text>
                  )}
                </View>
              ))}
            </View>
          )}

          <View className='memoir-vlog__prompt-actions'>
            <View
              className='memoir-vlog__prompt-btn memoir-vlog__prompt-btn--ghost'
              onClick={handlePreviewPrompt}
            >
              <Text>{previewingPrompt ? '生成中...' : promptScript ? '重新预览' : '预览提示词'}</Text>
            </View>
            {promptScript && (
              <View
                className='memoir-vlog__prompt-btn memoir-vlog__prompt-btn--ghost'
                onClick={handleConfirmPrompt}
              >
                <Text>{promptConfirmed ? '✓ 已确认' : '确认最终版'}</Text>
              </View>
            )}
          </View>

          {promptScript && !promptConfirmed && (
            <>
              <View className='memoir-vlog__prompt-refine-row'>
                <Text className='memoir-vlog__prompt-refine-label'>哪里要改？</Text>
                <View
                  className='memoir-vlog__prompt-btn memoir-vlog__prompt-btn--gold'
                  onClick={handleRefinePrompt}
                >
                  <Text>{previewingPrompt ? '生成中...' : `生成下一版`}</Text>
                </View>
              </View>
              <View className='memoir-vlog__prompt-input-wrap'>
                <Textarea
                  className='memoir-vlog__prompt-input'
                  placeholder='例如：第一镜改成傍晚光线，氛围更温馨一点'
                  placeholderClass='memoir-vlog__prompt-input-placeholder'
                  value={promptDraft}
                  onInput={(e) => setPromptDraft(e.detail.value)}
                  maxlength={200}
                />
              </View>
            </>
          )}

          {promptConfirmed && (
            <Text className='memoir-vlog__prompt-confirm-ok'>✓ 已确认最终版，将按此版生成</Text>
          )}
        </View>
      </View>
    )
  }

  // ==================== 步骤6：生成结果 ====================

  const renderStepResult = () => (
    <View className='memoir-vlog__step-enter'>
      <Text className='memoir-vlog__title' style={{ textAlign: 'center' }}>✨ <Text className='gold-accent'>制作完成</Text></Text>
      <Text className='memoir-vlog__hint' style={{ textAlign: 'center' }}>纪念Vlog已生成，快来分享吧</Text>

      <View className='memoir-vlog__result-preview'>
        {outputUrl ? (
          <>
            <Image className='memoir-vlog__result-image' src={outputUrl} mode='aspectFill' />
            <View className='memoir-vlog__result-play-btn' onClick={handlePlayVideo}>
              ▶
            </View>
          </>
        ) : (
          <View className='memoir-vlog__result-placeholder'>
            <Icon name='film-strip' size={36} tone='primary' className='memoir-vlog__result-placeholder-icon' />
            <Text className='memoir-vlog__result-placeholder-text'>纪念Vlog已生成</Text>
          </View>
        )}
      </View>

      <View className='memoir-vlog__result-actions'>
        <View className='memoir-vlog__btn memoir-vlog__btn--gold' onClick={handleShare}>
          <Text className='memoir-vlog__btn-text'>📤 分享</Text>
        </View>
        <View className='memoir-vlog__btn memoir-vlog__btn--secondary' onClick={handleReset}>
          <Text className='memoir-vlog__btn-text'>🔄 重新制作</Text>
        </View>
      </View>
    </View>
  )

  // ==================== 底部按钮 ====================

  const renderFooter = () => {
    // 步骤0：素材盘点 → 开始制作（有素材即可进入；本地上传不受盘点结果限制）
    if (step === 0) {
      return (
        <View
          className='memoir-vlog__btn memoir-vlog__btn--primary'
          onClick={() => goToStep(1)}
        >
          <Text className='memoir-vlog__btn-text'>开始制作</Text>
        </View>
      )
    }

    // 步骤1：选照片 → 有可用档位才放行（4 张等空隙照片数不给过，避免后端 400）
    if (step === 1) {
      const canNext = recommendTier(photos.length) !== null
      return (
        <View
          className={`memoir-vlog__btn memoir-vlog__btn--primary${
            !canNext ? ' memoir-vlog__btn--disabled' : ''
          }`}
          onClick={canNext ? () => goToStep(2) : undefined}
        >
          <Text className='memoir-vlog__btn-text'>
            {canNext ? '下一步' : '照片数需为 1-3 / 5-7 / 8-15 张'}
          </Text>
        </View>
      )
    }

    // 步骤2：选记忆 → 可跳过（不勾选走 AI 自由编排）
    if (step === 2) {
      return (
        <View
          className='memoir-vlog__btn memoir-vlog__btn--primary'
          onClick={() => goToStep(3)}
        >
          <Text className='memoir-vlog__btn-text'>
            {selectedMomentIds.length > 0 ? `已选 ${selectedMomentIds.length} 条 · 下一步` : '跳过 · 下一步'}
          </Text>
        </View>
      )
    }

    if (step === 3) {
      return (
        <View
          className='memoir-vlog__btn memoir-vlog__btn--primary'
          onClick={() => goToStep(4)}
        >
          <Text className='memoir-vlog__btn-text'>下一步</Text>
        </View>
      )
    }

    if (step === 4) {
      return (
        <View
          className='memoir-vlog__btn memoir-vlog__btn--primary'
          onClick={() => goToStep(5)}
        >
          <Text className='memoir-vlog__btn-text'>下一步</Text>
        </View>
      )
    }

    // 步骤5：确认支付（金额以所选档位为准；价格未就绪时隐藏金额仅显示动作）
    if (step === 5) {
      const isMember = pricing?.isMember ?? false
      const price = selectedTier && pricing?.prices
        ? pickTierPrice(pricing.prices, selectedTier, isMember)
        : null
      return (
        <View
          className={`memoir-vlog__btn memoir-vlog__btn--gold${
            paying || !selectedTier ? ' memoir-vlog__btn--disabled' : ''
          }`}
          onClick={paying || !selectedTier ? undefined : handlePayAndGenerate}
        >
          <Text className='memoir-vlog__btn-text'>
            {paying
              ? '正在发起支付...'
              : !selectedTier
                ? '请选择档位'
                : price !== null
                  ? `¥${formatYuan(price)} · 确认支付`
                  : '确认支付'}
          </Text>
        </View>
      )
    }

    return null
  }

  // ==================== 主渲染 ====================

  return (
    <View className='memoir-vlog'>
      {renderSampleVideo()}
      {renderStepIndicator()}

      <ScrollView
        className='memoir-vlog__content'
        scrollY
        enhanced
        showScrollbar={false}
        key={animKey}
      >
        {step === 0 && renderStepMaterial()}
        {step === 1 && renderStepPhoto()}
        {step === 2 && renderStepMoments()}
        {step === 3 && renderStepNarrative()}
        {step === 4 && renderStepBGM()}
        {step === 5 && renderStepConfirm()}
        {step === 6 && renderStepResult()}
      </ScrollView>

      {step < 6 && (
        <View className='memoir-vlog__footer'>
          {/* 上一步回退（审查 P1：7 屏漏斗不能全是单向门）；确认页回退后照片改动会由确认页 effect 重算档位 */}
          {step >= 1 && step <= 4 && (
            <View
              className='memoir-vlog__btn memoir-vlog__btn--ghost memoir-vlog__btn--half'
              onClick={() => goToStep(step - 1)}
            >
              <Text className='memoir-vlog__btn-text'>上一步</Text>
            </View>
          )}
          <View style={{ flex: 1 }}>
            {renderFooter()}
          </View>
        </View>
      )}

      {loading && (
        <View className='memoir-vlog__loading-overlay'>
          <View className='memoir-vlog__loading-spinner' />
          <Text className='memoir-vlog__loading-text'>
            {loadingText || 'AI正在为你创作专属纪念Vlog...'}
          </Text>
          <View className='memoir-vlog__loading-progress'>
            {LOADING_STEPS.map((s, i) => (
              <Text
                key={s}
                className={`memoir-vlog__loading-step${
                  i < loadingStepIndex ? ' memoir-vlog__loading-step--done' : ''
                }${i === loadingStepIndex ? ' memoir-vlog__loading-step--active' : ''}`}
              >
                {i <= loadingStepIndex ? '✓ ' : '○ '}{s}
              </Text>
            ))}
          </View>
        </View>
      )}

      {/*
        剧本确认卡（立项 v0.2 P0-2）：分镜已生成、视频未烧钱，让用户确认后再生成；
        覆盖在页面上层，确认/放弃前不可操作页面（与 loading 同级遮罩）
      */}
      {scriptConfirm && (
        <View className='memoir-vlog__script-overlay'>
          <View className='memoir-vlog__script-card'>
            <Text className='memoir-vlog__script-title'>🎬 剧本已生成，请确认</Text>
            <Text className='memoir-vlog__script-sub'>
              「{scriptConfirm.title}」{scriptConfirm.theme ? ` · ${scriptConfirm.theme}` : ''}
              {' '}· 共 {scriptConfirm.segments.length} 个镜头，确认后开始生成视频（生成后不支持退款）
            </Text>
            <ScrollView scrollY className='memoir-vlog__script-list'>
              {scriptConfirm.segments.map((seg, i) => (
                <View key={i} className='memoir-vlog__script-seg'>
                  <Text className='memoir-vlog__script-seg-head'>
                    镜头 {i + 1} · 第 {(seg?.photo_index ?? 0) + 1} 张照片 · {seg?.duration_sec ?? 5} 秒
                  </Text>
                  {!!seg?.narration && (
                    <Text className='memoir-vlog__script-seg-narr'>{seg.narration}</Text>
                  )}
                  {!!seg?.subtitle && (
                    <Text className='memoir-vlog__script-seg-sub'>字幕：{seg.subtitle}</Text>
                  )}
                </View>
              ))}
              {scriptConfirm.segments.length === 0 && (
                <Text className='memoir-vlog__script-empty'>脚本内容为空，建议放弃后重新生成</Text>
              )}
            </ScrollView>
            <View className='memoir-vlog__script-actions'>
              <View
                className='memoir-vlog__script-btn memoir-vlog__script-btn--ghost'
                onClick={handleRejectScript}
              >
                <Text className='memoir-vlog__script-btn-text memoir-vlog__script-btn-text--ghost'>放弃</Text>
              </View>
              <View
                className='memoir-vlog__script-btn memoir-vlog__script-btn--primary'
                onClick={handleConfirmScript}
              >
                <Text className='memoir-vlog__script-btn-text'>确认生成</Text>
              </View>
            </View>
          </View>
        </View>
      )}
    </View>
  )
}
