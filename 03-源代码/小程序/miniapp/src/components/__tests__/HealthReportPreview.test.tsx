/**
 * 健康报告预览组件测试
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

import HealthReportPreview from '../HealthReportPreview'
import type { HealthReportData } from '../../types/reportTypes'

vi.mock('@tarojs/components', () => ({
  View: ({ children, className, style, id }: any) => (
    <div className={className} style={style} id={id}>{children}</div>
  ),
  Canvas: ({ id, className, style }: any) => (
    <canvas id={id} className={className} style={style} />
  ),
  Button: ({ children, className, onClick }: any) => (
    <button className={className} onClick={onClick}>{children}</button>
  ),
}))

const mockTaro = vi.hoisted(() => ({
  createSelectorQuery: vi.fn(),
  canvasToTempFilePath: vi.fn(),
  saveImageToPhotosAlbum: vi.fn(),
  shareFileMessage: vi.fn(),
  showToast: vi.fn(),
  showShareMenu: vi.fn(),
}))

vi.mock('@tarojs/taro', () => ({
  default: mockTaro,
  ...mockTaro,
}))

vi.mock('../../utils/reportCanvasRenderer', () => ({
  renderReportToCanvas: vi.fn().mockResolvedValue({
    tempFilePath: '/tmp/report.png',
    width: 750,
    height: 1200,
  }),
  saveReportImage: vi.fn().mockResolvedValue(undefined),
}))

const mockData: HealthReportData = {
  pet: {
    id: '1',
    name: '咪咪',
    species: 'cat',
    breed: '英短',
    birthDate: '2022-01-01',
    gender: 'female',
    neutered: true,
    weight: 4.5,
    allergies: [],
    medications: [],
    chronicConditions: [],
  },
  entries: [],
  symptoms: [],
  vaccines: [],
  generatedAt: '2026-07-20',
  period: '2026-06-20 至 2026-07-20',
}

describe('HealthReportPreview', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render canvas element', () => {
    render(<HealthReportPreview data={mockData} />)
    expect(document.querySelector('#health-report-canvas')).toBeTruthy()
  })

  it('should render save and share buttons', () => {
    render(<HealthReportPreview data={mockData} />)
    expect(screen.getByText('保存到相册')).toBeTruthy()
    expect(screen.getByText('分享给兽医')).toBeTruthy()
  })

  it('should call onSave when save button clicked', async () => {
    const onSave = vi.fn()
    render(<HealthReportPreview data={mockData} onSave={onSave} />)
    const saveBtn = screen.getByText('保存到相册')
    saveBtn.click()
  })

  it('should call onShare when share button clicked', async () => {
    const onShare = vi.fn()
    render(<HealthReportPreview data={mockData} onShare={onShare} />)
    const shareBtn = screen.getByText('分享给兽医')
    shareBtn.click()
  })
})
