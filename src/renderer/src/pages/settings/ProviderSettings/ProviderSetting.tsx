import { Button, Flex, RowFlex, Switch, Tooltip, WarnTooltip } from '@cherrystudio/ui'
import { HelpTooltip } from '@cherrystudio/ui'
import { adaptProvider } from '@renderer/aiCore/provider/providerConfig'
import OpenAIAlert from '@renderer/components/Alert/OpenAIAlert'
import { LoadingIcon } from '@renderer/components/Icons'
import { ApiKeyListPopup } from '@renderer/components/Popups/ApiKeyListPopup'
import Selector from '@renderer/components/Selector'
import { isEmbeddingModel, isRerankModel } from '@renderer/config/models'
import { PROVIDER_URLS } from '@renderer/config/providers'
import { useTheme } from '@renderer/context/ThemeProvider'
import { useAllProviders, useProvider, useProviders } from '@renderer/hooks/useProvider'
import { useTimer } from '@renderer/hooks/useTimer'
import AnthropicSettings from '@renderer/pages/settings/ProviderSettings/AnthropicSettings'
import { ModelList } from '@renderer/pages/settings/ProviderSettings/ModelList'
import { checkApi } from '@renderer/services/ApiService'
import { isProviderSupportAuth } from '@renderer/services/ProviderService'
import { useAppDispatch } from '@renderer/store'
import { updateWebSearchProvider } from '@renderer/store/websearch'
import type { SystemProviderId } from '@renderer/types'
import { isSystemProvider, isSystemProviderId, SystemProviderIds } from '@renderer/types'
import type { ApiKeyConnectivity } from '@renderer/types/healthCheck'
import { HealthStatus } from '@renderer/types/healthCheck'
import { formatApiHost, formatApiKeys, getFancyProviderName, validateApiHost } from '@renderer/utils'
import { formatErrorMessage } from '@renderer/utils/error'
import {
  isAIGatewayProvider,
  isAnthropicProvider,
  isAzureOpenAIProvider,
  isGeminiProvider,
  isNewApiProvider,
  isOllamaProvider,
  isOpenAICompatibleProvider,
  isOpenAIProvider,
  isVertexProvider
} from '@renderer/utils/provider'
import { Divider, Input, Select, Space } from 'antd'
import Link from 'antd/es/typography/Link'
import { debounce, isEmpty } from 'lodash'
import { Bolt, Check, Settings2, SquareArrowOutUpRight } from 'lucide-react'
import type { FC } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
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
import CherryINSettings from './CherryINSettings'
import CustomHeaderPopup from './CustomHeaderPopup'
import DMXAPISettings from './DMXAPISettings'
import GithubCopilotSettings from './GithubCopilotSettings'
import GPUStackSettings from './GPUStackSettings'
import LMStudioSettings from './LMStudioSettings'
import OVMSSettings from './OVMSSettings'
import ProviderOAuth from './ProviderOAuth'
import SelectProviderModelPopup from './SelectProviderModelPopup'
import VertexAISettings from './VertexAISettings'

interface Props {
  providerId: string
}

const ANTHROPIC_COMPATIBLE_PROVIDER_IDS = [
  SystemProviderIds.deepseek,
  SystemProviderIds.moonshot,
  SystemProviderIds.zhipu,
  SystemProviderIds.dashscope,
  SystemProviderIds.modelscope,
  SystemProviderIds.aihubmix,
  SystemProviderIds.grok,
  SystemProviderIds.cherryin,
  SystemProviderIds.longcat,
  SystemProviderIds.minimax,
  SystemProviderIds.silicon,
  SystemProviderIds.qiniu,
  SystemProviderIds.dmxapi
] as const
type AnthropicCompatibleProviderId = (typeof ANTHROPIC_COMPATIBLE_PROVIDER_IDS)[number]

const ANTHROPIC_COMPATIBLE_PROVIDER_ID_SET = new Set<string>(ANTHROPIC_COMPATIBLE_PROVIDER_IDS)
const isAnthropicCompatibleProviderId = (id: string): id is AnthropicCompatibleProviderId => {
  return ANTHROPIC_COMPATIBLE_PROVIDER_ID_SET.has(id)
}

type HostField = 'apiHost' | 'anthropicApiHost'

const ProviderSetting: FC<Props> = ({ providerId }) => {
  const { provider, updateProvider, models } = useProvider(providerId)
  const allProviders = useAllProviders()
  const { updateProviders } = useProviders()
  const [apiHost, setApiHost] = useState(provider.apiHost)
  const [anthropicApiHost, setAnthropicHost] = useState<string | undefined>(provider.anthropicApiHost)
  const [apiVersion, setApiVersion] = useState(provider.apiVersion)
  const [activeHostField, setActiveHostField] = useState<HostField>('apiHost')
  const { t, i18n } = useTranslation()
  const { theme } = useTheme()
  const { setTimeoutTimer } = useTimer()
  const dispatch = useAppDispatch()

  const isAzureOpenAI = isAzureOpenAIProvider(provider)
  const isDmxapi = provider.id === 'dmxapi'
  const isCherryIN = provider.id === 'cherryin'
  const isChineseUser = i18n.language.startsWith('zh')
  const noAPIInputProviders = ['aws-bedrock'] as const satisfies SystemProviderId[]
  const hideApiInput = noAPIInputProviders.some((id) => id === provider.id)
  const noAPIKeyInputProviders = ['copilot', 'vertexai'] as const satisfies SystemProviderId[]
  const hideApiKeyInput = noAPIKeyInputProviders.some((id) => id === provider.id)

  const providerConfig = PROVIDER_URLS[provider.id]
  const officialWebsite = providerConfig?.websites?.official
  const apiKeyWebsite = providerConfig?.websites?.apiKey
  const configuredApiHost = providerConfig?.api?.url

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
    if (!validateApiHost(apiHost)) {
      setApiHost(provider.apiHost)
      window.toast.error(t('settings.provider.api_host_no_valid'))
      return
    }
    if (isVertexProvider(provider) || apiHost.trim()) {
      updateProvider({ apiHost })
    } else {
      setApiHost(provider.apiHost)
    }
  }

  const onUpdateAnthropicHost = () => {
    const trimmedHost = anthropicApiHost?.trim()

    if (trimmedHost) {
      updateProvider({ anthropicApiHost: trimmedHost })
      setAnthropicHost(trimmedHost)
    } else {
      updateProvider({ anthropicApiHost: undefined })
      setAnthropicHost(undefined)
    }
  }
  const onUpdateApiVersion = () => updateProvider({ apiVersion })

  const openApiKeyList = async () => {
    if (localApiKey !== provider.apiKey) {
      updateProvider({ apiKey: formatApiKeys(localApiKey) })
      await new Promise((resolve) => setTimeout(resolve, 0))
    }

    await ApiKeyListPopup.show({
      providerId: provider.id,
      title: `${fancyProviderName} ${t('settings.provider.api.key.list.title')}`,
      providerType: 'llm'
    })
  }

  const onCheckApi = async () => {
    const formattedLocalKey = formatApiKeys(localApiKey)
    // 如果存在多个密钥，直接打开管理窗口
    if (formattedLocalKey.includes(',')) {
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
      await checkApi({ ...provider, apiHost, apiKey: formattedLocalKey }, model)

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

  const onReset = useCallback(() => {
    setApiHost(configuredApiHost)
    updateProvider({ apiHost: configuredApiHost })
  }, [configuredApiHost, updateProvider])

  const isApiHostResettable = useMemo(() => {
    return !isEmpty(configuredApiHost) && apiHost !== configuredApiHost
  }, [configuredApiHost, apiHost])

  const hostPreview = () => {
    const formattedApiHost = adaptProvider({ provider: { ...provider, apiHost } }).apiHost

    if (isOllamaProvider(provider)) {
      return formattedApiHost + '/chat'
    }

    if (isOpenAICompatibleProvider(provider)) {
      return formattedApiHost + '/chat/completions'
    }

    if (isAzureOpenAIProvider(provider)) {
      const apiVersion = provider.apiVersion || ''
      const path = !['preview', 'v1'].includes(apiVersion)
        ? `/v1/chat/completion?apiVersion=v1`
        : `/v1/responses?apiVersion=v1`
      return formattedApiHost + path
    }

    if (isAnthropicProvider(provider)) {
      return formattedApiHost + '/messages'
    }

    if (isGeminiProvider(provider)) {
      return formattedApiHost + '/models'
    }
    if (isOpenAIProvider(provider)) {
      return formattedApiHost + '/responses'
    }
    if (isVertexProvider(provider)) {
      return formattedApiHost + '/publishers/google'
    }
    if (isAIGatewayProvider(provider)) {
      return formattedApiHost + '/language-model'
    }
    return formattedApiHost
  }

  // API key 连通性检查状态指示器，目前仅在失败时显示
  const renderStatusIndicator = () => {
    if (apiKeyConnectivity.checking || apiKeyConnectivity.status !== HealthStatus.FAILED) {
      return null
    }

    return (
      <WarnTooltip
        content={<ErrorOverlay>{apiKeyConnectivity.error}</ErrorOverlay>}
        iconProps={{ size: 16, color: 'var(--color-status-warning)' }}
      />
    )
  }

  useEffect(() => {
    if (provider.id === 'copilot') {
      return
    }
    setApiHost(provider.apiHost)
  }, [provider.apiHost, provider.id])

  useEffect(() => {
    setAnthropicHost(provider.anthropicApiHost)
  }, [provider.anthropicApiHost])

  const canConfigureAnthropicHost = useMemo(() => {
    if (isCherryIN) {
      return false
    }
    if (isNewApiProvider(provider)) {
      return true
    }
    return (
      provider.type !== 'anthropic' && isSystemProviderId(provider.id) && isAnthropicCompatibleProviderId(provider.id)
    )
  }, [isCherryIN, provider])

  const anthropicHostPreview = useMemo(() => {
    const rawHost = anthropicApiHost ?? provider.anthropicApiHost
    // AI SDK uses the baseURL with /v1, then appends /messages
    const normalizedHost = formatApiHost(rawHost)

    return `${normalizedHost}/messages`
  }, [anthropicApiHost, provider.anthropicApiHost])

  const hostSelectorOptions = useMemo(() => {
    const options: { value: HostField; label: string }[] = [
      { value: 'apiHost', label: t('settings.provider.api_host') }
    ]

    if (canConfigureAnthropicHost) {
      options.push({ value: 'anthropicApiHost', label: t('settings.provider.anthropic_api_host') })
    }

    return options
  }, [canConfigureAnthropicHost, t])

  useEffect(() => {
    if (!canConfigureAnthropicHost && activeHostField === 'anthropicApiHost') {
      setActiveHostField('apiHost')
    }
  }, [canConfigureAnthropicHost, activeHostField])

  const hostSelectorTooltip =
    activeHostField === 'anthropicApiHost'
      ? t('settings.provider.anthropic_api_host_tooltip')
      : t('settings.provider.api_host_tooltip')

  const isAnthropicOAuth = () => provider.id === 'anthropic' && provider.authType === 'oauth'

  return (
    <SettingContainer theme={theme} style={{ background: 'var(--color-background)' }}>
      <SettingTitle>
        <Flex className="items-center gap-2">
          <ProviderName>{fancyProviderName}</ProviderName>
          {officialWebsite && (
            <Link target="_blank" href={providerConfig.websites.official} style={{ display: 'flex' }}>
              <Button variant="ghost" size="sm">
                <SquareArrowOutUpRight size={14} />
              </Button>
            </Link>
          )}
          {!isSystemProvider(provider) && (
            <Tooltip content={t('settings.provider.api.options.label')}>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => ApiOptionsSettingsPopup.show({ providerId: provider.id })}>
                <Bolt size={14} />
              </Button>
            </Tooltip>
          )}
        </Flex>
        <Switch
          checked={provider.enabled}
          key={provider.id}
          onCheckedChange={(enabled) => {
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
      {provider.id === 'ovms' && <OVMSSettings />}
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
          {!hideApiKeyInput && (
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
                  <Tooltip title={t('settings.provider.api.key.list.open')} delay={500}>
                    <Button variant="ghost" onClick={openApiKeyList} size="icon">
                      <Settings2 size={16} />
                    </Button>
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
                  variant={isApiKeyConnectable ? 'ghost' : undefined}
                  onClick={onCheckApi}
                  disabled={!apiHost || apiKeyConnectivity.checking}>
                  {apiKeyConnectivity.checking ? (
                    <LoadingIcon />
                  ) : apiKeyConnectivity.status === HealthStatus.SUCCESS ? (
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
            </>
          )}
          {!isDmxapi && (
            <>
              <SettingSubtitle style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div className="flex items-center gap-1">
                  <Tooltip title={hostSelectorTooltip} delay={300}>
                    <div>
                      <Selector
                        size={14}
                        value={activeHostField}
                        onChange={(value) => setActiveHostField(value as HostField)}
                        options={hostSelectorOptions}
                        style={{ paddingLeft: 1, fontWeight: 'bold' }}
                        placement="bottomLeft"
                      />
                    </div>
                  </Tooltip>
                  <HelpTooltip title={t('settings.provider.api.url.tip')}></HelpTooltip>
                </div>
                <Button variant="ghost" onClick={() => CustomHeaderPopup.show({ provider })} size="icon">
                  <Settings2 size={16} />
                </Button>
              </SettingSubtitle>
              {activeHostField === 'apiHost' && (
                <>
                  {isCherryIN && isChineseUser ? (
                    <CherryINSettings providerId={provider.id} apiHost={apiHost} setApiHost={setApiHost} />
                  ) : (
                    <Space.Compact style={{ width: '100%', marginTop: 5 }}>
                      <Input
                        value={apiHost}
                        placeholder={t('settings.provider.api_host')}
                        onChange={(e) => setApiHost(e.target.value)}
                        onBlur={onUpdateApiHost}
                      />
                      {isApiHostResettable && (
                        <Button variant="destructive" onClick={onReset}>
                          {t('settings.provider.api.url.reset')}
                        </Button>
                      )}
                    </Space.Compact>
                  )}
                  {isVertexProvider(provider) && (
                    <SettingHelpTextRow>
                      <SettingHelpText>{t('settings.provider.vertex_ai.api_host_help')}</SettingHelpText>
                    </SettingHelpTextRow>
                  )}
                  <SettingHelpTextRow style={{ justifyContent: 'space-between' }}>
                    <SettingHelpText
                      style={{
                        marginLeft: 6,
                        marginRight: '1em',
                        whiteSpace: 'break-spaces',
                        wordBreak: 'break-all'
                      }}>
                      {t('settings.provider.api_host_preview', { url: hostPreview() })}
                    </SettingHelpText>
                  </SettingHelpTextRow>
                </>
              )}

              {activeHostField === 'anthropicApiHost' && canConfigureAnthropicHost && (
                <>
                  <Space.Compact style={{ width: '100%', marginTop: 5 }}>
                    <Input
                      value={anthropicApiHost ?? ''}
                      placeholder={t('settings.provider.anthropic_api_host')}
                      onChange={(e) => setAnthropicHost(e.target.value)}
                      onBlur={onUpdateAnthropicHost}
                    />
                    {/* TODO: Add a reset button here. */}
                  </Space.Compact>
                  <SettingHelpTextRow style={{ flexDirection: 'column', alignItems: 'flex-start', gap: '4px' }}>
                    <SettingHelpText style={{ marginLeft: 6, whiteSpace: 'break-spaces', wordBreak: 'break-all' }}>
                      {t('settings.provider.anthropic_api_host_preview', {
                        url: anthropicHostPreview || '—'
                      })}
                    </SettingHelpText>
                  </SettingHelpTextRow>
                </>
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
      {provider.id === 'vertexai' && <VertexAISettings />}
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
