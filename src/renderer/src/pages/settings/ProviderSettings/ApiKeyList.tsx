import {
  CheckCircleFilled,
  CheckCircleTwoTone,
  CloseCircleFilled,
  CloseCircleTwoTone,
  LoadingOutlined,
  MinusCircleOutlined,
  PlusOutlined
} from '@ant-design/icons'
import { checkApi, formatApiKeys } from '@renderer/services/ApiService'
import WebSearchService from '@renderer/services/WebSearchService'
import { Model, Provider, WebSearchProvider } from '@renderer/types'
import { maskApiKey } from '@renderer/utils/api'
import { Button, Input, List, message, Space, Spin, Typography } from 'antd'
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
      return [{ key: formattedApiKeys }]
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
      <List
        dataSource={keyStatuses}
        renderItem={(status, index) => (
          <List.Item>
            <Space style={{ width: '100%', justifyContent: 'space-between' }}>
              <Typography.Text copyable={{ text: status.key }}>{maskApiKey(status.key)}</Typography.Text>
              <Space>
                {status.checking && (
                  <Space>
                    <Spin indicator={<LoadingOutlined style={{ fontSize: 16 }} spin />} />
                  </Space>
                )}
                {status.isValid === true && !status.checking && <CheckCircleFilled style={{ color: '#52c41a' }} />}
                {status.isValid === false && !status.checking && <CloseCircleFilled style={{ color: '#ff4d4f' }} />}
                {status.isValid === undefined && !status.checking && <span>{t('settings.provider.not_checked')}</span>}
                <Button size="small" onClick={() => checkSingleKey(index)} disabled={isChecking || isCheckingSingle}>
                  {t('settings.provider.check')}
                </Button>
                <RemoveIcon
                  onClick={() => !isChecking && !isCheckingSingle && removeKey(index)}
                  style={{
                    cursor: isChecking || isCheckingSingle ? 'not-allowed' : 'pointer',
                    opacity: isChecking || isCheckingSingle ? 0.5 : 1
                  }}
                />
              </Space>
            </Space>
          </List.Item>
        )}
      />
      {isAddingNew && (
        <List.Item>
          <Space style={{ width: '100%', justifyContent: 'space-between' }}>
            <Input.Password
              ref={newInputRef}
              value={newApiKey}
              onChange={(e) => setNewApiKey(e.target.value)}
              placeholder={t('settings.provider.enter_new_api_key')}
              style={{ width: '90%' }}
              onPressEnter={handleSaveNewKey}
              spellCheck={false}
              type="password"
            />
            <Space>
              <CheckCircleTwoTone
                twoToneColor="#52c41a"
                style={{ fontSize: '20px', cursor: 'pointer' }}
                onClick={handleSaveNewKey}
              />
              <CloseCircleTwoTone
                twoToneColor="#ff4d4f"
                style={{ fontSize: '20px', cursor: 'pointer' }}
                onClick={handleCancelNewKey}
              />
            </Space>
          </Space>
        </List.Item>
      )}
      <Space style={{ display: 'flex', justifyContent: 'space-between' }}>
        <Space>
          <Button key="remove" danger onClick={removeInvalidKeys} disabled={isChecking || isCheckingSingle}>
            {t('settings.provider.remove_invalid_keys')}
          </Button>
        </Space>
        <Space>
          <Button key="check" type="primary" ghost onClick={checkAllKeys} disabled={isChecking || isCheckingSingle}>
            {t('settings.provider.check_all_keys')}
          </Button>
          <Button
            key="add"
            type="primary"
            ghost
            onClick={handleAddNewKey}
            icon={<PlusOutlined />}
            disabled={isAddingNew}>
            {t('common.add')}
          </Button>
        </Space>
      </Space>
    </>
  )
}

const RemoveIcon = styled(MinusCircleOutlined)`
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  color: var(--color-error);
  cursor: pointer;
  transition: all 0.2s ease-in-out;
`

export default ApiKeyList
