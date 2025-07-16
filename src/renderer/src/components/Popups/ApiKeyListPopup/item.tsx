import { CheckCircleFilled, CloseCircleFilled, MinusOutlined } from '@ant-design/icons'
import { StreamlineGoodHealthAndWellBeing } from '@renderer/components/Icons/SVGIcon'
import { maskApiKey } from '@renderer/utils/api'
import { Button, Flex, Input, InputRef, List, Popconfirm, Tooltip, Typography } from 'antd'
import { Check, PenLine, X } from 'lucide-react'
import { FC, memo, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import { ApiKeyValidity, ApiKeyWithStatus } from './types'

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
  const isNotChecked = keyStatus.status === 'not_checked'
  const isSuccess = keyStatus.status === 'success'
  const statusColor = isSuccess ? 'var(--color-status-success)' : 'var(--color-status-error)'

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

  const renderStatusIcon = () => {
    if (keyStatus.checking || isNotChecked) return null

    const StatusIcon = isSuccess ? CheckCircleFilled : CloseCircleFilled
    return <StatusIcon style={{ color: statusColor }} />
  }

  const renderKeyCheckResultTooltip = () => {
    if (keyStatus.checking) {
      return t('settings.models.check.checking')
    }

    if (isNotChecked) {
      return ''
    }

    const statusTitle = isSuccess ? t('settings.models.check.passed') : t('settings.models.check.failed')

    return (
      <div style={{ maxHeight: '200px', overflowY: 'auto', maxWidth: '300px', wordWrap: 'break-word' }}>
        <strong style={{ color: statusColor }}>{statusTitle}</strong>
        {keyStatus.model && (
          <div style={{ marginTop: 5 }}>
            {t('common.model')}: {keyStatus.model.name}
          </div>
        )}
        {keyStatus.latency && isSuccess && (
          <div style={{ marginTop: 5 }}>
            {t('settings.provider.api.key.check.latency')}: {(keyStatus.latency / 1000).toFixed(2)}s
          </div>
        )}
        {keyStatus.error && <div style={{ marginTop: 5 }}>{keyStatus.error}</div>}
      </div>
    )
  }

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
            <Tooltip title={renderKeyCheckResultTooltip()} styles={{ body: { userSelect: 'text' } }}>
              {renderStatusIcon()}
            </Tooltip>

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

const ItemInnerContainer = styled.div`
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding: 0;
  margin: 0;
`

export default memo(ApiKeyItem)
