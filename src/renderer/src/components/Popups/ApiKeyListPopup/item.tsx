import { Button, Flex, Tooltip } from '@cherrystudio/ui'
import { type HealthResult, HealthStatusIndicator } from '@renderer/components/HealthStatusIndicator'
import { EditIcon } from '@renderer/components/Icons'
import { StreamlineGoodHealthAndWellBeing } from '@renderer/components/Icons/SVGIcon'
import type { ApiKeyWithStatus } from '@renderer/types/healthCheck'
import { maskApiKey } from '@renderer/utils/api'
import type { InputRef } from 'antd'
import { Input, List, Popconfirm, Typography } from 'antd'
import { Check, Minus, X } from 'lucide-react'
import type { FC } from 'react'
import { memo, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import type { ApiKeyValidity } from './types'

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
      window.toast.warning(result.error)
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
      <ItemInnerContainer className="gap-2 px-3">
        {isEditing ? (
          <>
            <Input.Password
              ref={inputRef}
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onPressEnter={handleSave}
              placeholder={t('settings.provider.api.key.new_key.placeholder')}
              style={{ flex: 1, fontSize: '14px' }}
              spellCheck={false}
              disabled={disabled}
            />
            <Flex className="items-center gap-0">
              <Tooltip content={t('common.save')}>
                <Button
                  variant={hasUnsavedChanges ? 'default' : 'ghost'}
                  onClick={handleSave}
                  disabled={disabled}
                  size="icon">
                  <Check size={16} />
                </Button>
              </Tooltip>
              <Tooltip content={t('common.cancel')}>
                <Button variant="ghost" onClick={handleCancelEdit} disabled={disabled} size="icon">
                  <X size={16} />
                </Button>
              </Tooltip>
            </Flex>
          </>
        ) : (
          <>
            <Tooltip
              content={
                <Typography.Text style={{ color: 'white' }} copyable={{ text: keyStatus.key }}>
                  {keyStatus.key}
                </Typography.Text>
              }
              delay={500}>
              <span style={{ cursor: 'help' }}>{maskApiKey(keyStatus.key)}</span>
            </Tooltip>

            <Flex className="items-center gap-2.5">
              <HealthStatusIndicator results={healthResults} loading={false} />

              <Flex className="items-center gap-0">
                {showHealthCheck && (
                  <Tooltip content={t('settings.provider.check')} closeDelay={0}>
                    <Button variant="ghost" onClick={onCheck} disabled={disabled} size="icon">
                      <StreamlineGoodHealthAndWellBeing size={18} isActive={keyStatus.checking} />
                    </Button>
                  </Tooltip>
                )}
                <Tooltip content={t('common.edit')} closeDelay={0}>
                  <Button variant="ghost" onClick={handleEdit} disabled={disabled} size="icon">
                    <EditIcon size={16} />
                  </Button>
                </Tooltip>
                <Popconfirm
                  title={t('common.delete_confirm')}
                  onConfirm={onRemove}
                  disabled={disabled}
                  okText={t('common.confirm')}
                  cancelText={t('common.cancel')}
                  okButtonProps={{ color: 'danger' }}>
                  <Tooltip content={t('common.delete')} closeDelay={0}>
                    <Button variant="ghost" disabled={disabled} size="icon">
                      <Minus size={16} />
                    </Button>
                  </Tooltip>
                </Popconfirm>
              </Flex>
            </Flex>
          </>
        )}
      </ItemInnerContainer>
    </List.Item>
  )
}

const ItemInnerContainer = styled(Flex)`
  flex: 1;
  justify-content: space-between;
  align-items: center;
`

export default memo(ApiKeyItem)
