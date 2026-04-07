import { Button, Flex, RowFlex, Switch, Tooltip, WarnTooltip } from '@cherrystudio/ui'
import { HelpTooltip } from '@cherrystudio/ui'
import { useModels } from '@data/hooks/useModels'
import { useProvider, useProviderApiKeys, useProviderMutations } from '@data/hooks/useProviders'
import { adaptProvider } from '@renderer/aiCore/provider/providerConfig'
import OpenAIAlert from '@renderer/components/Alert/OpenAIAlert'
import { showErrorDetailPopup } from '@renderer/components/ErrorDetailModal'
import { LoadingIcon } from '@renderer/components/Icons'
import { ApiKeyListPopup } from '@renderer/components/Popups/ApiKeyListPopup'
import Selector from '@renderer/components/Selector'
import { isRerankModel } from '@renderer/config/models'
import { PROVIDER_URLS } from '@renderer/config/providers'
import { useTheme } from '@renderer/context/ThemeProvider'
import { useTimer } from '@renderer/hooks/useTimer'
import AnthropicSettings from '@renderer/pages/settings/ProviderSettings/AnthropicSettings'
import { ModelList } from '@renderer/pages/settings/ProviderSettings/ModelList'
import { checkApi } from '@renderer/services/ApiService'
import { isProviderSupportAuth } from '@renderer/services/ProviderService'
import { useAppDispatch } from '@renderer/store'
import { updateWebSearchProvider } from '@renderer/store/websearch'
import type { Model as V1Model, SystemProviderId } from '@renderer/types'
import { isSystemProviderId, SystemProviderIds } from '@renderer/types'
import type { ApiKeyConnectivity } from '@renderer/types/healthCheck'
import { HealthStatus } from '@renderer/types/healthCheck'
import { formatApiHost, formatApiKeys, validateApiHost } from '@renderer/utils'
import { serializeHealthCheckError } from '@renderer/utils/error'
import {
  getFancyProviderName,
  isAnthropicProvider,
  isAnthropicSupportedProvider,
  isAzureOpenAIProvider,
  isGeminiProvider,
  isNewApiProvider,
  isOllamaProvider,
  isOpenAICompatibleProvider,
  isOpenAIResponsesProvider,
  isSystemProvider,
  isVertexProvider
} from '@renderer/utils/provider.v2'
import { toV1ProviderShim } from '@renderer/utils/v1ProviderShim'
import { EndpointType } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { Divider, Input, Select, Space } from 'antd'
import Link from 'antd/es/typography/Link'
import { debounce, isEmpty } from 'lodash'
import { Bolt, Check, Settings2, SquareArrowOutUpRight } from 'lucide-react'
import type { FC } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
import CherryINOAuth from './CherryINOAuth'
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
  isOnboarding?: boolean
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
  SystemProviderIds.dmxapi,
  SystemProviderIds.mimo,
  SystemProviderIds.openrouter,
  SystemProviderIds.tokenflux
] as const
type AnthropicCompatibleProviderId = (typeof ANTHROPIC_COMPATIBLE_PROVIDER_IDS)[number]

const ANTHROPIC_COMPATIBLE_PROVIDER_ID_SET = new Set<string>(ANTHROPIC_COMPATIBLE_PROVIDER_IDS)
const isAnthropicCompatibleProviderId = (id: string): id is AnthropicCompatibleProviderId => {
  return ANTHROPIC_COMPATIBLE_PROVIDER_ID_SET.has(id)
}

type HostField = 'apiHost' | 'anthropicApiHost'

const ProviderSetting: FC<Props> = ({ providerId, isOnboarding = false }) => {
  const { provider } = useProvider(providerId)
  if (!provider) return null
  return <ProviderSettingContent provider={provider} providerId={providerId} isOnboarding={isOnboarding} />
}

interface ContentProps {
  provider: Provider
  providerId: string
  isOnboarding?: boolean
}

const ProviderSettingContent: FC<ContentProps> = ({ provider, providerId, isOnboarding = false }) => {
  const { updateProvider, updateApiKeys } = useProviderMutations(providerId)
  const { models } = useModels({ providerId })
  const { data: apiKeysData } = useProviderApiKeys(providerId)
  const patchProvider = useCallback(
    async (updates: Record<string, any>) => {
      await updateProvider(updates)
    },
    [updateProvider]
  )

  // Derive v1-like fields from v2 Provider
  const primaryEndpoint = provider.defaultChatEndpoint ?? EndpointType.OPENAI_CHAT_COMPLETIONS
  const providerApiHost = provider.endpointConfigs?.[primaryEndpoint]?.baseUrl ?? ''
  const providerAnthropicHost = provider.endpointConfigs?.[EndpointType.ANTHROPIC_MESSAGES]?.baseUrl
  const providerApiVersion = provider.settings?.apiVersion ?? ''
  const providerApiKey = apiKeysData?.keys?.map((k) => k.key).join(',') ?? ''

  const [apiHost, setApiHost] = useState(providerApiHost)
  const [anthropicApiHost, setAnthropicHost] = useState<string | undefined>(providerAnthropicHost)
  const [apiVersion, setApiVersion] = useState(providerApiVersion)
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

  // Use v2 provider.websites first, fallback to static config
  const providerConfig = PROVIDER_URLS[provider.id as keyof typeof PROVIDER_URLS]
  const officialWebsite = provider.websites?.official ?? providerConfig?.websites?.official
  const apiKeyWebsite = provider.websites?.apiKey ?? providerConfig?.websites?.apiKey
  const configuredApiHost = providerConfig?.api?.url

  const fancyProviderName = getFancyProviderName(provider)

  const [localApiKey, setLocalApiKey] = useState(providerApiKey)
  const [apiKeyConnectivity, setApiKeyConnectivity] = useState<ApiKeyConnectivity>({
    status: HealthStatus.NOT_CHECKED,
    checking: false
  })

  const updateWebSearchProviderKey = useCallback(
    ({ apiKey }: { apiKey: string }) => {
      provider.id === 'zhipu' && dispatch(updateWebSearchProvider({ id: 'zhipu', apiKey: apiKey.split(',')[0] }))
    },
    [dispatch, provider.id]
  )

  const callbacks = { updateApiKeys, updateWebSearchProviderKey, isOnboarding, providerEnabled: provider.isEnabled }
  const callbacksRef = useRef(callbacks)
  callbacksRef.current = callbacks

  const debouncedUpdateApiKey = useMemo(
    () =>
      debounce(async (value: string) => {
        const {
          updateApiKeys: _updateApiKeys,
          updateWebSearchProviderKey: _updateWS,
          isOnboarding: _onb,
          providerEnabled
        } = callbacksRef.current
        const formatted = formatApiKeys(value)
        const keys = formatted.split(',').filter(Boolean)
        const apiKeys = keys.map((key) => ({ id: crypto.randomUUID(), key, isEnabled: true }))
        await _updateApiKeys(apiKeys)
        _updateWS({ apiKey: formatted })
        // Auto-enable provider when apiKey is updated in onboarding mode
        if (_onb && formatted && !providerEnabled) {
          await patchProvider({ isEnabled: true })
        }
      }, 150),

    [patchProvider]
  )

  // 同步 provider apiKey 到 localApiKey
  // 重置连通性检查状态
  useEffect(() => {
    setLocalApiKey(providerApiKey)
    setApiKeyConnectivity({ status: HealthStatus.NOT_CHECKED })
  }, [providerApiKey])

  // 同步 localApiKey 到 provider（防抖）
  useEffect(() => {
    if (localApiKey !== providerApiKey) {
      debouncedUpdateApiKey(localApiKey)
    }

    // 卸载时取消任何待执行的更新
    return () => debouncedUpdateApiKey.cancel()
  }, [localApiKey, providerApiKey, debouncedUpdateApiKey])

  const isApiKeyConnectable = useMemo(() => {
    return apiKeyConnectivity.status === 'success'
  }, [apiKeyConnectivity])

  const moveProviderToTop = useCallback(async () => {
    await updateProvider({ sortOrder: 0, isEnabled: true })
  }, [updateProvider])

  const onUpdateApiHost = () => {
    if (!validateApiHost(apiHost)) {
      setApiHost(providerApiHost)
      window.toast.error(t('settings.provider.api_host_no_valid'))
      return
    }
    if (isVertexProvider(provider) || apiHost.trim()) {
      patchProvider({
        endpointConfigs: {
          ...provider.endpointConfigs,
          [primaryEndpoint]: { ...provider.endpointConfigs?.[primaryEndpoint], baseUrl: apiHost }
        }
      })
    } else {
      setApiHost(providerApiHost)
    }
  }

  const onUpdateAnthropicHost = () => {
    const trimmedHost = anthropicApiHost?.trim()

    if (trimmedHost) {
      patchProvider({
        endpointConfigs: {
          ...provider.endpointConfigs,
          [EndpointType.ANTHROPIC_MESSAGES]: {
            ...provider.endpointConfigs?.[EndpointType.ANTHROPIC_MESSAGES],
            baseUrl: trimmedHost
          }
        }
      })
      setAnthropicHost(trimmedHost)
    } else {
      const { [EndpointType.ANTHROPIC_MESSAGES]: _, ...restConfigs } = provider.endpointConfigs ?? {}
      patchProvider({ endpointConfigs: restConfigs })
      setAnthropicHost(undefined)
    }
  }
  const onUpdateApiVersion = () => patchProvider({ providerSettings: { ...provider.settings, apiVersion } })

  const openApiKeyList = async () => {
    if (localApiKey !== providerApiKey) {
      const formatted = formatApiKeys(localApiKey)
      const keys = formatted.split(',').filter(Boolean)
      const apiKeys = keys.map((key) => ({ id: crypto.randomUUID(), key, isEnabled: true }))
      await updateApiKeys(apiKeys)
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

    const modelsToCheck = models.filter((model) => !isRerankModel(model as any))

    if (isEmpty(modelsToCheck)) {
      window.toast.error({
        timeout: 5000,
        title: t('settings.provider.no_models_for_check')
      })
      return
    }

    // TODO(v2-cleanup): Remove v1 shim after SelectProviderModelPopup migrates to v2
    const v1ProviderForPopup = toV1ProviderShim(provider, {
      models,
      apiKey: formattedLocalKey,
      apiHost
    })
    const model = await SelectProviderModelPopup.show({ provider: v1ProviderForPopup })

    if (!model) {
      window.toast.error(i18n.t('message.error.enter.model'))
      return
    }

    try {
      setApiKeyConnectivity((prev) => ({ ...prev, checking: true, status: HealthStatus.NOT_CHECKED }))
      // TODO(v2-cleanup): Remove v1 shim after checkApi migrates to v2
      const v1ProviderForCheck = toV1ProviderShim(provider, {
        models,
        apiKey: formattedLocalKey,
        apiHost
      })
      await checkApi(v1ProviderForCheck, model as V1Model)

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
    } catch (error: unknown) {
      window.toast.error({
        timeout: 8000,
        title: i18n.t('message.api.connection.failed')
      })

      const serializedError = serializeHealthCheckError(error)

      setApiKeyConnectivity((prev) => ({ ...prev, status: HealthStatus.FAILED, error: serializedError }))
    } finally {
      setApiKeyConnectivity((prev) => ({ ...prev, checking: false }))
    }
  }

  const onReset = useCallback(() => {
    setApiHost(configuredApiHost)
    patchProvider({
      endpointConfigs: {
        ...provider?.endpointConfigs,
        [primaryEndpoint]: { ...provider?.endpointConfigs?.[primaryEndpoint], baseUrl: configuredApiHost }
      }
    })
  }, [configuredApiHost, patchProvider, provider?.endpointConfigs, primaryEndpoint])

  const isApiHostResettable = useMemo(() => {
    return !isEmpty(configuredApiHost) && apiHost !== configuredApiHost
  }, [configuredApiHost, apiHost])

  const hostPreview = () => {
    // TODO(v2-cleanup): Remove v1 shim after adaptProvider migrates to v2
    const v1ProviderForAdapt = toV1ProviderShim(provider, { apiHost })
    const formattedApiHost = adaptProvider({ provider: v1ProviderForAdapt }).apiHost

    if (isOllamaProvider(provider)) {
      return formattedApiHost + '/chat'
    }

    if (isOpenAICompatibleProvider(provider)) {
      return formattedApiHost + '/chat/completions'
    }

    if (isAzureOpenAIProvider(provider)) {
      const ver = provider.settings?.apiVersion || ''
      const path = !['preview', 'v1'].includes(ver)
        ? `/v1/chat/completions?apiVersion=v1`
        : `/v1/responses?apiVersion=v1`
      return formattedApiHost + path
    }

    if (isAnthropicProvider(provider)) {
      return formattedApiHost + '/messages'
    }

    if (isGeminiProvider(provider)) {
      return formattedApiHost + '/models'
    }
    if (isOpenAIResponsesProvider(provider)) {
      return formattedApiHost + '/responses'
    }
    if (isVertexProvider(provider)) {
      return formattedApiHost + '/publishers/google'
    }
    return formattedApiHost
  }

  // API key 连通性检查状态指示器，目前仅在失败时显示
  const renderStatusIndicator = () => {
    if (apiKeyConnectivity.checking || apiKeyConnectivity.status !== HealthStatus.FAILED) {
      return null
    }

    return (
      <>
        <WarnTooltip
          content={
            <ErrorOverlay>{apiKeyConnectivity.error?.message || t('settings.models.check.failed')}</ErrorOverlay>
          }
          iconProps={{ size: 16, color: 'var(--color-status-warning)' }}
          onClick={() => showErrorDetailPopup({ error: apiKeyConnectivity.error })}
        />
      </>
    )
  }

  useEffect(() => {
    if (provider.id === 'copilot') {
      return
    }
    setApiHost(providerApiHost)
  }, [providerApiHost, provider.id])

  useEffect(() => {
    setAnthropicHost(providerAnthropicHost)
  }, [providerAnthropicHost])

  const canConfigureAnthropicHost = useMemo(() => {
    if (isCherryIN) {
      return false
    }
    if (isNewApiProvider(provider)) {
      return true
    }
    return (
      !isAnthropicProvider(provider) && isSystemProviderId(provider.id) && isAnthropicCompatibleProviderId(provider.id)
    )
  }, [isCherryIN, provider])

  const anthropicHostPreview = useMemo(() => {
    const rawHost = anthropicApiHost ?? providerAnthropicHost
    const normalizedHost = formatApiHost(rawHost)

    return `${normalizedHost}/messages`
  }, [anthropicApiHost, providerAnthropicHost])

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
            <Link target="_blank" href={officialWebsite} style={{ display: 'flex' }}>
              <Button variant="ghost" size="sm">
                <SquareArrowOutUpRight size={14} />
              </Button>
            </Link>
          )}
          {(!isSystemProvider(provider) || isAnthropicSupportedProvider(provider)) && (
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
          checked={provider.isEnabled}
          key={provider.id}
          onCheckedChange={(enabled) => {
            patchProvider({
              isEnabled: enabled,
              endpointConfigs: {
                ...provider.endpointConfigs,
                [primaryEndpoint]: { ...provider.endpointConfigs?.[primaryEndpoint], baseUrl: apiHost }
              }
            })
            if (enabled) {
              moveProviderToTop()
            }
          }}
        />
      </SettingTitle>
      <Divider style={{ width: '100%', margin: '10px 0' }} />
      {isProviderSupportAuth(provider as any) && <ProviderOAuth providerId={provider.id} />}
      {isCherryIN && <CherryINOAuth providerId={provider.id} />}
      {provider.id === 'openai' && <OpenAIAlert />}
      {provider.id === 'ovms' && <OVMSSettings />}
      {isDmxapi && <DMXAPISettings providerId={provider.id} />}
      {provider.id === 'anthropic' && (
        <>
          <SettingSubtitle style={{ marginTop: 5 }}>{t('settings.provider.anthropic.auth_method')}</SettingSubtitle>
          <Select
            style={{ width: '40%', marginTop: 5, marginBottom: 10 }}
            value={provider.authType || 'api-key'}
            onChange={(value) => patchProvider({ authConfig: { type: value } })}
            options={[
              { value: 'api-key', label: t('settings.provider.anthropic.apikey') },
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
                  autoFocus={provider.isEnabled && providerApiKey === '' && !isProviderSupportAuth(provider as any)}
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
                        onChange={(value) => setActiveHostField(value)}
                        options={hostSelectorOptions}
                        style={{ paddingLeft: 1, fontWeight: 'bold' }}
                        placement="bottomLeft"
                      />
                    </div>
                  </Tooltip>
                  <HelpTooltip title={t('settings.provider.api.url.tip')}></HelpTooltip>
                </div>
                <Button variant="ghost" onClick={() => CustomHeaderPopup.show({ providerId: provider.id })} size="icon">
                  <Settings2 size={16} />
                </Button>
              </SettingSubtitle>
              {activeHostField === 'apiHost' && (
                <>
                  {isCherryIN && isChineseUser ? (
                    <CherryINSettings providerId={provider.id} />
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
      {provider.id === 'lmstudio' && <LMStudioSettings providerId={provider.id} />}
      {provider.id === 'gpustack' && <GPUStackSettings providerId={provider.id} />}
      {provider.id === 'copilot' && <GithubCopilotSettings providerId={provider.id} />}
      {provider.id === 'aws-bedrock' && <AwsBedrockSettings providerId={provider.id} />}
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
