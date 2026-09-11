/**
 * 账号注销确认组件
 * 展示注销警告信息、注销原因选择、确认码输入及确认/取消操作
 */
import React, { useState, useCallback } from 'react'
import { View, Text, Input, Button, Radio, RadioGroup } from '@tarojs/components'
import type { AccountDeletionReason } from '../types/dataPrivacyTypes'
import './AccountDeletionConfirm.scss'

/** 账号注销确认组件属性 */
interface Props {
  confirmCode: string
  onConfirm: (reason: AccountDeletionReason, customReason: string, code: string) => void
  onCancel: () => void
  loading: boolean
}

const REASON_OPTIONS: { value: AccountDeletionReason; label: string }[] = [
  { value: 'no_longer_needed', label: '不再需要' },
  { value: 'privacy_concern', label: '隐私顾虑' },
  { value: 'found_better_app', label: '找到更好的替代品' },
  { value: 'too_complicated', label: '使用太复杂' },
  { value: 'other', label: '其他原因' },
]

export const AccountDeletionConfirm: React.FC<Props> = ({
  confirmCode,
  onConfirm,
  onCancel,
  loading,
}) => {
  const [reason, setReason] = useState<AccountDeletionReason>('no_longer_needed')
  const [customReason, setCustomReason] = useState('')
  const [inputCode, setInputCode] = useState('')

  const handleConfirm = useCallback(() => {
    if (inputCode !== confirmCode) return
    onConfirm(reason, customReason, inputCode)
  }, [reason, customReason, inputCode, confirmCode, onConfirm])

  return (
    <View className='account-deletion-confirm'>
      <View className='deletion-warning'>
        <Text className='warning-icon'>⚠️</Text>
        <Text className='warning-title'>账号注销确认</Text>
        <Text className='warning-desc'>
          注销后，您的所有数据将在30天冷静期后永久删除，且无法恢复。包括：宠物档案、健康记录、疫苗记录、症状记录、行为记录等。
        </Text>
      </View>

      <View className='deletion-reasons'>
        <Text className='reason-label'>请选择注销原因：</Text>
        <RadioGroup onChange={(e) => setReason(e.detail.value as AccountDeletionReason)}>
          {REASON_OPTIONS.map((opt) => (
            <View key={opt.value} className='reason-option'>
              <Radio value={opt.value} checked={reason === opt.value} color='#FF4D4F'>
                {opt.label}
              </Radio>
            </View>
          ))}
        </RadioGroup>
      </View>

      {reason === 'other' && (
        <View className='custom-reason'>
          <Input
            className='custom-reason-input'
            placeholder='请说明注销原因'
            value={customReason}
            onInput={(e) => setCustomReason(e.detail.value)}
            maxlength={200}
          />
        </View>
      )}

      <View className='confirm-code-section'>
        <Text className='code-label'>
          请输入确认码 <Text className='code-value'>{confirmCode}</Text> 以确认注销
        </Text>
        <Input
          className='code-input'
          placeholder='输入确认码'
          value={inputCode}
          onInput={(e) => setInputCode(e.detail.value)}
          maxlength={6}
        />
      </View>

      <View className='deletion-actions'>
        <Button className='cancel-btn' onClick={onCancel} disabled={loading}>
          取消
        </Button>
        <Button
          className='confirm-btn'
          onClick={handleConfirm}
          disabled={loading || inputCode !== confirmCode}
          loading={loading}
        >
          确认注销
        </Button>
      </View>
    </View>
  )
}

export default AccountDeletionConfirm
