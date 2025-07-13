import { PlusOutlined } from '@ant-design/icons'
import { StreamlineGoodHealthAndWellBeing } from '@renderer/components/Icons/SVGIcon'
import Scrollbar from '@renderer/components/Scrollbar'
import { usePreprocessProvider } from '@renderer/hooks/usePreprocess'
import { useProvider } from '@renderer/hooks/useProvider'
import { useWebSearchProvider } from '@renderer/hooks/useWebSearchProviders'
import { SettingHelpText } from '@renderer/pages/settings'
import { isProviderSupportAuth } from '@renderer/services/ProviderService'
import { Button, Card, Flex, List, Popconfirm, Space, Tooltip, Typography } from 'antd'
import { Trash } from 'lucide-react'
import { FC, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import { isLlmProvider, useApiKeys } from './hook'
import ApiKeyItem from './item'
import { ApiKeyWithStatus, ApiProviderKind, ApiProviderUnion } from './types'

interface ApiKeyListProps {
  provider: ApiProviderUnion
  updateProvider: (provider: Partial<ApiProviderUnion>) => void
  providerKind: ApiProviderKind
  showHealthCheck?: boolean
}

/**
 * Api key 列表，管理 CRUD 操作、连接检查
 */
export const ApiKeyList: FC<ApiKeyListProps> = ({ provider, updateProvider, providerKind, showHealthCheck = true }) => {
  const { t } = useTranslation()

  // 临时新项状态
  const [pendingNewKey, setPendingNewKey] = useState<{ key: string; id: string } | null>(null)

  const {
    keys,
    addKey,
    updateKey,
    removeKey,
    removeInvalidKeys,
    checkKeyConnectivity,
    checkAllKeysConnectivity,
    isChecking
  } = useApiKeys({ provider, updateProvider, providerKind: providerKind })

  // 创建一个临时新项
  const handleAddNew = () => {
    setPendingNewKey({ key: '', id: Date.now().toString() })
  }

  const handleUpdate = (index: number, newKey: string, isNew: boolean) => {
    if (isNew) {
      // 新项保存时，调用真正的 addKey，然后清除临时状态
      const result = addKey(newKey)
      if (result.isValid) {
        setPendingNewKey(null)
      }
      return result
    } else {
      // 现有项更新
      return updateKey(index, newKey)
    }
  }

  const handleRemove = (index: number, isNew: boolean) => {
    if (isNew) {
      setPendingNewKey(null) // 新项取消时，直接清除临时状态
    } else {
      removeKey(index) // 现有项删除
    }
  }

  const shouldAutoFocus = () => {
    if (provider.apiKey) return false
    return isLlmProvider(provider, providerKind) && provider.enabled && !isProviderSupportAuth(provider)
  }

  // 合并真实 keys 和临时新项
  const displayKeys: ApiKeyWithStatus[] = pendingNewKey
    ? [
        ...keys,
        {
          key: pendingNewKey.key,
          status: 'not_checked',
          checking: false
        }
      ]
    : keys

  return (
    <ListContainer>
      {/* Keys 列表 */}
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
                  <ApiKeyItem
                    key={isNew ? pendingNewKey.id : index}
                    keyStatus={keyStatus}
                    showHealthCheck={showHealthCheck}
                    isNew={!!isNew}
                    onUpdate={(newKey) => handleUpdate(index, newKey, !!isNew)}
                    onRemove={() => handleRemove(index, !!isNew)}
                    onCheck={() => checkKeyConnectivity(index)}
                  />
                )
              }}
            />
          </Scrollbar>
        )}
      </Card>

      <Flex dir="row" align="center" justify="space-between" style={{ marginTop: 15 }}>
        {/* 帮助文本 */}
        <SettingHelpText>{t('settings.provider.api_key.tip')}</SettingHelpText>

        {/* 标题和操作按钮 */}
        <Space style={{ gap: 6 }}>
          {/* 批量删除无效 keys */}
          {showHealthCheck && keys.length > 1 && (
            <Space style={{ gap: 0 }}>
              <Popconfirm
                title={t('common.delete_confirm')}
                onConfirm={removeInvalidKeys}
                okText={t('common.confirm')}
                cancelText={t('common.cancel')}
                okButtonProps={{ danger: true }}>
                <Tooltip title={t('settings.provider.remove_invalid_keys')} placement="top" mouseLeaveDelay={0}>
                  <Button type="text" icon={<Trash size={16} />} disabled={isChecking || !!pendingNewKey} danger />
                </Tooltip>
              </Popconfirm>

              {/* 批量检查 */}
              <Tooltip title={t('settings.provider.check_all_keys')} placement="top" mouseLeaveDelay={0}>
                <Button
                  type="text"
                  icon={<StreamlineGoodHealthAndWellBeing size={'1.2em'} />}
                  onClick={checkAllKeysConnectivity}
                  disabled={isChecking || !!pendingNewKey}
                />
              </Tooltip>
            </Space>
          )}

          {/* 添加新 key */}
          <Button
            key="add"
            type="primary"
            onClick={handleAddNew}
            icon={<PlusOutlined />}
            autoFocus={shouldAutoFocus()}
            disabled={isChecking || !!pendingNewKey}>
            {t('common.add')}
          </Button>
        </Space>
      </Flex>
    </ListContainer>
  )
}

interface SpecificApiKeyListProps {
  providerId: string
  providerKind: ApiProviderKind
  showHealthCheck?: boolean
}

export const LlmApiKeyList: FC<SpecificApiKeyListProps> = ({ providerId, providerKind, showHealthCheck = true }) => {
  const { provider, updateProvider } = useProvider(providerId)

  return (
    <ApiKeyList
      provider={provider}
      updateProvider={updateProvider}
      providerKind={providerKind}
      showHealthCheck={showHealthCheck}
    />
  )
}

export const WebSearchApiKeyList: FC<SpecificApiKeyListProps> = ({
  providerId,
  providerKind,
  showHealthCheck = true
}) => {
  const { provider, updateProvider } = useWebSearchProvider(providerId)

  return (
    <ApiKeyList
      provider={provider}
      updateProvider={updateProvider}
      providerKind={providerKind}
      showHealthCheck={showHealthCheck}
    />
  )
}

export const DocPreprocessApiKeyList: FC<SpecificApiKeyListProps> = ({
  providerId,
  providerKind,
  showHealthCheck = true
}) => {
  const { provider, updateProvider } = usePreprocessProvider(providerId)

  return (
    <ApiKeyList
      provider={provider}
      updateProvider={updateProvider}
      providerKind={providerKind}
      showHealthCheck={showHealthCheck}
    />
  )
}

const ListContainer = styled.div`
  padding-top: 15px;
  padding-bottom: 15px;
`
