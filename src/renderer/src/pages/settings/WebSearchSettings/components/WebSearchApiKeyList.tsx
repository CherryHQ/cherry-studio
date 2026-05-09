import { Button, Flex } from '@cherrystudio/ui'
import { EditIcon } from '@renderer/components/Icons'
import Scrollbar from '@renderer/components/Scrollbar'
import { TopView } from '@renderer/components/TopView'
import { useWebSearchProviders } from '@renderer/hooks/useWebSearch'
import { SettingHelpText } from '@renderer/pages/settings'
import type { ApiKeyWithStatus } from '@renderer/types/healthCheck'
import { HealthStatus } from '@renderer/types/healthCheck'
import { maskApiKey } from '@renderer/utils/api'
import type { WebSearchProviderId } from '@shared/data/preference/preferenceTypes'
import type { InputRef } from 'antd'
import { Card, Input, List, Modal, Popconfirm, Space, Typography } from 'antd'
import { Check, Minus, Plus, X } from 'lucide-react'
import type { FC } from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

type ApiKeyValidity =
  | {
      isValid: true
      error?: never
    }
  | {
      isValid: false
      error: string
    }

interface WebSearchApiKeyListProps {
  providerId: WebSearchProviderId
}

const validateApiKey = (
  key: string,
  existingKeys: string[],
  emptyError: string,
  duplicateError: string
): ApiKeyValidity => {
  const trimmedKey = key.trim()

  if (!trimmedKey) {
    return { isValid: false, error: emptyError }
  }

  if (existingKeys.includes(trimmedKey)) {
    return { isValid: false, error: duplicateError }
  }

  return { isValid: true }
}

interface WebSearchApiKeyItemProps {
  keyStatus: ApiKeyWithStatus
  onUpdate: (newKey: string) => ApiKeyValidity
  onRemove: () => void
  isNew?: boolean
}

const WebSearchApiKeyItem: FC<WebSearchApiKeyItemProps> = ({ keyStatus, onUpdate, onRemove, isNew = false }) => {
  const { t } = useTranslation()
  const [isEditing, setIsEditing] = useState(isNew || !keyStatus.key.trim())
  const [editValue, setEditValue] = useState(keyStatus.key)
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)
  const inputRef = useRef<InputRef>(null)

  useEffect(() => {
    if (isEditing) {
      inputRef.current?.focus()
    }
  }, [isEditing])

  useEffect(() => {
    setHasUnsavedChanges(editValue.trim() !== keyStatus.key.trim())
  }, [editValue, keyStatus.key])

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
      onRemove()
      return
    }

    setEditValue(keyStatus.key)
    setIsEditing(false)
  }

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
            />
            <Flex className="items-center gap-0">
              <Button variant={hasUnsavedChanges ? 'default' : 'ghost'} onClick={handleSave} size="icon">
                <Check size={16} />
              </Button>
              <Button variant="ghost" onClick={handleCancelEdit} size="icon">
                <X size={16} />
              </Button>
            </Flex>
          </>
        ) : (
          <>
            <Typography.Text copyable={{ text: keyStatus.key }} style={{ cursor: 'help' }}>
              {maskApiKey(keyStatus.key)}
            </Typography.Text>
            <Flex className="items-center gap-0">
              <Button variant="ghost" onClick={() => setIsEditing(true)} size="icon">
                <EditIcon size={16} />
              </Button>
              <Popconfirm
                title={t('common.delete_confirm')}
                onConfirm={onRemove}
                okText={t('common.confirm')}
                cancelText={t('common.cancel')}
                okButtonProps={{ color: 'danger' }}>
                <Button variant="ghost" size="icon">
                  <Minus size={16} />
                </Button>
              </Popconfirm>
            </Flex>
          </>
        )}
      </ItemInnerContainer>
    </List.Item>
  )
}

export const WebSearchApiKeyList: FC<WebSearchApiKeyListProps> = ({ providerId }) => {
  const { getProvider, updateProvider } = useWebSearchProviders()
  const { t } = useTranslation()
  const [pendingNewKey, setPendingNewKey] = useState<{ key: string; id: string } | null>(null)
  const provider = getProvider(providerId)
  const keys = useMemo(
    () => Array.from(new Set(provider?.apiKeys.map((key) => key.trim()).filter(Boolean) ?? [])),
    [provider?.apiKeys]
  )

  const keysWithStatus = useMemo<ApiKeyWithStatus[]>(
    () =>
      keys.map((key) => ({
        key,
        status: HealthStatus.NOT_CHECKED,
        checking: false
      })),
    [keys]
  )

  const updateKeys = (nextKeys: string[]) => {
    if (!provider) {
      return
    }

    const apiKeys = Array.from(new Set(nextKeys.map((key) => key.trim()).filter(Boolean)))
    void updateProvider(provider.id, { apiKeys })
  }

  if (!provider) {
    throw new Error(`Web search provider with id ${providerId} not found`)
  }

  const addKey = (key: string): ApiKeyValidity => {
    const result = validateApiKey(
      key,
      keys,
      t('settings.provider.api.key.error.empty'),
      t('settings.provider.api.key.error.duplicate')
    )

    if (!result.isValid) {
      return result
    }

    updateKeys([...keys, key])
    return { isValid: true }
  }

  const updateKey = (index: number, key: string): ApiKeyValidity => {
    if (index < 0 || index >= keys.length) {
      return { isValid: false, error: 'Invalid index' }
    }

    const otherKeys = keys.filter((_, i) => i !== index)
    const result = validateApiKey(
      key,
      otherKeys,
      t('settings.provider.api.key.error.empty'),
      t('settings.provider.api.key.error.duplicate')
    )

    if (!result.isValid) {
      return result
    }

    const nextKeys = [...keys]
    nextKeys[index] = key
    updateKeys(nextKeys)
    return { isValid: true }
  }

  const removeKey = (index: number) => {
    if (index < 0 || index >= keys.length) {
      return
    }

    updateKeys(keys.filter((_, i) => i !== index))
  }

  const handleAddNew = () => {
    setPendingNewKey({ key: '', id: Date.now().toString() })
  }

  const handleUpdate = (index: number, key: string, isNew: boolean) => {
    if (isNew) {
      const result = addKey(key)
      if (result.isValid) {
        setPendingNewKey(null)
      }
      return result
    }

    return updateKey(index, key)
  }

  const handleRemove = (index: number, isNew: boolean) => {
    if (isNew) {
      setPendingNewKey(null)
      return
    }

    removeKey(index)
  }

  const displayKeys: ApiKeyWithStatus[] = pendingNewKey
    ? [
        ...keysWithStatus,
        {
          key: pendingNewKey.key,
          status: HealthStatus.NOT_CHECKED,
          checking: false
        }
      ]
    : keysWithStatus

  return (
    <ListContainer>
      <Card
        size="small"
        type="inner"
        styles={{ body: { padding: 0 } }}
        style={{ marginBottom: '5px', border: '0.5px solid var(--color-border)' }}>
        {displayKeys.length === 0 ? (
          <Typography.Text type="secondary" style={{ padding: '4px 11px', display: 'block' }}>
            {t('error.no_api_key')}
          </Typography.Text>
        ) : (
          <Scrollbar style={{ maxHeight: '60vh', overflowX: 'hidden' }}>
            <List
              size="small"
              dataSource={displayKeys}
              renderItem={(keyStatus, index) => {
                const isNew = pendingNewKey && index === displayKeys.length - 1
                return (
                  <WebSearchApiKeyItem
                    key={isNew ? pendingNewKey.id : index}
                    keyStatus={keyStatus}
                    isNew={!!isNew}
                    onUpdate={(key) => handleUpdate(index, key, !!isNew)}
                    onRemove={() => handleRemove(index, !!isNew)}
                  />
                )
              }}
            />
          </Scrollbar>
        )}
      </Card>

      <Flex className="mt-[15px] flex-row items-center justify-between">
        <SettingHelpText>{t('settings.provider.api_key.tip')}</SettingHelpText>

        <Space style={{ gap: 6 }}>
          <Button key="add" onClick={handleAddNew} autoFocus={keys.length === 0} disabled={!!pendingNewKey}>
            <Plus size={16} />
            {t('common.add')}
          </Button>
        </Space>
      </Flex>
    </ListContainer>
  )
}

interface ShowParams {
  providerId: WebSearchProviderId
  title?: string
}

interface PopupProps extends ShowParams {
  resolve: (value: unknown) => void
}

const PopupContainer: FC<PopupProps> = ({ providerId, title, resolve }) => {
  const [open, setOpen] = useState(true)
  const { t } = useTranslation()

  return (
    <Modal
      title={title || t('settings.provider.api.key.list.title')}
      open={open}
      onCancel={() => setOpen(false)}
      afterClose={() => resolve(null)}
      transitionName="animation-move-down"
      centered
      width={600}
      footer={null}>
      <WebSearchApiKeyList providerId={providerId} />
    </Modal>
  )
}

const TopViewKey = 'WebSearchApiKeyListPopup'

export class WebSearchApiKeyListPopup {
  static show(props: ShowParams) {
    return new Promise<unknown>((resolve) => {
      TopView.show(
        <PopupContainer
          {...props}
          resolve={(value) => {
            resolve(value)
            TopView.hide(TopViewKey)
          }}
        />,
        TopViewKey
      )
    })
  }
}

const ListContainer = styled.div`
  padding-top: 15px;
  padding-bottom: 15px;
`

const ItemInnerContainer = styled(Flex)`
  flex: 1;
  justify-content: space-between;
  align-items: center;
`
