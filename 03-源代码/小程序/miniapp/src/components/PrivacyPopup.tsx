/**
 * 隐私弹窗组件（微信官方隐私授权机制）
 *
 * 用法：配合 wx.onNeedPrivacyAuthorization 监听使用。
 * 微信要求：用户调用隐私接口（chooseAvatar / 昵称填写 / chooseImage 等）前，
 * 必须弹出本弹窗，且「同意」按钮必须是 openType="agreePrivacyAuthorization"
 * 的 <Button>（普通 View 点击无法完成授权，会持续 errno 112）。
 *
 * 触发链路：
 *   隐私接口被调用 → wx.onNeedPrivacyAuthorization(resolve) 触发
 *   → 展示本组件 → 用户点「同意」→ Button 触发 agreePrivacyAuthorization
 *   → resolve({ buttonId, event: 'agree' }) → 隐私接口继续执行
 */
import { useState } from 'react'
import { View, Text, Button } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { isWeapp } from '../platform'
import './PrivacyPopup.scss'

interface PrivacyPopupProps {
  /** 是否显示弹窗 */
  visible: boolean
  /** 用户点击「同意」后的回调（微信 Button 授权成功后触发） */
  onAgree: () => void
  /** 用户点击「拒绝」后的回调 */
  onReject: () => void
}

export default function PrivacyPopup({ visible, onAgree, onReject }: PrivacyPopupProps) {
  const [agreeHandled, setAgreeHandled] = useState(false)

  if (!visible) return null

  /** 打开微信官方「用户隐私保护指引」页面 */
  const openPrivacyContract = () => {
    if (isWeapp() && typeof Taro.openPrivacyContract === 'function') {
      Taro.openPrivacyContract({})
    }
  }

  return (
    <View className='privacy-popup'>
      <View className='privacy-popup__overlay' />
      <View className='privacy-popup__content'>
        <Text className='privacy-popup__title'>隐私保护提示</Text>
        <Text className='privacy-popup__text'>
          在使用该功能前，请仔细阅读
          <Text className='privacy-popup__link' onClick={openPrivacyContract}>《用户隐私保护指引》</Text>
          。如你同意，请点击&quot;同意&quot;开始使用。
        </Text>
        <View className='privacy-popup__actions'>
          {/* 同意按钮：必须用 openType="agreePrivacyAuthorization" 才能完成微信隐私授权；
              id 与 app.js resolve({buttonId:'agree'}) 对齐（官方按 id 关联放行的按钮） */}
          {isWeapp() ? (
            <Button
              id='agree'
              className='privacy-popup__btn privacy-popup__btn--agree'
              openType='agreePrivacyAuthorization'
              onAgreePrivacyAuthorization={() => {
                // 微信在用户同意后回调，此时才真正完成授权
                setAgreeHandled(true)
                onAgree()
              }}
            >
              同意
            </Button>
          ) : (
            <Button
              className='privacy-popup__btn privacy-popup__btn--agree'
              onClick={() => {
                setAgreeHandled(true)
                onAgree()
              }}
            >
              同意
            </Button>
          )}
          <Button
            className='privacy-popup__btn privacy-popup__btn--reject'
            onClick={() => {
              if (!agreeHandled) onReject()
            }}
          >
            拒绝
          </Button>
        </View>
      </View>
    </View>
  )
}
