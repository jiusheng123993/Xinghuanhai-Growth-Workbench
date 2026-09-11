/**
 * 健康报告预览组件
 * 将宠物健康数据渲染到 Canvas，支持保存图片和分享给兽医
 */
import { useEffect, useRef, useCallback } from 'react'
import { View, Canvas, Button } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { renderReportToCanvas, saveReportImage } from '../utils/reportCanvasRenderer'
import type { HealthReportData } from '../types/reportTypes'
import './HealthReportPreview.scss'

interface HealthReportPreviewProps {
  data: HealthReportData
  onSave?: () => void
  onShare?: () => void
}

const CANVAS_ID = 'health-report-canvas'

export default function HealthReportPreview({ data, onSave, onShare }: HealthReportPreviewProps) {
  const renderingRef = useRef(false)
  const imageRef = useRef<string>('')

  const renderCanvas = useCallback(async () => {
    if (renderingRef.current) return
    renderingRef.current = true

    try {
      const result = await renderReportToCanvas(data, { canvasId: CANVAS_ID })
      imageRef.current = result.tempFilePath
    } catch (_err) {
    } finally {
      renderingRef.current = false
    }
  }, [data])

  useEffect(() => {
    const timer = setTimeout(() => {
      renderCanvas()
    }, 500)
    return () => clearTimeout(timer)
  }, [renderCanvas])

  useEffect(() => {
    Taro.showShareMenu({
      withShareTicket: true,
    } as any)
  }, [])

  const handleSave = useCallback(async () => {
    try {
      const result = await renderReportToCanvas(data, { canvasId: CANVAS_ID })
      await saveReportImage(result.tempFilePath)
      onSave?.()
    } catch {
      Taro.showToast({ title: '保存失败', icon: 'none' })
    }
  }, [data, onSave])

  const handleShareToVet = useCallback(async () => {
    try {
      const result = await renderReportToCanvas(data, { canvasId: CANVAS_ID })
      Taro.shareFileMessage({
        filePath: result.tempFilePath,
        fileName: `${data.pet.name}健康报告.png`,
        success: () => {
          onShare?.()
        },
        fail: () => {
          Taro.showToast({ title: '分享失败', icon: 'none' })
        },
      })
    } catch {
      Taro.showToast({ title: '分享失败', icon: 'none' })
    }
  }, [data, onShare])

  return (
    <View className='report-preview'>
      <View className='report-preview__canvas-wrap'>
        <Canvas
          type='2d'
          id={CANVAS_ID}
          className='report-preview__canvas'
          style={{ width: '100%', height: 'auto' }}
        />
      </View>
      <View className='report-preview__actions'>
        <Button className='report-preview__btn report-preview__btn--save' onClick={handleSave}>
          保存到相册
        </Button>
        <Button className='report-preview__btn report-preview__btn--share' onClick={handleShareToVet}>
          分享给兽医
        </Button>
        <Button
          className='report-preview__btn report-preview__btn--wechat'
          openType='share'
        >
          微信分享
        </Button>
      </View>
    </View>
  )
}

export { HealthReportPreview }
