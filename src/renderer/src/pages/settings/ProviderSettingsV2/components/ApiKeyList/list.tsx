import { Button, Flex, Input, RowFlex, Switch, Tooltip } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import { type HealthResult, HealthStatusIndicator } from '@renderer/components/HealthStatusIndicator'
import { DeleteIcon } from '@renderer/components/Icons'
import { StreamlineGoodHealthAndWellBeing } from '@renderer/components/Icons/SVGIcon'
import Scrollbar from '@renderer/components/Scrollbar'
import { useModels } from '@renderer/hooks/useModels'
import { usePreprocessProvider } from '@renderer/hooks/usePreprocess'
import { useProvider, useProviderApiKeys, useProviderMutations } from '@renderer/hooks/useProviders'
import { useWebSearchProvider } from '@renderer/hooks/useWebSearchProviders'
import { SettingHelpText } from '@renderer/pages/settings'
import {
  apiKeyListClasses,
  fieldClasses
} from '@renderer/pages/settings/ProviderSettingsV2/components/ProviderSettingsPrimitives'
import { isEmbeddingModel, isRerankModel } from '@renderer/pages/settings/ProviderSettingsV2/config/models'
import SelectProviderModelPopup from '@renderer/pages/settings/ProviderSettingsV2/SelectProviderModelPopup'
import type {
  ApiKeyConnectivity,
  ApiKeyWithStatus
} from '@renderer/pages/settings/ProviderSettingsV2/types/healthCheck'
import { HealthStatus } from '@renderer/pages/settings/ProviderSettingsV2/types/healthCheck'
import { isProviderSupportAuth } from '@renderer/pages/settings/ProviderSettingsV2/utils/provider'
import {
  toV1ModelForCheckApi,
  toV1ProviderShim
} from '@renderer/pages/settings/ProviderSettingsV2/utils/v1ProviderShim'
import { checkApi } from '@renderer/services/ApiService'
import type { PreprocessProviderId, WebSearchProviderId } from '@renderer/types'
import { cn } from '@renderer/utils'
import { maskApiKey } from '@renderer/utils/api'
import { serializeHealthCheckError } from '@renderer/utils/error'
import type { Model } from '@shared/data/types/model'
import type { ApiKeyEntry } from '@shared/data/types/provider'
import { Card, List, Popconfirm, Space, Typography } from 'antd'
import { isEmpty } from 'lodash'
import { Check, Copy, Edit3, Minus, Plus, X } from 'lucide-react'
import type { FC } from 'react'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import { isLlmProvider, useApiKeys } from './hook'
import ApiKeyItem from './item'
import type { ApiProvider, LlmApiProvider, UpdateApiProviderFunc } from './types'

const logger = loggerService.withContext('LlmApiKeyList')

interface ApiKeyListProps {
  provider: ApiProvider
  updateProvider: UpdateApiProviderFunc
  showHealthCheck?: boolean
}

/**
 * Api key 列表，管理 CRUD 操作、连接检查
 */
export const ApiKeyList: FC<ApiKeyListProps> = ({ provider, updateProvider, showHealthCheck = true }) => {
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
  } = useApiKeys({ provider, updateProvider })

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
    return isLlmProvider(provider) && provider.enabled && !isProviderSupportAuth(provider.sourceProvider)
  }

  // 合并真实 keys 和临时新项
  const displayKeys: ApiKeyWithStatus[] = pendingNewKey
    ? [
        ...keys,
        {
          key: pendingNewKey.key,
          status: HealthStatus.NOT_CHECKED,
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

      <Flex className="mt-[15px] flex-row items-center justify-between">
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
                okButtonProps={{ color: 'danger' }}>
                <Tooltip content={t('settings.provider.remove_invalid_keys')}>
                  <Button variant="ghost" disabled={isChecking || !!pendingNewKey} size="icon">
                    <DeleteIcon size={16} className="lucide-custom" />
                  </Button>
                </Tooltip>
              </Popconfirm>

              {/* 批量检查 */}
              <Tooltip content={t('settings.provider.check_all_keys')}>
                <Button
                  variant="ghost"
                  onClick={checkAllKeysConnectivity}
                  disabled={isChecking || !!pendingNewKey}
                  size="icon">
                  <StreamlineGoodHealthAndWellBeing size={'1.2em'} />
                </Button>
              </Tooltip>
            </Space>
          )}

          {/* 添加新 key */}
          <Button
            key="add"
            onClick={handleAddNew}
            autoFocus={shouldAutoFocus()}
            disabled={isChecking || !!pendingNewKey}>
            <Plus size={16} />
            {t('common.add')}
          </Button>
        </Space>
      </Flex>
    </ListContainer>
  )
}

interface SpecificApiKeyListProps {
  providerId: string
  showHealthCheck?: boolean
}

type WebSearchApiKeyList = SpecificApiKeyListProps & {
  providerId: WebSearchProviderId
}

type DocPreprocessApiKeyListProps = SpecificApiKeyListProps & {
  providerId: PreprocessProviderId
}

type ManagedLlmKey = ApiKeyEntry &
  ApiKeyConnectivity & {
    isNew?: boolean
  }

interface ManagedLlmApiKeyItemProps {
  item: ManagedLlmKey
  showHealthCheck: boolean
  disabled?: boolean
  onSave: (patch: { key: string; label?: string }) => Promise<void>
  onDelete: () => Promise<void>
  onToggleEnabled: (enabled: boolean) => Promise<void>
  onCheck: () => Promise<void>
}

const ManagedLlmApiKeyItem: FC<ManagedLlmApiKeyItemProps> = ({
  item,
  showHealthCheck,
  disabled = false,
  onSave,
  onDelete,
  onToggleEnabled,
  onCheck
}) => {
  const { t } = useTranslation()
  const [isEditing, setIsEditing] = useState(item.isNew === true)
  const [draftLabel, setDraftLabel] = useState(item.label ?? '')
  const [draftKey, setDraftKey] = useState(item.key)

  const healthResults: HealthResult[] =
    item.status === HealthStatus.NOT_CHECKED
      ? []
      : [
          {
            status: item.status,
            latency: item.latency,
            error: item.error,
            label: item.model?.name
          }
        ]

  const handleSave = async () => {
    await onSave({ key: draftKey, label: draftLabel || undefined })
    setIsEditing(false)
  }

  const handleCancel = async () => {
    if (item.isNew) {
      await onDelete()
      return
    }

    setDraftLabel(item.label ?? '')
    setDraftKey(item.key)
    setIsEditing(false)
  }

  return (
    <div className={apiKeyListClasses.keyRow}>
      {isEditing ? (
        <>
          <div className={apiKeyListClasses.keyInputRow}>
            <Input
              value={draftLabel}
              placeholder={t('common.name')}
              className={apiKeyListClasses.input}
              disabled={disabled}
              onChange={(event) => setDraftLabel(event.target.value)}
            />
            <Input
              value={draftKey}
              placeholder={t('settings.provider.api.key.new_key.placeholder')}
              className={cn(apiKeyListClasses.input, fieldClasses.input)}
              spellCheck={false}
              disabled={disabled}
              onChange={(event) => setDraftKey(event.target.value)}
            />
          </div>
          <div className={apiKeyListClasses.actionRow}>
            <span className={apiKeyListClasses.helperText}>{t('settings.provider.api.key.label')}</span>
            <div className={apiKeyListClasses.actionCluster}>
              <Button
                variant="ghost"
                size="icon-sm"
                className={apiKeyListClasses.iconButton}
                disabled={disabled}
                onClick={handleSave}>
                <Check size={16} />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                className={apiKeyListClasses.iconButton}
                disabled={disabled}
                onClick={handleCancel}>
                <X size={16} />
              </Button>
            </div>
          </div>
        </>
      ) : (
        <>
          <div className={apiKeyListClasses.keyRowHeader}>
            <div className="min-w-0 flex-1">
              <div className={apiKeyListClasses.keyLabel}>{item.label || maskApiKey(item.key)}</div>
              <div className={apiKeyListClasses.keyValue}>{maskApiKey(item.key)}</div>
            </div>
            <Switch checked={item.isEnabled} disabled={disabled} size="sm" onCheckedChange={onToggleEnabled} />
          </div>
          <div className={apiKeyListClasses.actionRow}>
            <HealthStatusIndicator results={healthResults} loading={item.checking} showLatency />
            <div className={apiKeyListClasses.actionCluster}>
              {showHealthCheck && (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className={apiKeyListClasses.iconButton}
                  disabled={disabled}
                  onClick={onCheck}>
                  <StreamlineGoodHealthAndWellBeing size={18} isActive={item.checking} />
                </Button>
              )}
              <Button
                variant="ghost"
                size="icon-sm"
                className={apiKeyListClasses.iconButton}
                disabled={disabled}
                onClick={() => void navigator.clipboard.writeText(item.key)}>
                <Copy size={16} />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                className={apiKeyListClasses.iconButton}
                disabled={disabled}
                onClick={() => setIsEditing(true)}>
                <Edit3 size={16} />
              </Button>
              <Popconfirm
                title={t('common.delete_confirm')}
                onConfirm={() => void onDelete()}
                okText={t('common.confirm')}
                cancelText={t('common.cancel')}
                okButtonProps={{ color: 'danger' }}>
                <Button variant="ghost" size="icon-sm" className={apiKeyListClasses.iconButton}>
                  <Minus size={16} />
                </Button>
              </Popconfirm>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

export const LlmApiKeyList: FC<SpecificApiKeyListProps> = ({ providerId, showHealthCheck = true }) => {
  const { provider } = useProvider(providerId)
  const { data: apiKeysData } = useProviderApiKeys(providerId)
  const { models } = useModels({ providerId })
  const { addApiKey, deleteApiKey, updateApiKey } = useProviderMutations(providerId)
  const { t } = useTranslation()
  const [pendingNewKey, setPendingNewKey] = useState<ManagedLlmKey | null>(null)
  const [connectivityStates, setConnectivityStates] = useState<Map<string, ApiKeyConnectivity>>(new Map())

  const enabledKeys = useMemo(
    () =>
      (apiKeysData?.keys ?? [])
        .filter((key) => key.isEnabled)
        .map((key) => key.key)
        .join(','),
    [apiKeysData]
  )

  const llmProvider = useMemo<LlmApiProvider | null>(() => {
    if (!provider) return null
    return {
      kind: 'llm',
      id: provider.id,
      apiKey: enabledKeys,
      enabled: provider.isEnabled,
      models,
      sourceProvider: provider
    }
  }, [enabledKeys, models, provider])

  const updateConnectivityState = useCallback((keyId: string, state: Partial<ApiKeyConnectivity>) => {
    setConnectivityStates((prev) => {
      const next = new Map(prev)
      const current = prev.get(keyId) || { status: HealthStatus.NOT_CHECKED, checking: false }
      next.set(keyId, { ...current, ...state })
      return next
    })
  }, [])

  const validateKey = useCallback(
    (key: string, keyId?: string) => {
      const trimmedKey = key.trim()
      if (!trimmedKey) {
        return { isValid: false, error: t('settings.provider.api.key.error.empty') } as const
      }

      const duplicate = (apiKeysData?.keys ?? []).some((item) => item.id !== keyId && item.key.trim() === trimmedKey)
      if (duplicate) {
        return { isValid: false, error: t('settings.provider.api.key.error.duplicate') } as const
      }

      return { isValid: true } as const
    },
    [apiKeysData?.keys, t]
  )

  const getModelForCheck = useCallback(async (): Promise<Model | null> => {
    if (!llmProvider) {
      return null
    }

    const modelsToCheck = llmProvider.models.filter((model) => !isEmbeddingModel(model) && !isRerankModel(model))
    if (isEmpty(modelsToCheck)) {
      window.toast.error({
        title: t('settings.provider.no_models_for_check'),
        timeout: 5000
      })
      return null
    }

    return (await SelectProviderModelPopup.show({ models: modelsToCheck })) ?? null
  }, [llmProvider, t])

  const runConnectivityCheck = useCallback(
    async (item: ManagedLlmKey, model: Model) => {
      if (!llmProvider || item.checking) {
        return
      }

      updateConnectivityState(item.id, { checking: true })

      try {
        const startTime = Date.now()
        const providerForCheck = toV1ProviderShim(llmProvider.sourceProvider, {
          models: llmProvider.models,
          apiKey: item.key
        })
        await checkApi(providerForCheck, toV1ModelForCheckApi(model))

        updateConnectivityState(item.id, {
          checking: false,
          status: HealthStatus.SUCCESS,
          model,
          latency: Date.now() - startTime,
          error: undefined
        })
      } catch (error) {
        updateConnectivityState(item.id, {
          checking: false,
          status: HealthStatus.FAILED,
          error: serializeHealthCheckError(error),
          model: undefined,
          latency: undefined
        })
        logger.error('failed to validate the connectivity of the api key', error as Error)
      }
    },
    [llmProvider, updateConnectivityState]
  )

  const displayKeys = useMemo<ManagedLlmKey[]>(() => {
    const keys: ManagedLlmKey[] = (apiKeysData?.keys ?? []).map((item) => ({
      ...item,
      ...(connectivityStates.get(item.id) || {
        status: HealthStatus.NOT_CHECKED,
        checking: false
      })
    }))

    return pendingNewKey ? [...keys, pendingNewKey] : keys
  }, [apiKeysData?.keys, connectivityStates, pendingNewKey])

  const isChecking = useMemo(() => displayKeys.some((item) => item.checking), [displayKeys])

  const handleAddNew = useCallback(() => {
    setPendingNewKey({
      id: `new-${Date.now()}`,
      key: '',
      label: '',
      isEnabled: true,
      status: HealthStatus.NOT_CHECKED,
      checking: false,
      isNew: true
    })
  }, [])

  const handleSaveKey = useCallback(
    async (item: ManagedLlmKey, patch: { key: string; label?: string }) => {
      const validation = validateKey(patch.key, item.isNew ? undefined : item.id)
      if (!validation.isValid) {
        window.toast.warning(validation.error)
        return
      }

      if (item.isNew) {
        await addApiKey(patch.key.trim(), patch.label?.trim() || undefined)
        setPendingNewKey(null)
        return
      }

      await updateApiKey(item.id, {
        key: patch.key.trim(),
        label: patch.label?.trim() || undefined
      })
      updateConnectivityState(item.id, {
        status: HealthStatus.NOT_CHECKED,
        error: undefined,
        latency: undefined,
        model: undefined
      })
    },
    [addApiKey, updateApiKey, updateConnectivityState, validateKey]
  )

  const handleDeleteKey = useCallback(
    async (item: ManagedLlmKey) => {
      if (item.isNew) {
        setPendingNewKey(null)
        return
      }

      await deleteApiKey(item.id)
      setConnectivityStates((prev) => {
        const next = new Map(prev)
        next.delete(item.id)
        return next
      })
    },
    [deleteApiKey]
  )

  const handleCheckKey = useCallback(
    async (item: ManagedLlmKey) => {
      const model = await getModelForCheck()
      if (!model) {
        return
      }

      await runConnectivityCheck(item, model)
    },
    [getModelForCheck, runConnectivityCheck]
  )

  const handleCheckAll = useCallback(async () => {
    const model = await getModelForCheck()
    if (!model) {
      return
    }

    await Promise.allSettled(
      displayKeys.filter((item) => item.isEnabled && !item.isNew).map((item) => runConnectivityCheck(item, model))
    )
  }, [displayKeys, getModelForCheck, runConnectivityCheck])

  const handleRemoveInvalid = useCallback(async () => {
    const invalidKeys = displayKeys.filter((item) => !item.isNew && item.status === HealthStatus.FAILED)
    await Promise.allSettled(invalidKeys.map((item) => deleteApiKey(item.id)))
  }, [deleteApiKey, displayKeys])

  const handleToggleKey = useCallback(
    async (item: ManagedLlmKey, enabled: boolean) => {
      if (item.isNew) {
        setPendingNewKey((prev) => (prev ? { ...prev, isEnabled: enabled } : prev))
        return
      }

      await updateApiKey(item.id, { isEnabled: enabled })
    },
    [updateApiKey]
  )

  if (!llmProvider) return null

  return (
    <div className={apiKeyListClasses.shell}>
      <div className={apiKeyListClasses.card}>
        <div className={apiKeyListClasses.summaryRow}>
          <div className="min-w-0">
            <div className={apiKeyListClasses.summaryTitle}>{t('settings.provider.api.key.list.title')}</div>
          </div>
          <div className={apiKeyListClasses.summaryMeta}>
            {(apiKeysData?.keys ?? []).filter((item) => item.isEnabled).length}/{(apiKeysData?.keys ?? []).length}
          </div>
        </div>
      </div>

      <div className={apiKeyListClasses.listWrap}>
        {displayKeys.length === 0 ? (
          <div className="px-4 py-3 text-[length:var(--font-size-caption)] leading-[var(--line-height-caption)] text-(--color-muted-foreground)">
            {t('error.no_api_key')}
          </div>
        ) : (
          <Scrollbar style={{ maxHeight: '60vh', overflowX: 'hidden' }} className={apiKeyListClasses.listScroller}>
            {displayKeys.map((item) => (
              <ManagedLlmApiKeyItem
                key={item.id}
                item={item}
                showHealthCheck={showHealthCheck}
                disabled={isChecking && !item.checking}
                onSave={(patch) => handleSaveKey(item, patch)}
                onDelete={() => handleDeleteKey(item)}
                onToggleEnabled={(enabled) => handleToggleKey(item, enabled)}
                onCheck={() => handleCheckKey(item)}
              />
            ))}
          </Scrollbar>
        )}
      </div>

      <RowFlex className="items-center justify-end gap-3">
        <div className={apiKeyListClasses.actionCluster}>
          {showHealthCheck && displayKeys.length > 1 && (
            <>
              <Tooltip content={t('settings.provider.remove_invalid_keys')}>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className={apiKeyListClasses.iconButton}
                  disabled={isChecking || !!pendingNewKey}
                  onClick={() => void handleRemoveInvalid()}>
                  <DeleteIcon size={16} className="lucide-custom" />
                </Button>
              </Tooltip>
              <Tooltip content={t('settings.provider.check_all_keys')}>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className={apiKeyListClasses.iconButton}
                  disabled={isChecking || !!pendingNewKey}
                  onClick={() => void handleCheckAll()}>
                  <StreamlineGoodHealthAndWellBeing size="1.2em" />
                </Button>
              </Tooltip>
            </>
          )}
          <Button
            variant="outline"
            className={apiKeyListClasses.addButton}
            disabled={isChecking || !!pendingNewKey}
            onClick={handleAddNew}>
            <Plus size={16} />
            {t('common.add')}
          </Button>
        </div>
      </RowFlex>
    </div>
  )
}

export const WebSearchApiKeyList: FC<WebSearchApiKeyList> = ({ providerId, showHealthCheck = true }) => {
  const { provider, updateProvider } = useWebSearchProvider(providerId)

  return <ApiKeyList provider={provider} updateProvider={updateProvider} showHealthCheck={showHealthCheck} />
}

export const DocPreprocessApiKeyList: FC<DocPreprocessApiKeyListProps> = ({ providerId, showHealthCheck = true }) => {
  const { provider, updateProvider } = usePreprocessProvider(providerId)

  return <ApiKeyList provider={provider} updateProvider={updateProvider} showHealthCheck={showHealthCheck} />
}

const ListContainer = styled.div`
  padding-top: 15px;
  padding-bottom: 15px;
`
