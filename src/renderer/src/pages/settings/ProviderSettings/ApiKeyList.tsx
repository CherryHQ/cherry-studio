import {
  CheckCircleFilled,
  CheckCircleOutlined,
  CloseCircleFilled,
  CloseCircleOutlined,
  LoadingOutlined,
  MinusCircleOutlined,
  PlusOutlined,
  RedoOutlined
} from '@ant-design/icons'
import Scrollbar from '@renderer/components/Scrollbar'
import { checkApi, formatApiKeys } from '@renderer/services/ApiService'
import WebSearchService from '@renderer/services/WebSearchService'
import { Model, Provider, WebSearchProvider } from '@renderer/types'
import { maskApiKey } from '@renderer/utils/api'
import { Button, Card, Flex, Input, List, message, Space, Tooltip, Typography } from 'antd'
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
  error: '#ff4d4f',
  warning: '#faad14'
}

const formatAndConvertKeysToArray = (apiKeys: string): KeyStatus[] => {
  const formattedApiKeys = formatApiKeys(apiKeys)
  if (formattedApiKeys.includes(',')) {
    const keys = formattedApiKeys
      .split(',')
      .map((k) => k.trim())
      .filter((k) => k)
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
  const newInputRef = useRef<any>(null)
  const { t } = useTranslation()
  const [isChecking, setIsChecking] = useState(false)
  const [isCheckingSingle, setIsCheckingSingle] = useState(false)

  useEffect(() => {
    if (isAddingNew && newInputRef.current) {
      newInputRef.current.focus()
    }
  }, [isAddingNew])

  useEffect(() => {
    setKeyStatuses(formatAndConvertKeysToArray(apiKeys))
  }, [apiKeys])

  const handleAddNewKey = () => {
    setIsAddingNew(true)
    setNewApiKey('')
  }

  const handleSaveNewKey = () => {
    if (newApiKey.trim()) {
      // Check if the key already exists
      const keyExists = keyStatuses.some((status) => status.key === newApiKey.trim())

      if (keyExists) {
        message.error({
          key: 'duplicate-key',
          style: { marginTop: '3vh' },
          duration: 3,
          content: t('settings.provider.key_already_exists')
        })
        return
      }

      if (newApiKey.includes(',')) {
        message.error({
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
    setIsAddingNew(false)
    setNewApiKey('')
  }

  const handleCancelNewKey = () => {
    setIsAddingNew(false)
    setNewApiKey('')
  }

  const checkSingleKey = async (keyIndex: number, selectedModel?: Model) => {
    if (isChecking || keyStatuses[keyIndex].checking) {
      return
    }

    setIsCheckingSingle(true)
    setKeyStatuses((prev) => prev.map((status, idx) => (idx === keyIndex ? { ...status, checking: true } : status)))

    try {
      let latency: number
      let result: { valid: boolean; error?: any }
      let model: Model | undefined

      if (type === 'provider') {
        try {
          model =
            selectedModel ||
            (await SelectProviderModelPopup.show({
              provider: provider as Provider
            }))
        } catch (err) {
          // User canceled the popup, just stop checking without marking as failed
          setKeyStatuses((prev) =>
            prev.map((status, idx) => (idx === keyIndex ? { ...status, checking: false } : status))
          )
          setIsCheckingSingle(false)
          return
        }

        const startTime = Date.now()
        result = await checkApi({ ...(provider as Provider), apiKey: keyStatuses[keyIndex].key }, model)
        latency = Date.now() - startTime
      } else {
        const startTime = Date.now()
        result = await WebSearchService.checkSearch({
          ...(provider as WebSearchProvider),
          apiKey: keyStatuses[keyIndex].key
        })
        latency = Date.now() - startTime
      }

      const { valid, error } = result
      const errorMessage = error?.message ? ' ' + error.message : ''
      window.message[valid ? 'success' : 'error']({
        key: 'api-check',
        style: { marginTop: '3vh' },
        duration: valid ? 2 : 8,
        content: valid ? t('settings.websearch.check_success') : t('settings.websearch.check_failed') + errorMessage
      })

      setKeyStatuses((prev) =>
        prev.map((status, idx) =>
          idx === keyIndex
            ? {
                ...status,
                checking: false,
                isValid: valid,
                error: error?.message,
                model: selectedModel || model,
                latency
              }
            : status
        )
      )
    } catch (error) {
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
        try {
          selectedModel = await SelectProviderModelPopup.show({ provider: provider as Provider })
          if (!selectedModel) {
            window.message.error({ content: t('message.error.enter.model'), key: 'api-check' })
            return
          }
        } catch (err) {
          // User canceled the popup, just stop checking
          return
        }
      }

      for (let i = 0; i < keyStatuses.length; i++) {
        await checkSingleKey(i, selectedModel)
      }
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
    const updatedKeyStatuses = keyStatuses.filter((_, idx) => idx !== keyIndex)
    setKeyStatuses(updatedKeyStatuses)
    onChange(updatedKeyStatuses.map((status) => status.key).join(','))
  }

  const renderKeyCheckResultTooltip = (status: KeyStatus) => {
    if (status.checking) {
      return t('settings.models.check.checking')
    }

    const statusTitle = status.isValid
      ? t('settings.models.check.passed')
      : `${t('settings.models.check.failed')}${status.error ? ` (${status.error})` : ''}`
    const statusColor = status.isValid ? STATUS_COLORS.success : STATUS_COLORS.error

    return (
      <div>
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
      </div>
    )
  }

  return (
    <>
      <Card
        size="small"
        type="inner"
        styles={{ body: { padding: 0 } }}
        style={{ marginBottom: '10px', border: '0.5px solid var(--color-border)' }}>
        {keyStatuses.length === 0 && !isAddingNew ? (
          <Typography.Text type="secondary" style={{ padding: '8px 12px', display: 'block' }}>
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
                    <List.Item style={{ padding: '8px 12px' }}>
                      <ApiKeyListItem>
                        <ApiKeyContainer>
                          <Typography.Text copyable={{ text: status.key }}>{maskApiKey(status.key)}</Typography.Text>
                        </ApiKeyContainer>
                        <ApiKeyActions>
                          <Tooltip title={renderKeyCheckResultTooltip(status)}>
                            {status.checking && (
                              <StatusIndicator type="checking">
                                <LoadingOutlined style={{ fontSize: 16 }} spin />
                              </StatusIndicator>
                            )}
                            {status.isValid === true && !status.checking && (
                              <StatusIndicator type="success">
                                <CheckCircleFilled />
                              </StatusIndicator>
                            )}
                            {status.isValid === false && !status.checking && (
                              <StatusIndicator type="error">
                                <CloseCircleFilled />
                              </StatusIndicator>
                            )}
                          </Tooltip>
                          <CheckButton
                            onClick={() => checkSingleKey(index)}
                            style={{
                              cursor: isChecking || isCheckingSingle ? 'not-allowed' : 'pointer',
                              opacity: isChecking || isCheckingSingle ? 0.5 : 1
                            }}
                            title={t('settings.provider.check')}
                          />
                          <RemoveButton
                            onClick={() => !isChecking && !isCheckingSingle && removeKey(index)}
                            style={{
                              cursor: isChecking || isCheckingSingle ? 'not-allowed' : 'pointer',
                              opacity: isChecking || isCheckingSingle ? 0.5 : 1
                            }}
                          />
                        </ApiKeyActions>
                      </ApiKeyListItem>
                    </List.Item>
                  )}
                />
              </Scrollbar>
            )}
            {isAddingNew && (
              <List.Item style={{ padding: '8px 12px' }}>
                <ApiKeyListItem>
                  <Input.Password
                    ref={newInputRef}
                    value={newApiKey}
                    onChange={(e) => setNewApiKey(e.target.value)}
                    placeholder={t('settings.provider.enter_new_api_key')}
                    style={{ width: '60%', fontSize: '14px' }}
                    onPressEnter={handleSaveNewKey}
                    spellCheck={false}
                    type="password"
                  />
                  <ApiKeyActions>
                    <CheckCircleOutlined
                      style={{ fontSize: '20px', cursor: 'pointer', color: '#52c41a' }}
                      onClick={handleSaveNewKey}
                    />
                    <CloseCircleOutlined
                      style={{ fontSize: '20px', cursor: 'pointer', color: '#ff4d4f' }}
                      onClick={handleCancelNewKey}
                    />
                  </ApiKeyActions>
                </ApiKeyListItem>
              </List.Item>
            )}
          </>
        )}
      </Card>

      <Flex gap={10} style={{ marginTop: '8px' }}>
        <Space>
          <Button key="add" type="primary" onClick={handleAddNewKey} icon={<PlusOutlined />} disabled={isAddingNew}>
            {t('common.add')}
          </Button>
          <Button key="check" type="default" onClick={checkAllKeys} disabled={isChecking || isCheckingSingle}>
            {t('settings.provider.check_all_keys')}
          </Button>
        </Space>
        <Space>
          <Button
            key="remove"
            type="default"
            danger
            onClick={removeInvalidKeys}
            disabled={isChecking || isCheckingSingle}>
            {t('settings.provider.remove_invalid_keys')}
          </Button>
        </Space>
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
`

const StatusIndicator = styled.div<{ type: string }>`
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  cursor: pointer;
  color: ${(props) => {
    switch (props.type) {
      case 'success':
        return '#52c41a'
      case 'error':
        return '#ff4d4f'
      default:
        return 'var(--color-link)'
    }
  }};
`

const CheckButton = styled(RedoOutlined)`
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  color: var(--color-link);
  cursor: pointer;
  transition: all 0.2s ease-in-out;
`

const RemoveButton = styled(MinusCircleOutlined)`
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  color: var(--color-error);
  cursor: pointer;
  transition: all 0.2s ease-in-out;
`

export default ApiKeyList
