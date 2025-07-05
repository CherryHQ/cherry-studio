import { CheckOutlined, LoadingOutlined } from '@ant-design/icons'
import { isOpenAIProvider } from '@renderer/aiCore/clients/ApiClientFactory'
import OpenAIAlert from '@renderer/components/Alert/OpenAIAlert'
import { StreamlineGoodHealthAndWellBeing } from '@renderer/components/Icons/SVGIcon'
import { HStack } from '@renderer/components/Layout'
import { ApiKeyListPopup } from '@renderer/components/Popups/ApiKeyListPopup'
import { isEmbeddingModel, isRerankModel } from '@renderer/config/models'
import { PROVIDER_CONFIG } from '@renderer/config/providers'
import { useTheme } from '@renderer/context/ThemeProvider'
import { useAllProviders, useProvider, useProviders } from '@renderer/hooks/useProvider'
import i18n from '@renderer/i18n'
import { checkApi } from '@renderer/services/ApiService'
import { checkModelsHealth, getModelCheckSummary } from '@renderer/services/HealthCheckService'
import { isProviderSupportAuth } from '@renderer/services/ProviderService'
import { Provider } from '@renderer/types'
import { formatApiHost, formatApiKeys, getFancyProviderName, splitApiKeyString } from '@renderer/utils'
import { lightbulbVariants } from '@renderer/utils/motionVariants'
import { Button, Divider, Flex, Input, Space, Switch, Tooltip } from 'antd'
import Link from 'antd/es/typography/Link'
import { debounce, isEmpty } from 'lodash'
import { List, Settings2, SquareArrowOutUpRight } from 'lucide-react'
import { motion } from 'motion/react'
import { FC, useCallback, useDeferredValue, useEffect, useState } from 'react'
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
import DMXAPISettings from './DMXAPISettings'
import GithubCopilotSettings from './GithubCopilotSettings'
import GPUStackSettings from './GPUStackSettings'
import HealthCheckPopup from './HealthCheckPopup'
import LMStudioSettings from './LMStudioSettings'
import ModelList, { ModelStatus } from './ModelList'
import ModelListSearchBar from './ModelListSearchBar'
import ProviderOAuth from './ProviderOAuth'
import ProviderSettingsPopup from './ProviderSettingsPopup'
import SelectProviderModelPopup from './SelectProviderModelPopup'
import VertexAISettings from './VertexAISettings'

interface Props {
  provider: Provider
}

const ProviderSetting: FC<Props> = ({ provider: _provider }) => {
  const { provider, updateProvider, models } = useProvider(_provider.id)
  const allProviders = useAllProviders()
  const { updateProviders } = useProviders()
  const [apiHost, setApiHost] = useState(provider.apiHost)
  const [apiVersion, setApiVersion] = useState(provider.apiVersion)
  const [apiValid, setApiValid] = useState(false)
  const [apiChecking, setApiChecking] = useState(false)
  const [modelSearchText, setModelSearchText] = useState('')
  const deferredModelSearchText = useDeferredValue(modelSearchText)
  const { t } = useTranslation()
  const { theme } = useTheme()

  const isAzureOpenAI = provider.id === 'azure-openai' || provider.type === 'azure-openai'

  const isDmxapi = provider.id === 'dmxapi'

  const providerConfig = PROVIDER_CONFIG[provider.id]
  const officialWebsite = providerConfig?.websites?.official
  const apiKeyWebsite = providerConfig?.websites?.apiKey
  const configedApiHost = providerConfig?.api?.url

  const [modelStatuses, setModelStatuses] = useState<ModelStatus[]>([])
  const [isHealthChecking, setIsHealthChecking] = useState(false)

  const fancyProviderName = getFancyProviderName(provider)

  const [inputApiKey, _setInputApiKey] = useState(provider.apiKey)
  const [isApiKeyListOpen, setIsApiKeyListOpen] = useState(false)

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const debouncedSetApiKey = useCallback(
    debounce((value) => {
      setApiKey(value)
    }, 100),
    []
  )

  const setApiKey = useCallback(
    (value: string) => {
      if (value !== provider.apiKey) {
        updateProvider({ apiKey: formatApiKeys(value) })
      }
    },
    [provider.apiKey, updateProvider]
  )

  // 设置密钥输入框的值，同步到 provider.apiKey
  const setInputApiKey = useCallback(
    (value: string) => {
      _setInputApiKey(formatApiKeys(value))
      debouncedSetApiKey(value)
    },
    [_setInputApiKey, debouncedSetApiKey]
  )

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
    setIsApiKeyListOpen(true)
    await ApiKeyListPopup.show({
      providerId: provider.id,
      providerType: 'llm-provider',
      title: `${fancyProviderName} ${t('settings.provider.api.key.list.title')}`
    })
    setIsApiKeyListOpen(false)
  }

  useEffect(() => {
    if (isApiKeyListOpen) {
      _setInputApiKey(provider.apiKey)
    }
  }, [provider.apiKey, isApiKeyListOpen])

  const onHealthCheck = async () => {
    const modelsToCheck = models.filter((model) => !isRerankModel(model))

    if (isEmpty(modelsToCheck)) {
      window.message.error({
        key: 'no-models',
        style: { marginTop: '3vh' },
        duration: 5,
        content: t('settings.provider.no_models_for_check')
      })
      return
    }

    const keys = splitApiKeyString(provider.apiKey)

    // Add an empty key to enable health checks for local models.
    // Error messages will be shown for each model if a valid key is needed.
    if (keys.length === 0) {
      keys.push('')
    }

    // Show configuration dialog to get health check parameters
    const result = await HealthCheckPopup.show({
      title: t('settings.models.check.title'),
      provider: { ...provider, apiHost },
      apiKeys: keys
    })

    if (result.cancelled) {
      return
    }

    // Prepare the list of models to be checked
    const initialStatuses = modelsToCheck.map((model) => ({
      model,
      checking: true,
      status: undefined
    }))
    setModelStatuses(initialStatuses)
    setIsHealthChecking(true)

    const checkResults = await checkModelsHealth(
      {
        provider: { ...provider, apiHost },
        models: modelsToCheck,
        apiKeys: result.apiKeys,
        isConcurrent: result.isConcurrent
      },
      (checkResult, index) => {
        setModelStatuses((current) => {
          const updated = [...current]
          if (updated[index]) {
            updated[index] = {
              ...updated[index],
              checking: false,
              status: checkResult.status,
              error: checkResult.error,
              keyResults: checkResult.keyResults,
              latency: checkResult.latency
            }
          }
          return updated
        })
      }
    )

    window.message.info({
      key: 'health-check-summary',
      style: { marginTop: '3vh' },
      duration: 5,
      content: getModelCheckSummary(checkResults, provider.name)
    })

    // Reset health check status
    setIsHealthChecking(false)
  }

  const onCheckApi = async () => {
    // 如果存在多个密钥，直接打开管理窗口
    if (provider.apiKey.includes(',')) {
      await openApiKeyList()
      return
    }

    const modelsToCheck = models.filter((model) => !isEmbeddingModel(model) && !isRerankModel(model))

    if (isEmpty(modelsToCheck)) {
      window.message.error({
        key: 'no-models',
        style: { marginTop: '3vh' },
        duration: 5,
        content: t('settings.provider.no_models_for_check')
      })
      return
    }

    const model = await SelectProviderModelPopup.show({ provider })

    if (!model) {
      window.message.error({ content: i18n.t('message.error.enter.model'), key: 'api-check' })
      return
    }

    try {
      setApiChecking(true)
      await checkApi({ ...provider, apiHost }, model)

      window.message.success({
        key: 'api-check',
        style: { marginTop: '3vh' },
        duration: 2,
        content: i18n.t('message.api.connection.success')
      })

      setApiValid(true)
      setTimeout(() => setApiValid(false), 3000)
    } catch (error: any) {
      const errorMessage = error?.message ? ' ' + error.message : ''

      window.message.error({
        key: 'api-check',
        style: { marginTop: '3vh' },
        duration: 8,
        content: i18n.t('message.api.connection.failed') + errorMessage
      })

      setApiValid(false)
    } finally {
      setApiChecking(false)
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
    return formatApiHost(apiHost) + 'responses'
  }

  useEffect(() => {
    if (provider.id === 'copilot') {
      return
    }
    setApiHost(provider.apiHost)
  }, [provider.apiHost, provider.id])

  return (
    <SettingContainer theme={theme} style={{ background: 'var(--color-background)' }}>
      <SettingTitle>
        <Flex align="center" gap={5}>
          <ProviderName>{fancyProviderName}</ProviderName>
          {officialWebsite && (
            <Link target="_blank" href={providerConfig.websites.official} style={{ display: 'flex' }}>
              <Button type="text" size="small" icon={<SquareArrowOutUpRight size={14} />} />
            </Link>
          )}
          {!provider.isSystem && (
            <Button
              type="text"
              size="small"
              onClick={() => ProviderSettingsPopup.show({ provider })}
              icon={<Settings2 size={14} />}
            />
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
      {isProviderSupportAuth(provider) && <ProviderOAuth provider={provider} setApiKey={setApiKey} />}
      {provider.id === 'openai' && <OpenAIAlert />}
      {isDmxapi && <DMXAPISettings provider={provider} setApiKey={setApiKey} />}
      {provider.id !== 'vertexai' && (
        <>
          <SettingSubtitle
            style={{
              marginTop: 5,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between'
            }}>
            <Space>{t('settings.provider.api_key')}</Space>
            <Space>
              {provider.id !== 'copilot' && (
                <Tooltip title={t('settings.provider.api.key.list.open')} mouseEnterDelay={0.5}>
                  <Button type="text" size="small" onClick={openApiKeyList} icon={<List size={14} />} />
                </Tooltip>
              )}
            </Space>
          </SettingSubtitle>
          <Space.Compact style={{ width: '100%', marginTop: 5 }}>
            <Input.Password
              value={inputApiKey}
              placeholder={t('settings.provider.api_key')}
              onChange={(e) => setInputApiKey(e.target.value)}
              onPressEnter={(e) => setInputApiKey(e.currentTarget.value)}
              onBlur={(e) => setInputApiKey(e.currentTarget.value)}
              spellCheck={false}
              autoFocus={provider.enabled && provider.apiKey === '' && !isProviderSupportAuth(provider)}
              disabled={provider.id === 'copilot'}
            />
            <Button
              type={apiValid ? 'primary' : 'default'}
              ghost={apiValid}
              onClick={onCheckApi}
              disabled={!apiHost || apiChecking}>
              {apiChecking ? <LoadingOutlined spin /> : apiValid ? <CheckOutlined /> : t('settings.provider.check')}
            </Button>
          </Space.Compact>
          {apiKeyWebsite && (
            <SettingHelpTextRow style={{ justifyContent: 'space-between' }}>
              <HStack>
                {!isDmxapi && (
                  <SettingHelpLink target="_blank" href={apiKeyWebsite}>
                    {t('settings.provider.get_api_key')}
                  </SettingHelpLink>
                )}
              </HStack>
              <SettingHelpText>{t('settings.provider.api_key.tip')}</SettingHelpText>
            </SettingHelpTextRow>
          )}
          {!isDmxapi && (
            <>
              <SettingSubtitle>{t('settings.provider.api_host')}</SettingSubtitle>
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
        </>
      )}
      {provider.id === 'lmstudio' && <LMStudioSettings />}
      {provider.id === 'gpustack' && <GPUStackSettings />}
      {provider.id === 'copilot' && <GithubCopilotSettings provider={provider} setApiKey={setApiKey} />}
      {provider.id === 'vertexai' && <VertexAISettings />}
      <SettingSubtitle style={{ marginBottom: 5 }}>
        <Space align="center" style={{ width: '100%', justifyContent: 'space-between' }}>
          <HStack alignItems="center" gap={8} mb={5}>
            <SettingSubtitle style={{ marginTop: 0 }}>{t('common.models')}</SettingSubtitle>
            {!isEmpty(models) && <ModelListSearchBar onSearch={setModelSearchText} />}
          </HStack>
          {!isEmpty(models) && (
            <Tooltip title={t('settings.models.check.button_caption')} mouseEnterDelay={0.5}>
              <Button
                type="text"
                size="small"
                onClick={onHealthCheck}
                icon={
                  <motion.span
                    variants={lightbulbVariants}
                    animate={isHealthChecking ? 'active' : 'idle'}
                    initial="idle">
                    <StreamlineGoodHealthAndWellBeing />
                  </motion.span>
                }
              />
            </Tooltip>
          )}
        </Space>
      </SettingSubtitle>
      <ModelList providerId={provider.id} modelStatuses={modelStatuses} searchText={deferredModelSearchText} />
    </SettingContainer>
  )
}

const ProviderName = styled.span`
  font-size: 14px;
  font-weight: 500;
  margin-right: -2px;
`

export default ProviderSetting
