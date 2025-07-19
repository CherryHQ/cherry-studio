import { MinusOutlined } from '@ant-design/icons'
import { type HealthResult, HealthStatusIndicator } from '@renderer/components/HealthStatusIndicator'
import { StreamlineGoodHealthAndWellBeing } from '@renderer/components/Icons/SVGIcon'
import { ApiKeyWithStatus } from '@renderer/types/healthCheck'
import { maskApiKey } from '@renderer/utils/api'
import { Button, Flex, Input, InputRef, List, Popconfirm, Tooltip, Typography } from 'antd'
import { Check, PenLine, X } from 'lucide-react'
import { FC, memo, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import { ApiKeyValidity } from './types'

export interface ApiKeyItemProps {
  keyStatus: ApiKeyWithStatus
  onUpdate: (newKey: string) => ApiKeyValidity
  onRemove: () => void
  onCheck: () => Promise<void>
  disabled?: boolean
  showHealthCheck?: boolean
  isNew?: boolean
}

/**
 * API Key 项组件
 * 支持编辑、删除、连接检查等操作
 */
const ApiKeyItem: FC<ApiKeyItemProps> = ({
  keyStatus,
  onUpdate,
  onRemove,
  onCheck,
  disabled: _disabled = false,
  showHealthCheck = true,
  isNew = false
}) => {
  const { t } = useTranslation()
  const [isEditing, setIsEditing] = useState(isNew || !keyStatus.key.trim())
  const [editValue, setEditValue] = useState(keyStatus.key)
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)
  const inputRef = useRef<InputRef>(null)

  const disabled = keyStatus.checking || _disabled

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus()
    }
  }, [isEditing])

  useEffect(() => {
    setHasUnsavedChanges(editValue.trim() !== keyStatus.key.trim())
  }, [editValue, keyStatus.key])

  const handleEdit = () => {
    if (disabled) return
    setIsEditing(true)
    setEditValue(keyStatus.key)
  }

  const handleSave = () => {
    const result = onUpdate(editValue)
    if (!result.isValid) {
      window.message.warning({
        key: 'api-key-error',
        content: result.error
      })
      return
    }

    setIsEditing(false)
  }

  const handleCancelEdit = () => {
    if (isNew || !keyStatus.key.trim()) {
      // 临时项取消时直接移除
      onRemove()
    } else {
      // 现有项取消时恢复原值
      setEditValue(keyStatus.key)
      setIsEditing(false)
    }
  }

  const healthResults: HealthResult[] = [
    {
      status: keyStatus.status,
      latency: keyStatus.latency,
      error: keyStatus.error,
      label: keyStatus.model?.name
    }
  ]

  return (
    <List.Item>
      {isEditing ? (
        <ItemInnerContainer style={{ gap: '10px' }}>
          <Input.Password
            ref={inputRef}
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onPressEnter={handleSave}
            placeholder={t('settings.provider.api.key.new_key.placeholder')}
            style={{ flex: 1, fontSize: '14px', marginLeft: '-10px' }}
            spellCheck={false}
            disabled={disabled}
          />
          <Flex gap={0} align="center">
            <Tooltip title={t('common.save')}>
              <Button
                type={hasUnsavedChanges ? 'primary' : 'text'}
                icon={<Check size={16} />}
                onClick={handleSave}
                disabled={disabled}
              />
            </Tooltip>
            <Tooltip title={t('common.cancel')}>
              <Button type="text" icon={<X size={16} />} onClick={handleCancelEdit} disabled={disabled} />
            </Tooltip>
          </Flex>
        </ItemInnerContainer>
      ) : (
        <ItemInnerContainer style={{ gap: '10px' }}>
          <Tooltip
            title={
              <Typography.Text style={{ color: 'white' }} copyable={{ text: keyStatus.key }}>
                {keyStatus.key}
              </Typography.Text>
            }
            mouseEnterDelay={0.5}
            placement="top"
            // 确保不留下明文
            destroyTooltipOnHide>
            <span style={{ cursor: 'help' }}>{maskApiKey(keyStatus.key)}</span>
          </Tooltip>

          <Flex gap={10} align="center">
            <HealthStatusIndicator results={healthResults} loading={false} />

            <Flex gap={0} align="center">
              {showHealthCheck && (
                <Tooltip title={t('settings.provider.check')} mouseLeaveDelay={0}>
                  <Button
                    type="text"
                    icon={<StreamlineGoodHealthAndWellBeing size={'1.2em'} isActive={keyStatus.checking} />}
                    onClick={onCheck}
                    disabled={disabled}
                  />
                </Tooltip>
              )}
              <Tooltip title={t('common.edit')} mouseLeaveDelay={0}>
                <Button type="text" icon={<PenLine size={16} />} onClick={handleEdit} disabled={disabled} />
              </Tooltip>
              <Popconfirm
                title={t('common.delete_confirm')}
                onConfirm={onRemove}
                disabled={disabled}
                okText={t('common.confirm')}
                cancelText={t('common.cancel')}
                okButtonProps={{ danger: true }}>
                <Tooltip title={t('common.delete')} mouseLeaveDelay={0}>
                  <Button type="text" icon={<MinusOutlined />} disabled={disabled} />
                </Tooltip>
              </Popconfirm>
            </Flex>
          </Flex>
        </ItemInnerContainer>
      )}
    </List.Item>
  )
}

const ItemInnerContainer = styled(Flex)`
  flex: 1;
  justify-content: space-between;
  align-items: center;
`

export default memo(ApiKeyItem)
