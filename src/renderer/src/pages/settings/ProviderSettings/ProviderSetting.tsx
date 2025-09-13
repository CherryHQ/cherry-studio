import { Tooltip } from '@heroui/react'
import OpenAIAlert from '@renderer/components/Alert/OpenAIAlert'
import { LoadingIcon } from '@renderer/components/Icons'
import { RowFlex } from '@renderer/components/Layout'
import { Flex } from '@renderer/components/Layout'
import { ApiKeyListPopup } from '@renderer/components/Popups/ApiKeyListPopup'
import { isEmbeddingModel, isRerankModel } from '@renderer/config/models'
import { PROVIDER_URLS } from '@renderer/config/providers'
import { useTheme } from '@renderer/context/ThemeProvider'
import { useAllProviders, useProvider, useProviders } from '@renderer/hooks/useProvider'
import { useTimer } from '@renderer/hooks/useTimer'
import i18n from '@renderer/i18n'
import AnthropicSettings from '@renderer/pages/settings/ProviderSettings/AnthropicSettings'
import { ModelList } from '@renderer/pages/settings/ProviderSettings/ModelList'
import { checkApi } from '@renderer/services/ApiService'
import { isProviderSupportAuth } from '@renderer/services/ProviderService'
import { useAppDispatch } from '@renderer/store'
import { updateWebSearchProvider } from '@renderer/store/websearch'
import { isSystemProvider } from '@renderer/types'
import { ApiKeyConnectivity, HealthStatus } from '@renderer/types/healthCheck'
import { formatApiHost, formatApiKeys, getFancyProviderName, isOpenAIProvider } from '@renderer/utils'
import { formatErrorMessage } from '@renderer/utils/error'
import { Button, Divider, Input, Select, Space, Switch } from 'antd'
import Link from 'antd/es/typography/Link'
import { debounce, isEmpty } from 'lodash'
import { Bolt, Check, Settings2, SquareArrowOutUpRight, TriangleAlert } from 'lucide-react'
import { FC, useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import {
  SettingContainer,
  SettingHelpLink,
  SettingHelpText,
  SettingHelpTextRow,
  SettingSubtitle,
  SettingTitle
} from '..'
import ApiOptionsSettingsPopup from './ApiOptionsSettings/ApiOptionsSettingsPopup'
import AwsBedrockSettings from './AwsBedrockSettings'
import CustomHeaderPopup from './CustomHeaderPopup'
import DMXAPISettings from './DMXAPISettings'
import GithubCopilotSettings from './GithubCopilotSettings'
import GPUStackSettings from './GPUStackSettings'
import LMStudioSettings from './LMStudioSettings'
import ProviderOAuth from './ProviderOAuth'
import SelectProviderModelPopup from './SelectProviderModelPopup'
import VertexAISettings from './VertexAISettings'

interface Props {
  providerId: string
}

const ProviderSetting: FC<Props> = ({ providerId }) => {
  const { provider, updateProvider, models } = useProvider(providerId)
  const allProviders = useAllProviders()
  const { updateProviders } = useProviders()
  const [apiHost, setApiHost] = useState(provider.apiHost)
  const [apiVersion, setApiVersion] = useState(provider.apiVersion)
  const { t } = useTranslation()
  const { theme } = useTheme()
  const { setTimeoutTimer } = useTimer()
  const dispatch = useAppDispatch()

  const isAzureOpenAI = provider.id === 'azure-openai' || provider.type === 'azure-openai'
  const isDmxapi = provider.id === 'dmxapi'
  const hideApiInput = ['vertexai', 'aws-bedrock', 'cherryin'].includes(provider.id)

  const providerConfig = PROVIDER_URLS[provider.id]
  const officialWebsite = providerConfig?.websites?.official
  const apiKeyWebsite = providerConfig?.websites?.apiKey
  const configedApiHost = providerConfig?.api?.url

  const fancyProviderName = getFancyProviderName(provider)

  const [localApiKey, setLocalApiKey] = useState(provider.apiKey)
  const [apiKeyConnectivity, setApiKeyConnectivity] = useState<ApiKeyConnectivity>({
    status: HealthStatus.NOT_CHECKED,
    checking: false
  })

  const updateWebSearchProviderKey = ({ apiKey }: { apiKey: string }) => {
    provider.id === 'zhipu' && dispatch(updateWebSearchProvider({ id: 'zhipu', apiKey: apiKey.split(',')[0] }))
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const debouncedUpdateApiKey = useCallback(
    debounce((value) => {
      updateProvider({ apiKey: formatApiKeys(value) })
      updateWebSearchProviderKey({ apiKey: formatApiKeys(value) })
    }, 150),
    []
  )

  // 同步 provider.apiKey 到 localApiKey
  // 重置连通性检查状态
  useEffect(() => {
    setLocalApiKey(provider.apiKey)
    setApiKeyConnectivity({ status: HealthStatus.NOT_CHECKED })
  }, [provider.apiKey])

  // 同步 localApiKey 到 provider.apiKey（防抖）
  useEffect(() => {
    if (localApiKey !== provider.apiKey) {
      debouncedUpdateApiKey(localApiKey)
    }

    // 卸载时取消任何待执行的更新
    return () => debouncedUpdateApiKey.cancel()
  }, [localApiKey, provider.apiKey, debouncedUpdateApiKey])

  const isApiKeyConnectable = useMemo(() => {
    return apiKeyConnectivity.status === 'success'
  }, [apiKeyConnectivity])

  const moveProviderToTop = useCallback(
    (providerId: string) => {
      const reorderedProviders = [...allProviders]
      const index = reorderedProviders.findIndex((p) => p.id === providerId)

      if (index !== -1) {
        const updatedProvider = { ...reorderedProviders[index], enabled: true }
        reorderedProviders.splice(index, 1)
        reorderedProviders.unshift(updatedProvider)
        updateProviders(reorderedProviders)
      }
    },
    [allProviders, updateProviders]
  )

  const onUpdateApiHost = () => {
    if (apiHost.trim()) {
      updateProvider({ apiHost })
    } else {
      setApiHost(provider.apiHost)
    }
  }

  const onUpdateApiVersion = () => updateProvider({ apiVersion })

  const openApiKeyList = async () => {
    await ApiKeyListPopup.show({
      providerId: provider.id,
      title: `${fancyProviderName} ${t('settings.provider.api.key.list.title')}`
    })
  }

  const onCheckApi = async () => {
    // 如果存在多个密钥，直接打开管理窗口
    if (provider.apiKey.includes(',')) {
      await openApiKeyList()
      return
    }

    const modelsToCheck = models.filter((model) => !isEmbeddingModel(model) && !isRerankModel(model))

    if (isEmpty(modelsToCheck)) {
      window.toast.error({
        timeout: 5000,
        title: t('settings.provider.no_models_for_check')
      })
      return
    }

    const model = await SelectProviderModelPopup.show({ provider })

    if (!model) {
      window.toast.error(i18n.t('message.error.enter.model'))
      return
    }

    try {
      setApiKeyConnectivity((prev) => ({ ...prev, checking: true, status: HealthStatus.NOT_CHECKED }))
      await checkApi({ ...provider, apiHost }, model)

      window.toast.success({
        timeout: 2000,
        title: i18n.t('message.api.connection.success')
      })

      setApiKeyConnectivity((prev) => ({ ...prev, status: HealthStatus.SUCCESS }))
      setTimeoutTimer(
        'onCheckApi',
        () => {
          setApiKeyConnectivity((prev) => ({ ...prev, status: HealthStatus.NOT_CHECKED }))
        },
        3000
      )
    } catch (error: any) {
      window.toast.error({
        timeout: 8000,
        title: i18n.t('message.api.connection.failed')
      })

      setApiKeyConnectivity((prev) => ({ ...prev, status: HealthStatus.FAILED, error: formatErrorMessage(error) }))
    } finally {
      setApiKeyConnectivity((prev) => ({ ...prev, checking: false }))
    }
  }

  const onReset = () => {
    setApiHost(configedApiHost)
    updateProvider({ apiHost: configedApiHost })
  }

  const hostPreview = () => {
    if (apiHost.endsWith('#')) {
      return apiHost.replace('#', '')
    }
    if (provider.type === 'openai') {
      return formatApiHost(apiHost) + 'chat/completions'
    }

    if (provider.type === 'azure-openai') {
      return formatApiHost(apiHost) + 'openai/v1'
    }
    return formatApiHost(apiHost) + 'responses'
  }

  // API key 连通性检查状态指示器，目前仅在失败时显示
  const renderStatusIndicator = () => {
    if (apiKeyConnectivity.checking || apiKeyConnectivity.status !== HealthStatus.FAILED) {
      return null
    }

    return (
      <Tooltip content={<ErrorOverlay>{apiKeyConnectivity.error}</ErrorOverlay>}>
        <TriangleAlert size={16} color="var(--color-status-warning)" />
      </Tooltip>
    )
  }

  useEffect(() => {
    if (provider.id === 'copilot') {
      return
    }
    setApiHost(provider.apiHost)
  }, [provider.apiHost, provider.id])

  const isAnthropicOAuth = () => provider.id === 'anthropic' && provider.authType === 'oauth'

  return (
    <SettingContainer theme={theme} style={{ background: 'var(--color-background)' }}>
      <SettingTitle>
        <Flex className="items-center gap-2">
          <ProviderName>{fancyProviderName}</ProviderName>
          {officialWebsite && (
            <Link target="_blank" href={providerConfig.websites.official} style={{ display: 'flex' }}>
              <Button type="text" size="small" icon={<SquareArrowOutUpRight size={14} />} />
            </Link>
          )}
          {!isSystemProvider(provider) && (
            <Tooltip content={t('settings.provider.api.options.label')} showArrow={true}>
              <Button
                type="text"
                icon={<Bolt size={14} />}
                size="small"
                onClick={() => ApiOptionsSettingsPopup.show({ providerId: provider.id })}
              />
            </Tooltip>
          )}
        </Flex>
        <Switch
          value={provider.enabled}
          key={provider.id}
          onChange={(enabled) => {
            updateProvider({ apiHost, enabled })
            if (enabled) {
              moveProviderToTop(provider.id)
            }
          }}
        />
      </SettingTitle>
      <Divider style={{ width: '100%', margin: '10px 0' }} />
      {isProviderSupportAuth(provider) && <ProviderOAuth providerId={provider.id} />}
      {provider.id === 'openai' && <OpenAIAlert />}
      {isDmxapi && <DMXAPISettings providerId={provider.id} />}
      {provider.id === 'anthropic' && (
        <>
          <SettingSubtitle style={{ marginTop: 5 }}>{t('settings.provider.anthropic.auth_method')}</SettingSubtitle>
          <Select
            style={{ width: '40%', marginTop: 5, marginBottom: 10 }}
            value={provider.authType || 'apiKey'}
            onChange={(value) => updateProvider({ authType: value })}
            options={[
              { value: 'apiKey', label: t('settings.provider.anthropic.apikey') },
              { value: 'oauth', label: t('settings.provider.anthropic.oauth') }
            ]}
          />
          {provider.authType === 'oauth' && <AnthropicSettings />}
        </>
      )}
      {!hideApiInput && !isAnthropicOAuth() && (
        <>
          <SettingSubtitle
            style={{
              marginTop: 5,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between'
            }}>
            {t('settings.provider.api_key.label')}
            {provider.id !== 'copilot' && (
              <Tooltip content={t('settings.provider.api.key.list.open')} showArrow={true}>
                <Button type="text" onClick={openApiKeyList} icon={<Settings2 size={16} />} />
              </Tooltip>
            )}
          </SettingSubtitle>
          <Space.Compact style={{ width: '100%', marginTop: 5 }}>
            <Input.Password
              value={localApiKey}
              placeholder={t('settings.provider.api_key.label')}
              onChange={(e) => setLocalApiKey(e.target.value)}
              spellCheck={false}
              autoFocus={provider.enabled && provider.apiKey === '' && !isProviderSupportAuth(provider)}
              disabled={provider.id === 'copilot'}
              suffix={renderStatusIndicator()}
            />
            <Button
              type={isApiKeyConnectable ? 'primary' : 'default'}
              ghost={isApiKeyConnectable}
              onClick={onCheckApi}
              disabled={!apiHost || apiKeyConnectivity.checking}>
              {apiKeyConnectivity.checking ? (
                <LoadingIcon />
              ) : apiKeyConnectivity.status === 'success' ? (
                <Check size={16} className="lucide-custom" />
              ) : (
                t('settings.provider.check')
              )}
            </Button>
          </Space.Compact>
          <SettingHelpTextRow style={{ justifyContent: 'space-between' }}>
            <RowFlex>
              {apiKeyWebsite && !isDmxapi && (
                <SettingHelpLink target="_blank" href={apiKeyWebsite}>
                  {t('settings.provider.get_api_key')}
                </SettingHelpLink>
              )}
            </RowFlex>
            <SettingHelpText>{t('settings.provider.api_key.tip')}</SettingHelpText>
          </SettingHelpTextRow>
          {!isDmxapi && !isAnthropicOAuth() && (
            <>
              <SettingSubtitle style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                {t('settings.provider.api_host')}
                <Button
                  type="text"
                  onClick={() => CustomHeaderPopup.show({ provider })}
                  icon={<Settings2 size={16} />}
                />
              </SettingSubtitle>
              <Space.Compact style={{ width: '100%', marginTop: 5 }}>
                <Input
                  value={apiHost}
                  placeholder={t('settings.provider.api_host')}
                  onChange={(e) => setApiHost(e.target.value)}
                  onBlur={onUpdateApiHost}
                />
                {!isEmpty(configedApiHost) && apiHost !== configedApiHost && (
                  <Button danger onClick={onReset}>
                    {t('settings.provider.api.url.reset')}
                  </Button>
                )}
              </Space.Compact>
              {isOpenAIProvider(provider) && (
                <SettingHelpTextRow style={{ justifyContent: 'space-between' }}>
                  <SettingHelpText
                    style={{ marginLeft: 6, marginRight: '1em', whiteSpace: 'break-spaces', wordBreak: 'break-all' }}>
                    {hostPreview()}
                  </SettingHelpText>
                  <SettingHelpText style={{ minWidth: 'fit-content' }}>
                    {t('settings.provider.api.url.tip')}
                  </SettingHelpText>
                </SettingHelpTextRow>
              )}
            </>
          )}
        </>
      )}
      {isAzureOpenAI && (
        <>
          <SettingSubtitle>{t('settings.provider.api_version')}</SettingSubtitle>
          <Space.Compact style={{ width: '100%', marginTop: 5 }}>
            <Input
              value={apiVersion}
              placeholder="2024-xx-xx-preview"
              onChange={(e) => setApiVersion(e.target.value)}
              onBlur={onUpdateApiVersion}
            />
          </Space.Compact>
          <SettingHelpTextRow style={{ justifyContent: 'space-between' }}>
            <SettingHelpText style={{ minWidth: 'fit-content' }}>
              {t('settings.provider.azure.apiversion.tip')}
            </SettingHelpText>
          </SettingHelpTextRow>
        </>
      )}
      {provider.id === 'lmstudio' && <LMStudioSettings />}
      {provider.id === 'gpustack' && <GPUStackSettings />}
      {provider.id === 'copilot' && <GithubCopilotSettings providerId={provider.id} />}
      {provider.id === 'aws-bedrock' && <AwsBedrockSettings />}
      {provider.id === 'vertexai' && <VertexAISettings providerId={provider.id} />}
      <ModelList providerId={provider.id} />
    </SettingContainer>
  )
}

const ProviderName = styled.span`
  font-size: 14px;
  font-weight: 500;
  margin-right: -2px;
`

const ErrorOverlay = styled.div`
  max-height: 200px;
  overflow-y: auto;
  max-width: 300px;
  word-wrap: break-word;
  user-select: text;
`

export default ProviderSetting
