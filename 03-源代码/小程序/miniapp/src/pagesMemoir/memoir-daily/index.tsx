/**
 * 轻纪念页面（回忆录馆「轻纪念」档流程，按高保真原型 1:1 重构）
 * 标题区 + hero + 双产品线卡 + 三步流程（上传素材 → AI生成 → 预览保存）
 * 保留完整业务：照片选择、风格/BGM、Ken Burns 预览、生成任务、WS+轮询、保存分享
 * 2026-09-09 B2：生成改为三档定价支付链（light 档：下单→微信支付→轮询回调创建的任务），
 * 本地照片先上传服务器再提交（wxfile:// 会被后端 source_photos 白名单拒绝）
 */
import { View, Text, ScrollView, Canvas, Image, Textarea } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { useState, useEffect, useRef, useCallback } from 'react'
import { CONFIG } from '../../config'
import { MEMOIR_TAG_OPTIONS } from '../../constants/memoirTags'
import { chooseImageWithPrivacy } from '../../utils/privacy'
import { wsClient } from '../../services/wsClient'
import { timelineService } from '../../services/timelineService'
import { useThemeClass } from '../../hooks/useThemeClass'
import { usePetStore } from '../../stores/petStore'
import {
  uploadLocalPhoto,
  createMemoirOrder,
  payWithWechat,
  waitForNewTask,
  getLatestStatus,
  snapshotLatestTaskId,
  getMemoirPricing,
  type MemoirPricing,
} from '../../services/memoirService'
import { pickTierPrice, formatYuan } from '../../utils/memoirTier'
import './index.scss'
import PageBackground from '../../components/PageBackground'
import { Icon } from '../../components'

// ==================== 类型定义 ====================

/** 预设风格 */
interface MemoirStyle {
  key: string
  emoji: string
  name: string
  desc: string
}

/** BGM 选项 */
interface BGMOption {
  key: string
  emoji: string
  name: string
  tag: string
  previewUrl: string
}

/** 已选照片项：本地照片需上传换 remoteUrl（wxfile:// 无法进 source_photos 白名单） */
interface PhotoItem {
  /** 稳定唯一 key（上传回写按 key 匹配——按 index 回写在删除照片后会错位写脏其他照片） */
  key: string
  path: string
  size: number
  /** 上传后的服务端相对路径（提交用） */
  remoteUrl?: string
  /** 上传中 */
  uploading?: boolean
  /** 上传失败（点击重试） */
  failed?: boolean
}

// ==================== 常量 ====================

const STYLE_OPTIONS: MemoirStyle[] = [
  { key: 'warm', emoji: '🎠', name: '温馨回忆', desc: '柔和的淡入淡出 + 缓慢缩放' },
  { key: 'joyful', emoji: '🎪', name: '欢乐时光', desc: '活泼的弹跳 + 旋转' },
  { key: 'sunset', emoji: '🌅', name: '温暖夕阳', desc: '暖色调滤镜 + 渐显' },
  { key: 'night', emoji: '🌙', name: '静谧之夜', desc: '暗色调 + 柔和光晕' },
]

// 背景音乐（全部为 incompetech.com 的 Kevin MacLeod 作品，CC BY 3.0 免费可商用，需署名）
const BGM_OPTIONS: BGMOption[] = [
  { key: 'piano', emoji: '🎵', name: '温柔时光', tag: '钢琴曲', previewUrl: `${CONFIG.ASSETS_BASE_URL}/bgm/piano-preview.mp3` },
  { key: 'guitar', emoji: '🎵', name: '暖心回忆', tag: '轻快', previewUrl: `${CONFIG.ASSETS_BASE_URL}/bgm/guitar-preview.mp3` },
  { key: 'strings', emoji: '🎵', name: '深情告白', tag: '弦乐', previewUrl: `${CONFIG.ASSETS_BASE_URL}/bgm/strings-preview.mp3` },
  { key: 'upbeat', emoji: '🎵', name: '欢快瞬间', tag: '轻快节奏', previewUrl: `${CONFIG.ASSETS_BASE_URL}/bgm/upbeat-preview.mp3` },
]

// 三步流程（原型：上传素材 / AI生成 / 预览保存）
const STEP_LABELS = ['上传素材', 'AI生成', '预览保存']

/** 参考样例视频（2026-09-10 用户提供的轻纪念成片案例，公网已部署 memoir-sample/） */
const SAMPLE_VIDEOS: Array<{ url: string; label: string; emoji: string }> = [
  { url: 'https://api.xinghuanhai.com/uploads/memoir-sample/sample-light-1.mp4', label: '样例一 · 静图动效', emoji: '🎬' },
  { url: 'https://api.xinghuanhai.com/uploads/memoir-sample/sample-light-2.mp4', label: '样例二 · 温暖短片', emoji: '🎞️' },
]

// ==================== 组件 ====================

export default function MemoirDaily() {
  const themeClass = useThemeClass()
  const routerParams = Taro.getCurrentInstance().router?.params as Record<string, string> | undefined
  const petId = routerParams?.petId || ''

  // —— 步骤控制 ——
  const [step, setStep] = useState(0)
  const [animKey, setAnimKey] = useState(0)

  // —— 步骤1：选照片 ——
  const [photos, setPhotos] = useState<PhotoItem[]>([])
  const [story, setStory] = useState('')
  // 回忆标签（F4 记忆驱动）：选中的标签传给服务端按标签筛核心层记忆作分镜素材
  const [selectedTags, setSelectedTags] = useState<string[]>([])

  /** 切换回忆标签选中态（最多 8 个，与服务端 schema 上限一致） */
  const toggleTag = useCallback((key: string) => {
    setSelectedTags(prev =>
      prev.includes(key) ? prev.filter(t => t !== key) : [...prev, key],
    )
  }, [])

  // —— 步骤2：选风格 ——
  const [selectedStyle, setSelectedStyle] = useState('warm')
  const [selectedBGM, setSelectedBGM] = useState('piano')
  const [playingBGM, setPlayingBGM] = useState<string | null>(null)
  const bgmAudioRef = useRef<Taro.InnerAudioContext | null>(null)

  // —— 步骤3：预览加载 ——
  const [loading, setLoading] = useState(false)
  const [loadingText, setLoadingText] = useState('正在生成...')
  const canvasRef = useRef<any>(null)
  const animFrameRef = useRef<number | null>(null)

  // —— 步骤4：结果 ——
  const [taskId, setTaskId] = useState('')
  const [outputUrl, setOutputUrl] = useState('')
  const [polling, setPolling] = useState(false)
  /** WS 事件触发计数：收到 memoir_status 时自增，驱动立即刷新（替代等待轮询） */
  const [refreshKey, setRefreshKey] = useState(0)

  // ==================== Ken Burns 动画 ====================

  const startKenBurns = useCallback(() => {
    const canvasNode = canvasRef.current
    if (!canvasNode || photos.length === 0) return

    Taro.createSelectorQuery()
      .select('#memoirCanvas')
      .fields({ node: true, size: true })
      .exec((res) => {
        const canvas = res[0]?.node
        const ctx = canvas?.getContext('2d')
        if (!canvas || !ctx) return

        const width = res[0].width || 600
        const height = res[0].height || 480
        canvas.width = width
        canvas.height = height

        let currentIndex = 0
        let progress = 0
        const DURATION = 3000 // 每张3秒
        const SCALE_MAX = 1.15

        const images: HTMLImageElement[] = []
        let loadedCount = 0

        photos.forEach((photo) => {
          const img = canvas.createImage()
          img.src = photo.path
          img.onload = () => {
            loadedCount++
          }
          img.onerror = () => {
            loadedCount++
          }
          images.push(img)
        })

        let lastTime = Date.now()

        function draw(timestamp: number) {
          if (photos.length === 0) return

          const delta = timestamp - lastTime
          lastTime = timestamp
          progress += delta

          if (progress >= DURATION) {
            progress = 0
            currentIndex = (currentIndex + 1) % photos.length
          }

          const img = images[currentIndex]
          if (!img || !img.width) {
            animFrameRef.current = requestAnimationFrame(draw)
            return
          }

          const ratio = Math.min(progress / DURATION, 1)
          const scale = 1 + (SCALE_MAX - 1) * ratio
          const tx = (width * (scale - 1)) / 2 * 0.3
          const ty = (height * (scale - 1)) / 2 * 0.15

          ctx.clearRect(0, 0, width, height)

          // 绘制暗色背景
          ctx.fillStyle = '#1A1410'
          ctx.fillRect(0, 0, width, height)

          ctx.save()
          ctx.translate(width / 2, height / 2)
          ctx.scale(scale, scale)
          ctx.translate(-width / 2 + tx, -height / 2 + ty)

          // 将图片居中裁剪适配canvas
          const imgAspect = img.width / img.height
          const canvasAspect = width / height
          let sx = 0, sy = 0, sw = img.width, sh = img.height

          if (imgAspect > canvasAspect) {
            sw = img.height * canvasAspect
            sx = (img.width - sw) / 2
          } else {
            sh = img.width / canvasAspect
            sy = (img.height - sh) / 2
          }

          ctx.drawImage(img, sx, sy, sw, sh, 0, 0, width, height)
          ctx.restore()

          // 顶部/底部渐隐遮罩
          const gradient = ctx.createLinearGradient(0, 0, 0, height * 0.15)
          gradient.addColorStop(0, 'rgba(26,20,16,0.4)')
          gradient.addColorStop(1, 'rgba(26,20,16,0)')
          ctx.fillStyle = gradient
          ctx.fillRect(0, 0, width, height * 0.15)

          const gradientBottom = ctx.createLinearGradient(0, height * 0.85, 0, height)
          gradientBottom.addColorStop(0, 'rgba(26,20,16,0)')
          gradientBottom.addColorStop(1, 'rgba(26,20,16,0.4)')
          ctx.fillStyle = gradientBottom
          ctx.fillRect(0, height * 0.85, width, height * 0.15)

          animFrameRef.current = requestAnimationFrame(draw)
        }

        animFrameRef.current = requestAnimationFrame(draw)
      })
  }, [photos])

  // ==================== BGM 预览 ====================

  const handleBGMPreview = useCallback((bgmKey: string, previewUrl: string) => {
    if (playingBGM === bgmKey) {
      if (bgmAudioRef.current) {
        bgmAudioRef.current.stop()
        bgmAudioRef.current.destroy()
        bgmAudioRef.current = null
      }
      setPlayingBGM(null)
      return
    }
    if (bgmAudioRef.current) {
      bgmAudioRef.current.stop()
      bgmAudioRef.current.destroy()
      bgmAudioRef.current = null
    }
    const audioCtx = Taro.createInnerAudioContext()
    audioCtx.src = previewUrl
    audioCtx.autoplay = true
    audioCtx.loop = false
    audioCtx.onPlay(() => setPlayingBGM(bgmKey))
    audioCtx.onEnded(() => {
      setPlayingBGM(null)
      if (bgmAudioRef.current) { bgmAudioRef.current.destroy(); bgmAudioRef.current = null }
    })
    audioCtx.onError(() => {
      setPlayingBGM(null)
      if (bgmAudioRef.current) { bgmAudioRef.current.destroy(); bgmAudioRef.current = null }
      Taro.showToast({ title: '试听暂不可用', icon: 'none' })
    })
    bgmAudioRef.current = audioCtx
  }, [playingBGM])

  useEffect(() => {
    return () => {
      if (bgmAudioRef.current) {
        bgmAudioRef.current.stop()
        bgmAudioRef.current.destroy()
        bgmAudioRef.current = null
      }
    }
  }, [])

  // ==================== 步骤切换 ====================

  const goToStep = useCallback((next: number) => {
    setAnimKey(prev => prev + 1)
    setStep(next)
  }, [])

  // ==================== 照片操作 ====================

  /** 照片 key 自增序号（单页会话内唯一） */
  const photoKeySeq = useRef(0)
  /** 串行上传队列链尾（真正逐张错峰，防止瞬时并发触发 10次/分钟限流——审查 P2） */
  const uploadChainRef = useRef<Promise<void>>(Promise.resolve())

  /**
   * 本地照片异步上传（选完即传换服务端 URL）。加入串行队列尾逐张执行。
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
    const remain = 3 - photos.length
    if (remain <= 0) {
      Taro.showToast({ title: '最多选择3张照片', icon: 'none' })
      return
    }

    // 统一走隐私选图入口（前置 wx.requirePrivacyAuthorize 官方授权弹窗 +
    // chooseMedia 替代已废弃的 chooseImage + 失败统一提示），返回为 chooseImage 形状
    chooseImageWithPrivacy({ count: remain, sizeType: ['compressed'] })
      .then((res) => {
        const added: Array<{ key: string; filePath: string }> = []
        const newPhotos: PhotoItem[] = res.tempFiles.map((f) => {
          const key = `local_${++photoKeySeq.current}`
          added.push({ key, filePath: f.path })
          return { key, path: f.path, size: f.size || 0, uploading: true }
        })
        setPhotos(prev => [...prev, ...newPhotos].slice(0, 3))
        // 逐张进入串行上传队列
        added.forEach(({ key, filePath }) => uploadPhotoItem(key, filePath))
      })
      .catch(() => {
        // 用户取消选择/拒绝授权等已在 privacy 层反馈，此处静默
      })
  }, [photos, uploadPhotoItem])

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

  /**
   * 跳转「多段纪念管线」页（供 handleGenerate 超时引导、挂载检测、轮询闸门引导复用）
   *
   * 2026-09-12（IA 第 2d 批）：原目标 `memoir-vlog` 那条 28 行壳路由已删，改指唯一实现
   * `memoir-full`，并显式带 `tier=standard` —— 删壳前本入口落在标准档（5-7 张），
   * 不显式指定的话页面会按路由名把自己判成完整档（8-15 张），等于悄悄改档位。
   */
  const handleGoVlog = useCallback(() => {
    // 档位参数放最前；petId 仍按原逻辑可缺省
    const query = `?tier=standard${petId ? `&petId=${petId}` : ''}`
    Taro.navigateTo({ url: `/pagesMemoir/memoir-full/index${query}` })
  }, [petId])

  // ==================== 生成回忆录（2026-09-09 B2：light 档支付链） ====================

  /**
   * 轻纪念档（light）生成流程：
   * 1. 校验照片上传就绪（本地照片异步上传，可能未完成/失败）
   * 2. 快照当前最新任务 id（防旧任务干扰新任务识别）
   * 3. POST /api/payment/memoir/order（tier=light, memoir_type=daily）→ 微信支付
   * 4. 等待支付回调创建任务 → 进入既有轮询状态机
   * 旧直创建路径（POST /:petId/memoir）已废除——三档一律付费后该端点恒 402
   */
  const handleGenerate = useCallback(async () => {
    if (!petId) {
      Taro.showToast({ title: '宠物信息缺失', icon: 'none' })
      return
    }

    // 照片上传就绪校验
    const uploadingCount = photos.filter(p => p.uploading).length
    if (uploadingCount > 0) {
      Taro.showToast({ title: `还有 ${uploadingCount} 张照片上传中，请稍候`, icon: 'none' })
      return
    }
    const failedCount = photos.filter(p => p.failed).length
    if (failedCount > 0) {
      Taro.showToast({ title: `有 ${failedCount} 张照片上传失败，请点击重试`, icon: 'none' })
      return
    }

    setLoading(true)
    setLoadingText('正在下单...')

    // 提交前快照最新任务 id（严格模式：失败重试 3 次，仍失败阻断支付——
    // 审查 P1：快照失败置 null 会把库内旧任务误判为新任务，新订单反被并发互斥自动退款）
    const preTaskId = await snapshotLatestTaskId(petId)
    if (preTaskId === undefined) {
      setLoading(false)
      Taro.showModal({
        title: '网络不稳定',
        content: '无法确认当前任务状态，为避免重复扣款已暂停下单，请稍后重试',
        showCancel: false,
        confirmText: '知道了',
      })
      return
    }

    try {
      // 1. 下单（light 档：会员 18.9 / 非会员 25.9，以下单响应为准；
      // musicStyle 传 BGM key，service 内部统一转换后端枚举——审查 P0 修复点）
      const order = await createMemoirOrder({
        petId,
        memoirType: 'daily',
        tier: 'light',
        // 提交前就绪校验已保证全部 remoteUrl 就绪；此处防御性兜底必须显式报错
        // （静默回退 wxfile:// 会被服务端白名单 400，报错不可理解——审查 P2 修复点）
        sourcePhotos: photos.map(p => {
          if (!p.remoteUrl) {
            throw new Error('有照片尚未上传完成，请稍候或删除后重试')
          }
          return p.remoteUrl
        }),
        sourceText: story.trim() || undefined,
        musicStyle: selectedBGM,
        stylePreset: selectedStyle,
        tags: selectedTags.length > 0 ? selectedTags : undefined,
      })

      // 2. 拉起微信支付（false=用户取消；真实支付失败由 platform 层 reject 透传原因）
      setLoadingText('等待支付...')
      const paid = await payWithWechat(order.payment)
      if (!paid) {
        setLoading(false)
        Taro.showToast({ title: '已取消支付', icon: 'none' })
        return
      }

      // 3. 等待支付回调创建任务（1~10s 异步延迟）
      setLoadingText('支付成功，任务创建中...')
      const task = await waitForNewTask(petId, preTaskId, { maxAttempts: 45, intervalMs: 2000 })

      if (!task) {
        // 超时兜底（审查 P1 修复）：本页轮询状态机依赖 taskId（无从得知新任务 id），
        // 降级轮询在此页不可行——改为引导跳回忆录页（其挂载恢复+降级轮询+结果屏已完整）；
        // 绝不引导重新下单（原单支付成功后服务端会建任务，重下单会被并发互斥退款）
        setLoading(false)
        Taro.showModal({
          title: '生成任务确认中',
          content: '支付已受理，视频任务正在排队创建，请勿重复下单；请前往「回忆录」查看进度',
          confirmText: '去查看',
          cancelText: '留在本页',
          success: (m) => {
            if (m.confirm) handleGoVlog()
          },
        })
        return
      }

      // 4. 新任务出现 → 进入既有轮询状态机
      setTaskId(task.id)
      setLoadingText('正在处理...')
      setPolling(true)
    } catch (err) {
      // 下单失败（价格变动/校验失败/网络）：透传服务端 message
      setLoading(false)
      Taro.showToast({ title: err instanceof Error ? err.message : '支付失败，请重试', icon: 'none' })
    }
  }, [petId, photos, selectedStyle, selectedBGM, story, selectedTags, handleGoVlog])

  // 挂载时检测进行中/待确认任务（审查 P1 孤儿闸门恢复）：本页只做引导，
  // 完整接管（闸门卡/进度恢复/结果展示）统一在回忆录页状态机
  useEffect(() => {
    if (!petId) return
    let cancelled = false
    getLatestStatus(petId).then((task) => {
      if (cancelled || !task) return
      if (task.awaiting_confirmation || task.status === 'pending' || task.status === 'processing') {
        Taro.showModal({
          title: task.awaiting_confirmation ? '有分镜待确认' : '有生成任务进行中',
          content: '你有一笔回忆录任务正在进行，请前往「回忆录」查看进度或确认剧本',
          confirmText: '去查看',
          cancelText: '稍后',
          success: (m) => {
            if (m.confirm) handleGoVlog()
          },
        })
      }
    }).catch(() => {})
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅挂载时检测一次
  }, [petId])

  // ==================== 轮询任务状态 ====================

  // 订阅 WS 事件：视频生成完成/失败时立即触发刷新（替代等待下一次轮询）
  useEffect(() => {
    if (!polling || !petId || !taskId) return

    const unsubscribe = wsClient.on('memoir_status', (data) => {
      if (data.taskId !== taskId) return
      setRefreshKey((k) => k + 1)
    })
    return unsubscribe
  }, [polling, petId, taskId])

  useEffect(() => {
    // taskId 仅用于 id 比对过滤（降级轮询路径可能无 taskId，不得作启动门——审查 P1 修复）
    if (!polling || !petId) return

    let timer: ReturnType<typeof setTimeout> | null = null
    let stopped = false
    // 总时长上限 30 分钟（与回忆录页一致，防任务卡死时遮罩永久挂起）
    const startedAt = Date.now()
    const MAX_POLL_MS = 30 * 60 * 1000

    const poll = async () => {
      if (stopped) return

      // 统一走 service 层（getLatestStatus 内部处理 404/网络抖动返回 null）
      const task = await getLatestStatus(petId)

      if (stopped) return

      // 轮询期间任务被替换（如用户在别处新建任务）：忽略，继续等本任务
      // （taskId 为空 = 降级轮询/无本页任务锚点，latest 即目标，不比对）
      if (taskId && task?.id && task.id !== taskId) {
        timer = setTimeout(poll, 2000)
        return
      }

      if (task?.awaiting_confirmation) {
        // 剧本确认闸门（服务端对所有新任务生效，含 light——审查 P0：原版漏处理导致付款后无限轮询）：
        // 本页为轻流程，确认/放弃入口在回忆录页（全页面状态机统一接管）
        setLoading(false)
        setPolling(false)
        Taro.showModal({
          title: '分镜已生成',
          content: '你的回忆录分镜已就绪，请前往「回忆录」确认剧本后开始生成视频',
          confirmText: '去确认',
          cancelText: '稍后',
          success: (m) => {
            if (m.confirm) handleGoVlog()
          },
        })
      } else if (task?.status === 'completed') {
        setOutputUrl(task.video_url || '')
        setLoading(false)
        setPolling(false)
        Taro.showToast({ title: '生成成功', icon: 'success' })
        goToStep(3)
      } else if (task?.status === 'failed') {
        setLoading(false)
        setPolling(false)
        // 生成失败服务端已自动退款（B1 退款闭环），文案给用户确定感
        Taro.showModal({
          title: '生成失败',
          content: '本次生成未成功，已支付费用将自动原路退回',
          showCancel: false,
          confirmText: '知道了',
        })
      } else if (Date.now() - startedAt > MAX_POLL_MS) {
        // 轮询总时长超限（30 分钟）：停止遮罩挂起，引导去回忆录页查看（其有完整接管状态机）
        setLoading(false)
        setPolling(false)
        Taro.showModal({
          title: '生成时间较长',
          content: '视频仍在生成中，已为你保留任务；请前往「回忆录」查看进度',
          confirmText: '去查看',
          cancelText: '稍后',
          success: (m) => {
            if (m.confirm) handleGoVlog()
          },
        })
      } else {
        // 继续轮询（pending/processing/暂无任务）
        setLoadingText(task?.status === 'processing' ? '正在处理...' : '排队中...')
        timer = setTimeout(poll, 2000)
      }
    }

    poll()

    return () => {
      stopped = true
      if (timer) clearTimeout(timer)
    }
  }, [polling, petId, taskId, goToStep, refreshKey, handleGoVlog])

  // ==================== 进入预览步骤时启动动画 ====================

  useEffect(() => {
    if (step === 2 && photos.length > 0) {
      setTimeout(() => startKenBurns(), 300)
    }
    return () => {
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current)
        animFrameRef.current = null
      }
    }
  }, [step, photos, startKenBurns])

  // ==================== 重新制作 ====================

  const handleReset = useCallback(() => {
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current)
      animFrameRef.current = null
    }
    setPhotos([])
    setStory('')
    setSelectedTags([])
    setSelectedStyle('warm')
    setTaskId('')
    setOutputUrl('')
    setLoading(false)
    setPolling(false)
    goToStep(0)
  }, [goToStep])

  const handleShare = useCallback(() => {
    Taro.showShareMenu({
      withShareTicket: true,
    })
  }, [])

  const handleSaveToTimeline = useCallback(async () => {
    if (!petId || !outputUrl) {
      Taro.showToast({ title: '保存失败', icon: 'none' })
      return
    }
    try {
      const store = usePetStore.getState()
      const userId = store.userId || ''
      // 当前宠物名（既有硬编码「毛孩子」改为真实档案名，取不到回退）
      const currentPet = store.pets?.find((p) => p.id === petId)
      await timelineService.addMoment({
        userId,
        petId,
        type: 'memory',
        content: {
          petName: currentPet?.name || '毛孩子',
          petEmoji: currentPet?.species === 'dog' ? '🐶' : '🐱',
          description: outputUrl,
        },
        photos: [outputUrl],
      })
      Taro.showToast({ title: '已保存到时光线', icon: 'success' })
    } catch {
      Taro.showToast({ title: '保存失败，请重试', icon: 'none' })
    }
  }, [petId, outputUrl])

  /** 保存到相册 */
  const handleSaveAlbum = useCallback(() => {
    if (!outputUrl) {
      Taro.showToast({ title: '保存失败', icon: 'none' })
      return
    }
    Taro.downloadFile({
      url: outputUrl,
      success: (res) => {
        if (res.statusCode !== 200) {
          Taro.showToast({ title: '保存失败', icon: 'none' })
          return
        }
        Taro.saveVideoToPhotosAlbum({
          filePath: res.tempFilePath,
          success: () => Taro.showToast({ title: '已保存到相册', icon: 'success' }),
          fail: () => Taro.showModal({
            title: '需要相册权限',
            content: '请在设置中开启「保存到相册」权限后重试',
            confirmText: '去设置',
            success: (m) => {
              if (m.confirm) Taro.openSetting()
            },
          }),
        })
      },
      fail: () => Taro.showToast({ title: '保存失败', icon: 'none' }),
    })
  }, [outputUrl])

  /** 播放生成的视频 */
  const handlePlayVideo = useCallback(() => {
    if (!outputUrl) return
    Taro.previewMedia({
      sources: [{ url: outputUrl, type: 'video' }],
    }).catch(() => {
      Taro.showToast({ title: '视频播放失败', icon: 'none' })
    })
  }, [outputUrl])

  // ==================== 定价展示（审查 P1：产品卡文案随 B1 三档体系动态取价） ====================

  // 挂载拉取三档价格：产品卡显示 light 档实时价（会员/非会员分价），vlog 卡显示 full 档起价
  const [pricing, setPricing] = useState<MemoirPricing | null>(null)
  useEffect(() => {
    if (!petId) return
    let cancelled = false
    getMemoirPricing(petId).then((p) => {
      if (!cancelled) setPricing(p)
    }).catch(() => {})
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅挂载时取价一次
  }, [petId])

  const isMember = pricing?.isMember ?? false
  const lightPrice = pricing?.prices ? pickTierPrice(pricing.prices, 'light', isMember) : null

  // ==================== 渲染：步骤指示器 ====================

  const renderStepIndicator = () => {
    // step 0 → 上传素材；step 1/2 → AI生成；step 3 → 预览保存
    const activeIdx = step === 0 ? 0 : (step <= 2 ? 1 : 2)
    return (
      <View className='memoir__steps'>
        <PageBackground />
        {STEP_LABELS.map((label, i) => (
          <View key={label} className='memoir__step-wrap'>
            <View className='memoir__step'>
              <View
                className={`memoir__step-dot${i === activeIdx ? ' memoir__step-dot--active' : ''}${i < activeIdx ? ' memoir__step-dot--done' : ''}`}
              >
                <Text className='memoir__step-num'>{i < activeIdx ? '✓' : i + 1}</Text>
              </View>
              <Text className={`memoir__step-label${i === activeIdx ? ' memoir__step-label--active' : ''}`}>{label}</Text>
            </View>
            {i < STEP_LABELS.length - 1 && <View className='memoir__step-line' />}
          </View>
        ))}
      </View>
    )
  }

  // ==================== 渲染：上传素材卡（step 0） ====================

  const renderStepUpload = () => (
    <View className='xhh-card memoir__panel'>
      <Text className='memoir__section-title'>上传素材</Text>

      <View className='memoir__photo-grid'>
        {/* key 用稳定 photo.key（删除后其余照片 key 不变，上传回写不错位）；index 仅作预览/删除定位 */}
        {photos.map((photo) => (
          <View
            key={photo.key}
            className='memoir__photo-slot'
            onClick={() => handlePreviewPhoto(photos.findIndex(p => p.key === photo.key))}
          >
            <Image className='memoir__photo-image' src={photo.path} mode='aspectFill' />
            {/* 上传状态徽标（B2：本地照片需上传就绪才能提交） */}
            {photo.uploading && (
              <View className='memoir__photo-badge'><Text>上传中</Text></View>
            )}
            {photo.failed && (
              <View
                className='memoir__photo-badge memoir__photo-badge--failed'
                onClick={(e) => {
                  e.stopPropagation()
                  handleRetryUpload(photo.key)
                }}
              >
                <Text>失败·点重试</Text>
              </View>
            )}
            <View
              className='memoir__photo-delete'
              onClick={(e) => {
                e.stopPropagation()
                handleDeletePhoto(photos.findIndex(p => p.key === photo.key))
              }}
            >
              ✕
            </View>
          </View>
        ))}

        {photos.length < 3 && (
          <View className='memoir__photo-slot memoir__photo-slot--add' onClick={handleAddPhoto}>
            <Icon name='camera' size={22} tone='primary' className='memoir__photo-add-icon' />
            <Text className='memoir__photo-add-text'>添加</Text>
          </View>
        )}
      </View>

      <View
        className={`memoir__pick-btn ${photos.length === 3 ? 'memoir__pick-btn--disabled' : ''}`}
        onClick={handleAddPhoto}
      >
        <Text className='memoir__pick-btn-text'>🖼️ 选择照片（{photos.length}/3）</Text>
      </View>

      {/* 回忆标签：勾选后服务端按标签取真实记忆作叙事素材，无标签则用全部记忆 */}
      <View className='memoir__tags'>
        <Text className='memoir__tags-title'>它属于哪些回忆？（可多选，让旁白更懂你们）</Text>
        <View className='memoir__tags-list'>
          {MEMOIR_TAG_OPTIONS.map((tag) => {
            const active = selectedTags.includes(tag.key)
            return (
              <View
                key={tag.key}
                className={`memoir__tag${active ? ' memoir__tag--active' : ''}`}
                onClick={() => toggleTag(tag.key)}
              >
                <Text>{tag.emoji} {tag.label}{active ? ' ✓' : ''}</Text>
              </View>
            )
          })}
        </View>
      </View>

      <Textarea
        className='memoir__story'
        value={story}
        onInput={e => setStory(e.detail.value)}
        placeholder='写下你们的真实回忆（最爱的玩具、每天的日常…），旁白将优先使用你的回忆；留空则只基于照片事实生成，不会编故事。'
        placeholderClass='memoir__placeholder'
        maxlength={200}
        autoHeight
      />

      <View className='memoir__lockbar'>
        <Text className='memoir__lockbar-icon'>🔒</Text>
        <Text className='memoir__lockbar-text'>已锁定角色特征，全视频保持一致</Text>
      </View>
    </View>
  )

  // ==================== 渲染：AI 生成卡（step 1） ====================

  const renderStepGenerate = () => (
    <View className='xhh-card memoir__panel'>
      <Text className='memoir__section-title'>选择动画风格</Text>
      <Text className='memoir__section-sub'>为你的回忆短片挑选一个喜欢的风格</Text>

      <View className='memoir__style-list'>
        {STYLE_OPTIONS.map((style) => (
          <View
            key={style.key}
            className={`memoir__style-card${selectedStyle === style.key ? ' memoir__style-card--active' : ''}`}
            onClick={() => setSelectedStyle(style.key)}
          >
            <View className='memoir__style-emoji'>
              <Text>{style.emoji}</Text>
            </View>
            <View className='memoir__style-info'>
              <Text className='memoir__style-name'>{style.name}</Text>
              <Text className='memoir__style-desc'>{style.desc}</Text>
            </View>
            <View className={`memoir__style-check${selectedStyle === style.key ? ' memoir__style-check--checked' : ''}`}>
              {selectedStyle === style.key && <Text>✓</Text>}
            </View>
          </View>
        ))}
      </View>

      <Text className='memoir__section-title' style={{ marginTop: '40rpx' }}>选择背景音乐</Text>
      <Text className='memoir__section-sub'>选择一首你喜欢的背景音乐</Text>

      <View className='memoir__bgm-list'>
        {BGM_OPTIONS.map((bgm) => (
          <View
            key={bgm.key}
            className={`memoir__bgm-card${selectedBGM === bgm.key ? ' memoir__bgm-card--active' : ''}`}
            onClick={() => setSelectedBGM(bgm.key)}
          >
            <View className='memoir__bgm-emoji'>
              <Text>{bgm.emoji}</Text>
            </View>
            <View className='memoir__bgm-info'>
              <Text className='memoir__bgm-name'>{bgm.name}</Text>
              <Text className='memoir__bgm-tag'>{bgm.tag}</Text>
            </View>
            <View
              className={`memoir__bgm-preview${playingBGM === bgm.key ? ' memoir__bgm-preview--playing' : ''}`}
              onClick={(e) => {
                e.stopPropagation()
                handleBGMPreview(bgm.key, bgm.previewUrl)
              }}
            >
              <Text>{playingBGM === bgm.key ? '⏸' : '▶'}</Text>
            </View>
          </View>
        ))}
      </View>
      {/* B 级曲目（CC BY 3.0）需署名：来源说明常驻展示，满足授权要求 */}
      <Text style={{ marginTop: '16rpx', fontSize: '20rpx', color: '#999' }}>
        音乐：Kevin MacLeod（incompetech.com）· CC BY 3.0
      </Text>
    </View>
  )

  // ==================== 渲染：AI 生成进度卡（loading 时） ====================

  const renderGenerating = () => (
    <View className='xhh-card memoir__panel'>
      <Text className='memoir__section-title'>AI 生成</Text>
      <View className='memoir__progress'>
        <View className='memoir__progress-track'>
          <View className='memoir__progress-bar' />
        </View>
        <Text className='memoir__progress-pct'>进行中</Text>
      </View>
      <Text className='memoir__gen-text'>AI 正在编排你的回忆…</Text>
      <View className='memoir__gen-hint'>
        <Text className='memoir__gen-hint-icon'>⏱️</Text>
        <Text className='memoir__gen-hint-text'>预计 5-15 分钟，生成后自动提醒</Text>
      </View>
      <Text className='memoir__gen-status'>{loadingText}</Text>
    </View>
  )

  // ==================== 渲染：预览（step 2，Ken Burns） ====================

  const renderPreview = () => (
    <View className='xhh-card memoir__panel'>
      <Text className='memoir__section-title'>预览效果</Text>
      <View className='memoir__cover'>
        <Canvas
          id='memoirCanvas'
          className='memoir__preview-canvas'
          type='2d'
          ref={canvasRef}
        />
      </View>
      <View className='memoir__preview-info'>
        <Text className='memoir__preview-icon'>🎵</Text>
        <View className='memoir__preview-texts'>
          <Text className='memoir__preview-text'>
            BGM：{BGM_OPTIONS.find(b => b.key === selectedBGM)?.name || selectedBGM}
          </Text>
          <Text className='memoir__preview-label'>
            风格：{STYLE_OPTIONS.find(s => s.key === selectedStyle)?.name || selectedStyle}
          </Text>
        </View>
      </View>
    </View>
  )

  // ==================== 渲染：预览保存卡（step 3，结果） ====================

  const renderResult = () => (
    <View className='xhh-card memoir__panel'>
      <Text className='memoir__section-title'>预览保存</Text>
      <View className='memoir__cover' onClick={handlePlayVideo}>
        {outputUrl ? (
          <Image className='memoir__cover-image' src={outputUrl} mode='aspectFill' />
        ) : (
          <View className='memoir__cover-placeholder'>
            <Icon name='camera' size={36} tone='primary' className='memoir__cover-placeholder-icon' />
            <Text className='memoir__cover-placeholder-text'>回忆录已生成</Text>
          </View>
        )}
        <View className='memoir__cover-play'>
          <View className='memoir__cover-play-btn'>
            <Text className='memoir__cover-play-icon'>▶</Text>
          </View>
        </View>
        <View className='memoir__cover-duration'>
          <Text className='memoir__cover-duration-text'>5-30 秒</Text>
        </View>
      </View>

      <View className='memoir__result-actions'>
        <View className='memoir__btn memoir__btn--primary' onClick={handleSaveAlbum}>
          <Text className='memoir__btn-text'>⬇️ 保存到相册</Text>
        </View>
        <View className='memoir__btn memoir__btn--ghost' onClick={handleSaveToTimeline}>
          <Text className='memoir__btn-text--ghost'>💾 保存到时光线</Text>
        </View>
        <View className='memoir__btn memoir__btn--ghost' onClick={handleShare}>
          <Text className='memoir__btn-text--ghost'>📤 分享</Text>
        </View>
        <View className='memoir__btn memoir__btn--ghost' onClick={handleReset}>
          <Text className='memoir__btn-text--ghost'>🔄 重新生成</Text>
        </View>
      </View>
    </View>
  )

  // ==================== 底部按钮 ====================

  const renderFooter = () => {
    if (step === 0) {
      return (
        <View
          className={`memoir__btn memoir__btn--primary${photos.length === 0 ? ' memoir__btn--disabled' : ''}`}
          onClick={photos.length > 0 ? () => goToStep(1) : undefined}
        >
          <Text className='memoir__btn-text'>下一步</Text>
        </View>
      )
    }

    if (step === 1) {
      return (
        <View className='memoir__btn memoir__btn--primary' onClick={() => goToStep(2)}>
          <Text className='memoir__btn-text'>下一步：预览</Text>
        </View>
      )
    }

    if (step === 2) {
      return (
        <View className='memoir__btn memoir__btn--primary' onClick={handleGenerate}>
          {/* 支付透明（审查 P1）：按钮明示 light 档应付金额（会员/非会员分价），不以无金额按钮拉起收银台 */}
          <Text className='memoir__btn-text'>
            {lightPrice !== null
              ? `支付 ¥${formatYuan(lightPrice)} · 生成回忆录`
              : '生成回忆录（付费）'}
          </Text>
        </View>
      )
    }

    return null
  }

  // ==================== 主渲染 ====================

  return (
    <View className={`memoir ${themeClass}`}>
      {/* 标题区 */}
      <View className='memoir__head'>
        <Text className='memoir__title'>宠物回忆录</Text>
        <Text className='memoir__subtitle'>把 TA 的一生，讲成一个故事</Text>
      </View>

      {/* hero 横幅 */}
      <View className='memoir__hero'>
        <View className='memoir__hero-bg'>
          <Icon name='cat' size={80} tone='primary' className='memoir__hero-emoji' />
        </View>
        <View className='memoir__hero-badge'>
          <Text className='memoir__hero-badge-text'>✨ AI 时光电影</Text>
        </View>
      </View>

      {/* 参考样例视频（2026-09-10 用户提供的轻纪念成片案例，点击全屏播放） */}
      <View className='memoir__samples'>
        <Text className='memoir__samples-title'>🎬 看看别人的轻纪念长什么样</Text>
        <View className='memoir__samples-list'>
          {SAMPLE_VIDEOS.map((sv) => (
            <View
              key={sv.url}
              className='memoir__samples-card'
              onClick={() => {
                Taro.previewMedia({ sources: [{ url: sv.url, type: 'video' }] }).catch(() => {
                  Taro.showToast({ title: '视频播放失败，请重试', icon: 'none' })
                })
              }}
            >
              <Text className='memoir__samples-card-emoji'>{sv.emoji}</Text>
              <View className='memoir__samples-card-info'>
                <Text className='memoir__samples-card-label'>{sv.label}</Text>
                <Text className='memoir__samples-card-hint'>5-30 秒 · 点击播放</Text>
              </View>
              <View className='memoir__samples-card-play'><Text>▶</Text></View>
            </View>
          ))}
        </View>
      </View>

      {/* 步骤指示器 */}
      {renderStepIndicator()}

      <ScrollView
        className='memoir__content'
        scrollY
        enhanced
        showScrollbar={false}
        key={animKey}
      >
        {step === 0 && renderStepUpload()}
        {step === 1 && renderStepGenerate()}
        {step === 2 && (loading ? renderGenerating() : renderPreview())}
        {step === 3 && renderResult()}
      </ScrollView>

      {step < 3 && !loading && (
        <View className='memoir__footer'>
          {renderFooter()}
        </View>
      )}

      {loading && step < 3 && (
        <View className='memoir__loading-overlay'>
          {renderGenerating()}
        </View>
      )}
    </View>
  )
}
