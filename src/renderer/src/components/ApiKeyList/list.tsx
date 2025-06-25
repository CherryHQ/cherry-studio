import { PlusOutlined } from '@ant-design/icons'
import { ApiKeyItem, useApiKeys } from '@renderer/components/ApiKeyList'
import Scrollbar from '@renderer/components/Scrollbar'
import { SettingSubtitle } from '@renderer/pages/settings'
import { isProviderSupportAuth } from '@renderer/services/ProviderService'
import { Provider, WebSearchProvider } from '@renderer/types'
import { Button, Card, List, Popconfirm, Space, Tooltip, Typography } from 'antd'
import { Trash } from 'lucide-react'
import { FC, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import { StreamlineGoodHealthAndWellBeing } from '../Icons/SVGIcon'

interface Props {
  provider: Provider | WebSearchProvider
  apiKeys: string
  onChange: (keys: string) => void
  type?: 'provider' | 'websearch'
  title?: React.ReactNode | string
  footer?: React.ReactNode | string
}

/**
 * Api key 列表，管理 CRUD 操作、连接检查
 */
const ApiKeyList: FC<Props> = ({ provider, apiKeys, onChange, type = 'provider', title, footer }) => {
  const { keys, addKey, updateKey, removeKey, removeInvalid, checkKey, checkAllKeys, isChecking } = useApiKeys({
    provider,
    apiKeys,
    onChange,
    type
  })

  // 临时新项状态
  const [pendingNewKey, setPendingNewKey] = useState<{ key: string; id: string } | null>(null)

  const { t } = useTranslation()
  const isCopilot = provider.id === 'copilot'

  // 创建一个临时新项
  const handleAddNew = () => {
    setPendingNewKey({ key: '', id: Date.now().toString() })
  }

  const handleUpdate = (index: number, newKey: string, isNew: boolean) => {
    if (isNew) {
      // 新项保存时，调用真正的 addKey，然后清除临时状态
      const result = addKey(newKey)
      if (result.success) {
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
    if (type === 'provider') {
      return (provider as Provider).enabled && apiKeys === '' && !isProviderSupportAuth(provider as Provider)
    } else if (type === 'websearch') {
      return apiKeys === ''
    }
    return false
  }

  // 合并真实keys和临时新项
  const displayKeys = pendingNewKey ? [...keys, { key: pendingNewKey.key }] : keys

  return (
    <ApiKeyListContainer>
      <SettingSubtitle
        style={{
          marginBottom: 5,
          display: 'flex',
          alignItems: 'center',
          justifyContent: title ? 'space-between' : 'flex-end'
        }}>
        {title && <Space>{title}</Space>}
        {!isCopilot && (
          <Space style={{ gap: 0 }}>
            {keys.length > 1 && (
              <>
                <Popconfirm
                  title={t('common.delete_confirm')}
                  onConfirm={removeInvalid}
                  disabled={isChecking}
                  okText={t('common.confirm')}
                  cancelText={t('common.cancel')}
                  okButtonProps={{ danger: true }}>
                  <Tooltip title={t('settings.provider.remove_invalid_keys')} placement="top" mouseLeaveDelay={0}>
                    <Button
                      type="text"
                      icon={<Trash size={16} />}
                      disabled={isChecking}
                      danger
                      className="optional-button"
                    />
                  </Tooltip>
                </Popconfirm>
                <Tooltip title={t('settings.provider.check_all_keys')} placement="top" mouseLeaveDelay={0}>
                  <Button
                    type="text"
                    icon={<StreamlineGoodHealthAndWellBeing size={'1.2em'} />}
                    onClick={checkAllKeys}
                    disabled={isChecking}
                    className="optional-button"
                  />
                </Tooltip>
              </>
            )}
            <Tooltip title={t('common.add')} placement="top" mouseLeaveDelay={0}>
              <Button
                key="add"
                type="text"
                onClick={handleAddNew}
                icon={<PlusOutlined />}
                autoFocus={shouldAutoFocus()}
              />
            </Tooltip>
          </Space>
        )}
      </SettingSubtitle>
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
          <Scrollbar style={{ maxHeight: '50vh', overflowX: 'hidden' }}>
            <List
              size="small"
              dataSource={displayKeys}
              renderItem={(keyStatus, index) => {
                const isNew = pendingNewKey && index === displayKeys.length - 1
                return (
                  <ApiKeyItem
                    key={isNew ? pendingNewKey.id : index}
                    keyStatus={keyStatus}
                    isNew={!!isNew}
                    onUpdate={(newKey) => handleUpdate(index, newKey, !!isNew)}
                    onRemove={() => handleRemove(index, !!isNew)}
                    onCheck={() => checkKey(index)}
                    isCopilot={isCopilot}
                    type={type}
                  />
                )
              }}
            />
          </Scrollbar>
        )}
      </Card>
      {footer}
    </ApiKeyListContainer>
  )
}

const ApiKeyListContainer = styled.div`
  .optional-button {
    opacity: 0;
    transition: opacity 0.2s ease;
    transform: translateZ(0);
    will-change: opacity;
  }

  &:hover {
    .optional-button {
      opacity: 1;
    }
  }
`

export default ApiKeyList
