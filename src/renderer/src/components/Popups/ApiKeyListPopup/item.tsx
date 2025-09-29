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
              <Tooltip title={t('common.save')}>
                <Button
                  color={hasUnsavedChanges ? 'primary' : 'default'}
                  variant={hasUnsavedChanges ? 'solid' : 'light'}
                  startContent={<Check size={16} />}
                  onPress={handleSave}
                  isDisabled={disabled}
                  isIconOnly
                />
              </Tooltip>
              <Tooltip title={t('common.cancel')}>
                <Button
                  variant="light"
                  startContent={<X size={16} />}
                  onPress={handleCancelEdit}
                  isDisabled={disabled}
                  isIconOnly
                />
              </Tooltip>
            </Flex>
          </>
        ) : (
          <>
            <Tooltip
              title={
                <Typography.Text style={{ color: 'white' }} copyable={{ text: keyStatus.key }}>
                  {keyStatus.key}
                </Typography.Text>
              }
              mouseEnterDelay={0.5}
              placement="top"
              // 确保不留下明文
              destroyOnHidden>
              <span style={{ cursor: 'help' }}>{maskApiKey(keyStatus.key)}</span>
            </Tooltip>

            <Flex className="items-center gap-2.5">
              <HealthStatusIndicator results={healthResults} loading={false} />

              <Flex className="items-center gap-0">
                {showHealthCheck && (
                  <Tooltip title={t('settings.provider.check')} mouseLeaveDelay={0}>
                    <Button
                      variant="light"
                      startContent={<StreamlineGoodHealthAndWellBeing size={18} isActive={keyStatus.checking} />}
                      onPress={onCheck}
                      isDisabled={disabled}
                      isIconOnly
                    />
                  </Tooltip>
                )}
                <Tooltip title={t('common.edit')} mouseLeaveDelay={0}>
                  <Button
                    variant="light"
                    startContent={<EditIcon size={16} />}
                    onPress={handleEdit}
                    isDisabled={disabled}
                    isIconOnly
                  />
                </Tooltip>
                <Popconfirm
                  title={t('common.delete_confirm')}
                  onConfirm={onRemove}
                  disabled={disabled}
                  okText={t('common.confirm')}
                  cancelText={t('common.cancel')}
                  okButtonProps={{ color: 'danger' }}>
                  <Tooltip title={t('common.delete')} mouseLeaveDelay={0}>
                    <Button variant="light" startContent={<Minus size={16} />} isDisabled={disabled} isIconOnly />
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
