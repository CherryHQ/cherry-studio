import { CheckCircleFilled, CloseCircleFilled, MinusOutlined } from '@ant-design/icons'
import { maskApiKey } from '@renderer/utils/api'
import { Button, Flex, Input, List, Popconfirm, Tooltip, Typography } from 'antd'
import { Check, PenLine, X } from 'lucide-react'
import { FC, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import { StreamlineGoodHealthAndWellBeing } from '../Icons/SVGIcon'
import { ApiKeyStatus } from './types'

const STATUS_COLORS = {
  success: '#52c41a',
  error: '#ff4d4f'
}

export interface ApiKeyItemProps {
  keyStatus: ApiKeyStatus
  onUpdate: (newKey: string) => { success: boolean; error?: string }
  onRemove: () => void
  onCheck: () => Promise<void>
  disabled?: boolean
  isCopilot: boolean
  type?: 'provider' | 'websearch'
  isNew?: boolean
}

const ApiKeyItem: FC<ApiKeyItemProps> = ({
  keyStatus,
  onUpdate,
  onRemove,
  onCheck,
  disabled: _disabled = false,
  isCopilot,
  type = 'provider',
  isNew = false
}) => {
  const [isEditing, setIsEditing] = useState(isNew || !keyStatus.key.trim())
  const [editValue, setEditValue] = useState(keyStatus.key)
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)
  const editInputRef = useRef<any>(null)
  const { t } = useTranslation()
  const disabled = keyStatus.checking || _disabled

  useEffect(() => {
    if (isEditing && editInputRef.current) {
      editInputRef.current.focus()
    }
  }, [isEditing])

  useEffect(() => {
    setHasUnsavedChanges(editValue.trim() !== keyStatus.key.trim())
  }, [editValue, keyStatus.key])

  const handleEditKey = () => {
    if (disabled) return
    setIsEditing(true)
    setEditValue(keyStatus.key)
  }

  const handleSaveEdit = () => {
    if (!editValue.trim()) return

    const result = onUpdate(editValue)
    if (result.success) {
      setIsEditing(false)
    }
  }

  const handleCancelEdit = () => {
    if (isNew || !keyStatus.key.trim()) {
      onRemove()
    } else {
      setEditValue(keyStatus.key)
      setIsEditing(false)
    }
  }

  const renderStatusIcon = () => {
    if (!keyStatus.checking && keyStatus.isValid === true) {
      return <CheckCircleFilled style={{ color: STATUS_COLORS.success }} />
    }

    if (!keyStatus.checking && keyStatus.isValid === false) {
      return <CloseCircleFilled style={{ color: STATUS_COLORS.error }} />
    }

    return null
  }

  const renderKeyCheckResultTooltip = () => {
    if (keyStatus.checking) {
      return t('settings.models.check.checking')
    }

    const statusTitle = keyStatus.isValid ? t('settings.models.check.passed') : t('settings.models.check.failed')
    const statusColor = keyStatus.isValid ? STATUS_COLORS.success : STATUS_COLORS.error

    return (
      <div style={{ maxHeight: '200px', overflowY: 'auto', maxWidth: '300px', wordWrap: 'break-word' }}>
        <strong style={{ color: statusColor }}>{statusTitle}</strong>
        {type === 'provider' && keyStatus.model && (
          <div style={{ marginTop: 5 }}>
            {t('common.model')}: {keyStatus.model.name}
          </div>
        )}
        {keyStatus.latency && keyStatus.isValid && (
          <div style={{ marginTop: 5 }}>
            {t('settings.provider.api.key.check.latency')}: {(keyStatus.latency / 1000).toFixed(2)}s
          </div>
        )}
        {keyStatus.error && <div style={{ marginTop: 5 }}>{keyStatus.error}</div>}
      </div>
    )
  }

  return (
    <ApiKeyItemContainer>
      {isEditing ? (
        <ItemInnerContainer style={{ gap: '10px' }}>
          <Input.Password
            ref={editInputRef}
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onPressEnter={handleSaveEdit}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault()
                handleCancelEdit()
              }
            }}
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
                onClick={handleSaveEdit}
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
            <Tooltip title={renderKeyCheckResultTooltip()}>{renderStatusIcon()}</Tooltip>

            {!isCopilot && (
              <Flex gap={0} align="center">
                <Tooltip title={t('settings.provider.check')} mouseLeaveDelay={0}>
                  <Button
                    type="text"
                    icon={<StreamlineGoodHealthAndWellBeing size={'1.2em'} isActive={keyStatus.checking} />}
                    onClick={onCheck}
                    disabled={disabled || isCopilot}
                    className={keyStatus.checking ? '' : 'optional-item-button'}
                  />
                </Tooltip>
                <Tooltip title={t('common.edit')} mouseLeaveDelay={0}>
                  <Button
                    type="text"
                    icon={<PenLine size={16} />}
                    onClick={handleEditKey}
                    disabled={disabled}
                    className="optional-item-button"
                  />
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
            )}
          </Flex>
        </ItemInnerContainer>
      )}
    </ApiKeyItemContainer>
  )
}

const ApiKeyItemContainer = styled(List.Item)`
  padding: 4px 11px;

  .optional-item-button {
    overflow: hidden;
    max-width: 0;
    opacity: 0;
    will-change: max-width, opacity;
    transition:
      max-width 0.3s ease,
      opacity 0.3s;
    white-space: nowrap;
  }

  &:hover {
    .optional-item-button {
      max-width: 3rem;
      opacity: 1;
    }
  }
`

const ItemInnerContainer = styled.div`
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding: 0;
  margin: 0;
`

export default ApiKeyItem
