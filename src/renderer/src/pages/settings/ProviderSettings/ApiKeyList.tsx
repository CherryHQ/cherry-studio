import {
  CheckCircleFilled,
  CloseCircleFilled,
  CloseCircleOutlined,
  DeleteOutlined,
  EditOutlined,
  LoadingOutlined,
  MinusCircleOutlined,
  PlusOutlined
} from '@ant-design/icons'
import Scrollbar from '@renderer/components/Scrollbar'
import { isEmbeddingModel, isRerankModel } from '@renderer/config/models'
import { checkApi, formatApiKeys } from '@renderer/services/ApiService'
import { isProviderSupportAuth } from '@renderer/services/ProviderService'
import WebSearchService from '@renderer/services/WebSearchService'
import { Model, Provider, WebSearchProvider } from '@renderer/types'
import { maskApiKey, splitApiKeyString } from '@renderer/utils/api'
import { Button, Card, Flex, Input, List, Space, Spin, Tooltip, Typography } from 'antd'
import { isEmpty } from 'lodash'
import { FC, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import SelectProviderModelPopup from './SelectProviderModelPopup'

interface Props {
  provider: Provider | WebSearchProvider
  apiKeys: string
  onChange: (keys: string) => void
  type?: 'provider' | 'websearch'
}

interface KeyStatus {
  key: string
  isValid?: boolean
  checking?: boolean
  error?: string
  model?: Model
  latency?: number
}

const STATUS_COLORS = {
  success: '#52c41a',
  error: '#ff4d4f'
}

const formatAndConvertKeysToArray = (apiKeys: string): KeyStatus[] => {
  const formattedApiKeys = formatApiKeys(apiKeys)
  if (formattedApiKeys.includes(',')) {
    const keys = splitApiKeyString(formattedApiKeys)
    const uniqueKeys = new Set(keys)
    return Array.from(uniqueKeys).map((key) => ({ key }))
  } else {
    return formattedApiKeys ? [{ key: formattedApiKeys }] : []
  }
}

const ApiKeyList: FC<Props> = ({ provider, apiKeys, onChange, type = 'provider' }) => {
  const [keyStatuses, setKeyStatuses] = useState<KeyStatus[]>(() => formatAndConvertKeysToArray(apiKeys))
  const [isAddingNew, setIsAddingNew] = useState(false)
  const [newApiKey, setNewApiKey] = useState('')
  const [isCancelingNewKey, setIsCancelingNewKey] = useState(false)
  const newInputRef = useRef<any>(null)
  const [editingIndex, setEditingIndex] = useState<number | null>(null)
  const [editValue, setEditValue] = useState('')
  const editInputRef = useRef<any>(null)
  const { t } = useTranslation()
  const [isChecking, setIsChecking] = useState(false)
  const [isCheckingSingle, setIsCheckingSingle] = useState(false)
  const [confirmDeleteIndex, setConfirmDeleteIndex] = useState<number | null>(null)
  const isCopilot = provider.id === 'copilot'

  useEffect(() => {
    if (isAddingNew && newInputRef.current) {
      newInputRef.current.focus()
    }
  }, [isAddingNew])

  useEffect(() => {
    const newKeyStatuses = formatAndConvertKeysToArray(apiKeys)

    setKeyStatuses((currentStatuses) => {
      const newKeys = newKeyStatuses.map((k) => k.key)
      const currentKeys = currentStatuses.map((k) => k.key)

      // If the keys are the same, no need to update, prevents re-render loops.
      if (newKeys.join(',') === currentKeys.join(',')) {
        return currentStatuses
      }

      // Merge new keys with existing statuses to preserve them.
      const statusesMap = new Map(currentStatuses.map((s) => [s.key, s]))
      return newKeyStatuses.map((k) => statusesMap.get(k.key) || k)
    })
  }, [apiKeys])

  useEffect(() => {
    if (editingIndex !== null && editInputRef.current) {
      editInputRef.current.focus()
    }
  }, [editingIndex])

  const handleAddNewKey = () => {
    setIsCancelingNewKey(false)
    setIsAddingNew(true)
    setNewApiKey('')
  }

  const handleSaveNewKey = () => {
    if (isCancelingNewKey) {
      setIsCancelingNewKey(false)
      return
    }

    if (newApiKey.trim()) {
      // Check if the key already exists
      const keyExists = keyStatuses.some((status) => status.key === newApiKey.trim())

      if (keyExists) {
        window.message.error({
          key: 'duplicate-key',
          style: { marginTop: '3vh' },
          duration: 3,
          content: t('settings.provider.key_already_exists')
        })
        return
      }

      if (newApiKey.includes(',')) {
        window.message.error({
          key: 'invalid-key',
          style: { marginTop: '3vh' },
          duration: 3,
          content: t('settings.provider.invalid_key')
        })
        return
      }

      const updatedKeyStatuses = [...keyStatuses, { key: newApiKey.trim() }]
      setKeyStatuses(updatedKeyStatuses)
      // Update parent component with new keys
      onChange(updatedKeyStatuses.map((status) => status.key).join(','))
    }

    // Add a small delay before resetting to prevent immediate re-triggering
    setTimeout(() => {
      setIsAddingNew(false)
      setNewApiKey('')
    }, 100)
  }

  const handleCancelNewKey = () => {
    setIsCancelingNewKey(true)
    setIsAddingNew(false)
    setNewApiKey('')
  }

  const getModelForCheck = async (selectedModel?: Model): Promise<Model | null> => {
    if (type !== 'provider') return null

    const modelsToCheck = (provider as Provider).models.filter(
      (model) => !isEmbeddingModel(model) && !isRerankModel(model)
    )

    if (isEmpty(modelsToCheck)) {
      window.message.error({
        key: 'no-models',
        style: { marginTop: '3vh' },
        duration: 5,
        content: t('settings.provider.no_models_for_check')
      })
      return null
    }

    try {
      return (
        selectedModel ||
        (await SelectProviderModelPopup.show({
          provider: provider as Provider
        }))
      )
    } catch (err) {
      // User canceled the popup
      return null
    }
  }

  const checkSingleKey = async (keyIndex: number, selectedModel?: Model, isCheckingAll: boolean = false) => {
    if (isChecking || keyStatuses[keyIndex].checking) {
      return
    }

    try {
      let latency: number
      let model: Model | undefined

      if (type === 'provider') {
        const selectedModelForCheck = await getModelForCheck(selectedModel)
        if (!selectedModelForCheck) {
          setKeyStatuses((prev) =>
            prev.map((status, idx) => (idx === keyIndex ? { ...status, checking: false } : status))
          )
          setIsCheckingSingle(false)
          return
        }
        model = selectedModelForCheck

        setIsCheckingSingle(true)
        setKeyStatuses((prev) => prev.map((status, idx) => (idx === keyIndex ? { ...status, checking: true } : status)))

        const startTime = Date.now()
        await checkApi({ ...(provider as Provider), apiKey: keyStatuses[keyIndex].key }, model)
        latency = Date.now() - startTime
      } else {
        setIsCheckingSingle(true)
        setKeyStatuses((prev) => prev.map((status, idx) => (idx === keyIndex ? { ...status, checking: true } : status)))

        const startTime = Date.now()
        await WebSearchService.checkSearch({
          ...(provider as WebSearchProvider),
          apiKey: keyStatuses[keyIndex].key
        })
        latency = Date.now() - startTime
      }

      // Only show notification when checking a single key
      if (!isCheckingAll) {
        window.message.success({
          key: 'api-check',
          style: { marginTop: '3vh' },
          duration: 2,
          content: t('message.api.connection.success')
        })
      }

      setKeyStatuses((prev) =>
        prev.map((status, idx) =>
          idx === keyIndex
            ? {
                ...status,
                checking: false,
                isValid: true,
                model: selectedModel || model,
                latency
              }
            : status
        )
      )
    } catch (error: any) {
      // Only show notification when checking a single key
      if (!isCheckingAll) {
        const errorMessage = error?.message ? ' ' + error.message : ''
        window.message.error({
          key: 'api-check',
          style: { marginTop: '3vh' },
          duration: 8,
          content: t('message.api.connection.failed') + errorMessage
        })
      }

      setKeyStatuses((prev) =>
        prev.map((status, idx) =>
          idx === keyIndex
            ? {
                ...status,
                checking: false,
                isValid: false,
                error: error instanceof Error ? error.message : String(error)
              }
            : status
        )
      )
    } finally {
      setIsCheckingSingle(false)
    }
  }

  const checkAllKeys = async () => {
    setIsChecking(true)

    try {
      let selectedModel
      if (type === 'provider') {
        selectedModel = await getModelForCheck()
        if (!selectedModel) {
          return
        }
      }

      await Promise.all(keyStatuses.map((_, index) => checkSingleKey(index, selectedModel, true)))
    } finally {
      setIsChecking(false)
    }
  }

  const removeInvalidKeys = () => {
    const updatedKeyStatuses = keyStatuses.filter((status) => status.isValid !== false)
    setKeyStatuses(updatedKeyStatuses)
    onChange(updatedKeyStatuses.map((status) => status.key).join(','))
  }

  const removeKey = (keyIndex: number) => {
    if (confirmDeleteIndex === keyIndex) {
      // Second click - actually remove the key
      const updatedKeyStatuses = keyStatuses.filter((_, idx) => idx !== keyIndex)
      setKeyStatuses(updatedKeyStatuses)
      onChange(updatedKeyStatuses.map((status) => status.key).join(','))
      setConfirmDeleteIndex(null)
    } else {
      // First click - show confirmation state
      setConfirmDeleteIndex(keyIndex)
      // Auto-reset after 3 seconds
      setTimeout(() => {
        setConfirmDeleteIndex(null)
      }, 3000)
    }
  }

  const renderKeyCheckResultTooltip = (status: KeyStatus) => {
    if (status.checking) {
      return t('settings.models.check.checking')
    }

    const statusTitle = status.isValid ? t('settings.models.check.passed') : t('settings.models.check.failed')
    const statusColor = status.isValid ? STATUS_COLORS.success : STATUS_COLORS.error

    return (
      <div style={{ maxHeight: '200px', overflowY: 'auto', maxWidth: '300px', wordWrap: 'break-word' }}>
        <strong style={{ color: statusColor }}>{statusTitle}</strong>
        {type === 'provider' && status.model && (
          <div style={{ marginTop: 5 }}>
            {t('common.model')}: {status.model.name}
          </div>
        )}
        {status.latency && status.isValid && (
          <div style={{ marginTop: 5 }}>
            {t('settings.provider.check_tooltip.latency')}: {(status.latency / 1000).toFixed(2)}s
          </div>
        )}
        {status.error && <div style={{ marginTop: 5 }}>{status.error}</div>}
      </div>
    )
  }

  const shouldAutoFocus = () => {
    if (type === 'provider') {
      return (provider as Provider).enabled && apiKeys === '' && !isProviderSupportAuth(provider as Provider)
    } else if (type === 'websearch') {
      return apiKeys === ''
    }
    return false
  }

  const handleEditKey = (index: number) => {
    setEditingIndex(index)
    setEditValue(keyStatuses[index].key)
  }

  const handleSaveEdit = () => {
    if (editingIndex === null) return

    if (editValue.trim()) {
      const keyExists = keyStatuses.some((status, idx) => idx !== editingIndex && status.key === editValue.trim())

      if (keyExists) {
        window.message.error({
          key: 'duplicate-key',
          style: { marginTop: '3vh' },
          duration: 3,
          content: t('settings.provider.key_already_exists')
        })
        return
      }

      if (editValue.includes(',')) {
        window.message.error({
          key: 'invalid-key',
          style: { marginTop: '3vh' },
          duration: 3,
          content: t('settings.provider.invalid_key')
        })
        return
      }

      const updatedKeyStatuses = [...keyStatuses]
      updatedKeyStatuses[editingIndex] = {
        ...updatedKeyStatuses[editingIndex],
        key: editValue.trim(),
        isValid: undefined
      }

      setKeyStatuses(updatedKeyStatuses)
      onChange(updatedKeyStatuses.map((status) => status.key).join(','))
    }

    // Add a small delay before resetting to prevent immediate re-triggering
    setTimeout(() => {
      setEditingIndex(null)
      setEditValue('')
    }, 100)
  }

  const handleCancelEdit = () => {
    setEditingIndex(null)
    setEditValue('')
  }

  return (
    <>
      <Card
        size="small"
        type="inner"
        styles={{ body: { padding: 0 } }}
        style={{ marginBottom: '10px', border: '0.5px solid var(--color-border)' }}>
        {keyStatuses.length === 0 && !isAddingNew ? (
          <Typography.Text type="secondary" style={{ padding: '4px 11px', display: 'block' }}>
            {t('error.no_api_key')}
          </Typography.Text>
        ) : (
          <>
            {keyStatuses.length > 0 && (
              <Scrollbar style={{ maxHeight: '50vh', overflowX: 'hidden' }}>
                <List
                  size="small"
                  dataSource={keyStatuses}
                  renderItem={(status, index) => (
                    <List.Item style={{ padding: '4px 11px' }}>
                      <ApiKeyListItem>
                        <ApiKeyContainer>
                          {editingIndex === index ? (
                            <Input.Password
                              ref={editInputRef}
                              value={editValue}
                              onChange={(e) => setEditValue(e.target.value)}
                              onBlur={handleSaveEdit}
                              onPressEnter={handleSaveEdit}
                              onKeyDown={(e) => {
                                if (e.key === 'Escape') {
                                  e.preventDefault()
                                  handleCancelEdit()
                                }
                              }}
                              style={{ width: '100%', fontSize: '14px' }}
                              spellCheck={false}
                              type="password"
                            />
                          ) : (
                            <Typography.Text copyable={{ text: status.key }}>{maskApiKey(status.key)}</Typography.Text>
                          )}
                        </ApiKeyContainer>
                        <ApiKeyActions>
                          {editingIndex === index ? (
                            <CloseCircleOutlined
                              onClick={handleCancelEdit}
                              title={t('common.cancel')}
                              style={{
                                cursor: 'pointer',
                                fontSize: '16px',
                                color: 'var(--color-error)'
                              }}
                            />
                          ) : (
                            <>
                              <Tooltip title={renderKeyCheckResultTooltip(status)}>
                                {status.checking && (
                                  <Space>
                                    <Spin indicator={<LoadingOutlined style={{ fontSize: 16 }} spin />} />
                                  </Space>
                                )}
                                {status.isValid === true && !status.checking && (
                                  <CheckCircleFilled style={{ color: STATUS_COLORS.success }} />
                                )}
                                {status.isValid === false && !status.checking && (
                                  <CloseCircleFilled style={{ color: STATUS_COLORS.error }} />
                                )}
                              </Tooltip>
                              <Button
                                size="small"
                                onClick={() => checkSingleKey(index)}
                                disabled={isChecking || isCheckingSingle || isCopilot}>
                                {t('settings.provider.check')}
                              </Button>
                              {!isCopilot && (
                                <>
                                  <EditOutlined
                                    onClick={() => !isChecking && !isCheckingSingle && handleEditKey(index)}
                                    style={{
                                      cursor: isChecking || isCheckingSingle ? 'not-allowed' : 'pointer',
                                      opacity: isChecking || isCheckingSingle ? 0.5 : 1,
                                      fontSize: '16px'
                                    }}
                                    title={t('common.edit')}
                                  />
                                  {confirmDeleteIndex === index ? (
                                    <DeleteOutlined
                                      onClick={() => !isChecking && !isCheckingSingle && removeKey(index)}
                                      style={{
                                        cursor: isChecking || isCheckingSingle ? 'not-allowed' : 'pointer',
                                        opacity: isChecking || isCheckingSingle ? 0.5 : 1,
                                        fontSize: '16px',
                                        color: 'var(--color-error)'
                                      }}
                                      title={t('common.delete')}
                                    />
                                  ) : (
                                    <MinusCircleOutlined
                                      onClick={() => !isChecking && !isCheckingSingle && removeKey(index)}
                                      style={{
                                        cursor: isChecking || isCheckingSingle ? 'not-allowed' : 'pointer',
                                        opacity: isChecking || isCheckingSingle ? 0.5 : 1,
                                        fontSize: '16px',
                                        color: 'var(--color-error)'
                                      }}
                                      title={t('common.delete')}
                                    />
                                  )}
                                </>
                              )}
                            </>
                          )}
                        </ApiKeyActions>
                      </ApiKeyListItem>
                    </List.Item>
                  )}
                />
              </Scrollbar>
            )}
            {isAddingNew && (
              <List.Item style={{ padding: '4px 11px' }}>
                <ApiKeyListItem>
                  <Input.Password
                    ref={newInputRef}
                    value={newApiKey}
                    onChange={(e) => setNewApiKey(e.target.value)}
                    placeholder={t('settings.provider.enter_new_api_key')}
                    style={{ width: '60%', fontSize: '14px' }}
                    onPressEnter={handleSaveNewKey}
                    onBlur={handleSaveNewKey}
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') {
                        e.preventDefault()
                        handleCancelNewKey()
                      }
                    }}
                    spellCheck={false}
                    type="password"
                  />
                  <ApiKeyActions>
                    <CloseCircleOutlined
                      onMouseDown={handleCancelNewKey}
                      title={t('common.cancel')}
                      style={{
                        cursor: isChecking || isCheckingSingle ? 'not-allowed' : 'pointer',
                        opacity: isChecking || isCheckingSingle ? 0.5 : 1,
                        fontSize: '16px',
                        color: 'var(--color-error)'
                      }}
                    />
                  </ApiKeyActions>
                </ApiKeyListItem>
              </List.Item>
            )}
          </>
        )}
      </Card>

      <Flex gap={10} justify="space-between" style={{ marginTop: '8px' }}>
        {!isCopilot && (
          <>
            <Space>
              <Button
                key="add"
                type="primary"
                onClick={editingIndex !== null ? handleSaveEdit : isAddingNew ? handleSaveNewKey : handleAddNewKey}
                icon={<PlusOutlined />}
                autoFocus={shouldAutoFocus()}>
                {editingIndex !== null || isAddingNew ? t('common.save') : t('common.add')}
              </Button>
            </Space>
            {keyStatuses.length > 1 && (
              <Space>
                <Button key="check" type="default" onClick={checkAllKeys} disabled={isChecking || isCheckingSingle}>
                  {t('settings.provider.check_all_keys')}
                </Button>
                <Button
                  key="remove"
                  type="default"
                  danger
                  onClick={removeInvalidKeys}
                  disabled={isChecking || isCheckingSingle}>
                  {t('settings.provider.remove_invalid_keys')}
                </Button>
              </Space>
            )}
          </>
        )}
      </Flex>
    </>
  )
}

// Styled components for the list items
const ApiKeyListItem = styled.div`
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding: 0;
  margin: 0;
`

const ApiKeyContainer = styled.div`
  display: flex;
  flex-direction: row;
  align-items: center;
`

const ApiKeyActions = styled.div`
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 10px;

  @keyframes pulse {
    0% {
      opacity: 1;
    }
    50% {
      opacity: 0.5;
    }
    100% {
      opacity: 1;
    }
  }
`

export default ApiKeyList
