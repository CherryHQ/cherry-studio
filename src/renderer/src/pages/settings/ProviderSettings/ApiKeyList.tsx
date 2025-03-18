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
import { Button, Card, Flex, Input, List, message, Space, Typography } from 'antd'
import { FC, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

interface Props {
  provider: Provider | WebSearchProvider
  model?: Model
  apiKeys: string
  onChange: (keys: string) => void
  type?: 'provider' | 'websearch'
}

interface KeyStatus {
  key: string
  isValid?: boolean
  checking?: boolean
}

const ApiKeyList: FC<Props> = ({ provider, model, apiKeys, onChange, type = 'provider' }) => {
  const [keyStatuses, setKeyStatuses] = useState<KeyStatus[]>(() => {
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
  })
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

  const checkSingleKey = async (keyIndex: number) => {
    if (isChecking || keyStatuses[keyIndex].checking) {
      return
    }

    setIsCheckingSingle(true)
    setKeyStatuses((prev) => prev.map((status, idx) => (idx === keyIndex ? { ...status, checking: true } : status)))

    try {
      let valid = false
      if (type === 'provider') {
        if (!model) {
          window.message.error({ content: t('message.error.enter.model'), key: 'api-check' })
          throw new Error(t('message.error.enter.model'))
        }
        const result = await checkApi({ ...(provider as Provider), apiKey: keyStatuses[keyIndex].key }, model)
        valid = result.valid
      } else {
        const result = await WebSearchService.checkSearch({
          ...(provider as WebSearchProvider),
          apiKey: keyStatuses[keyIndex].key
        })
        valid = result.valid
      }

      setKeyStatuses((prev) =>
        prev.map((status, idx) => (idx === keyIndex ? { ...status, checking: false, isValid: valid } : status))
      )
    } catch (error) {
      setKeyStatuses((prev) =>
        prev.map((status, idx) => (idx === keyIndex ? { ...status, checking: false, isValid: false } : status))
      )
    } finally {
      setIsCheckingSingle(false)
    }
  }

  const checkAllKeys = async () => {
    setIsChecking(true)

    // Error handling is already done in checkSingleKey
    try {
      for (let i = 0; i < keyStatuses.length; i++) {
        await checkSingleKey(i)
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

  return (
    <>
      <Card size="small" type="inner" style={{ marginBottom: '10px', border: '0.5px solid var(--color-border)' }}>
        {keyStatuses.length === 0 && !isAddingNew ? (
          <Typography.Text type="secondary">{t('error.no_api_key')}</Typography.Text>
        ) : (
          <>
            {keyStatuses.length > 0 && (
              <Scrollbar style={{ maxHeight: '50vh', overflowX: 'hidden' }}>
                <List
                  size="small"
                  dataSource={keyStatuses}
                  renderItem={(status, index) => (
                    <List.Item style={{ padding: '4px 0px' }}>
                      <ApiKeyListItem>
                        <ApiKeyContainer>
                          <Typography.Text copyable={{ text: status.key }}>{maskApiKey(status.key)}</Typography.Text>
                        </ApiKeyContainer>
                        <ApiKeyActions>
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
              <List.Item style={{ padding: '4px 0px' }}>
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
        return 'var(--color-text)'
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
