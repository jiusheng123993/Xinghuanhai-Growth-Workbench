/**
 * 危机转介卡片组件
 * 提供心理援助热线拨打、紧急就医引导及后续跟进功能
 *
 * 【IA：`找宠物医院` 为什么跳团团】（2026-09-12 收口批次 §2）
 * 判断标准：**需要 AI 推理的能力**（食物安全查询 / 症状初筛 / 附近医院 / AI 取名 / AI 记忆）
 * 入口统一先跳团团；**纯记录 / 查询类**（打卡 / 品种 / 疫苗 / 时光）保留原位。
 * 「找宠物医院」= 附近医院，属 AI 推理类 → 收拢到团团。
 *
 * ⚠️ 顺带修掉一个标签与落地页不一致的旧问题：改之前这一项写的是「找宠物医院」，
 * 跳的却是 `/pagesPet/symptom-check/index`（症状初筛），文案与去处对不上；
 * 收拢到团团后，团团的能力条里「附近医院」与「症状初筛」是两个正确入口，用户不会再被送错。
 */
import { View, Text } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { useCallback } from 'react'
import { HOTLINE_NUMBER } from '../constants'
import { buildAiEntryUrl } from '../utils/aiEntry'
import type { CrisisTriggerSource } from '../engines/emotion'
import { trackEvent as trackEventService } from '../services/analyticsService'
import './CrisisReferralCard.scss'

interface CrisisReferralCardProps {
  message: string
  onDismiss: () => void
  severity?: 'moderate' | 'severe'
  onFollowUp?: (action: 'contacted' | 'okay') => void
  triggerSource?: CrisisTriggerSource
}

export default function CrisisReferralCard({ message, onDismiss, severity = 'severe', onFollowUp, triggerSource = 'grief' }: CrisisReferralCardProps) {
  const handleCallHotline = useCallback(() => {
    trackEventService('crisis_hotline_call', { source: triggerSource })
    Taro.makePhoneCall({ phoneNumber: HOTLINE_NUMBER.replace(/-/g, '') })
  }, [triggerSource])

  const handleFollowUp = useCallback((action: 'contacted' | 'okay') => {
    trackEventService('crisis_referral_follow_up', { action, source: triggerSource })
    if (onFollowUp) {
      onFollowUp(action)
    }
    onDismiss()
  }, [onFollowUp, onDismiss, triggerSource])

  /**
   * 打开「附近医院」（AI 推理类能力）
   *
   * 为什么先跳团团：IA 定「团团 = 全站 AI 能力唯一入口」，附近医院属 AI 推理类；
   * 带 `capability=hospital` 参数后团团会**进页自动打开**该能力，用户仍是一步到位。
   * 契约见 `utils/aiEntry.ts`。
   */
  const handleFindHospital = useCallback(() => {
    Taro.navigateTo({ url: buildAiEntryUrl('hospital') })
  }, [])

  const isSevere = severity === 'severe'

  return (
    <View className={`crisis-referral crisis-referral--${severity}`}>
      <View className='crisis-referral__card'>
        <Text className='crisis-referral__icon'>{isSevere ? '🆘' : '💛'}</Text>
        <Text className='crisis-referral__message'>{message}</Text>

        {isSevere && (
          <View className='crisis-referral__hotline' onClick={handleCallHotline}>
            <Text className='crisis-referral__hotline-icon'>📞</Text>
            <Text className='crisis-referral__hotline-number'>{HOTLINE_NUMBER}</Text>
            <Text className='crisis-referral__hotline-label'>24h心理援助热线</Text>
          </View>
        )}

        {isSevere && (
          <View className='crisis-referral__emergency-section'>
            <View className='crisis-referral__emergency-item' onClick={handleFindHospital}>
              <Text className='crisis-referral__emergency-icon'>🏥</Text>
              <Text className='crisis-referral__emergency-text'>找宠物医院</Text>
            </View>
            <View className='crisis-referral__emergency-item' onClick={handleCallHotline}>
              <Text className='crisis-referral__emergency-icon'>☎️</Text>
              <Text className='crisis-referral__emergency-text'>紧急联系</Text>
            </View>
          </View>
        )}

        {!isSevere && (
          <View className='crisis-referral__moderate-tips'>
            <View className='crisis-referral__tip-item'>
              <Text className='crisis-referral__tip-icon'>🫁</Text>
              <Text className='crisis-referral__tip-text'>试试深呼吸，放松一下</Text>
            </View>
            <View className='crisis-referral__tip-item'>
              <Text className='crisis-referral__tip-icon'>💤</Text>
              <Text className='crisis-referral__tip-text'>适当休息，不要过度焦虑</Text>
            </View>
            <View className='crisis-referral__tip-item'>
              <Text className='crisis-referral__tip-icon'>📊</Text>
              <Text className='crisis-referral__tip-text'>查看健康数据趋势</Text>
            </View>
          </View>
        )}

        <View className='crisis-referral__actions'>
          {isSevere && (
            <View className='crisis-referral__call-btn' onClick={handleCallHotline}>
              <Text className='crisis-referral__call-text'>拨打热线</Text>
            </View>
          )}
        </View>

        <View className='crisis-referral__follow-up'>
          <View
            className='crisis-referral__follow-up-btn crisis-referral__follow-up-btn--primary'
            onClick={() => handleFollowUp('contacted')}
          >
            <Text className='crisis-referral__follow-up-text'>我已联系帮助</Text>
          </View>
          <View
            className='crisis-referral__follow-up-btn crisis-referral__follow-up-btn--secondary'
            onClick={() => handleFollowUp('okay')}
          >
            <Text className='crisis-referral__follow-up-text'>我没事，谢谢关心</Text>
          </View>
        </View>
      </View>
    </View>
  )
}
