import { isOpenAIProvider } from '@renderer/aiCore/clients/ApiClientFactory'
import OpenAIAlert from '@renderer/components/Alert/OpenAIAlert'
import { StreamlineGoodHealthAndWellBeing } from '@renderer/components/Icons/SVGIcon'
import { HStack } from '@renderer/components/Layout'
import { isRerankModel } from '@renderer/config/models'
import { PROVIDER_CONFIG } from '@renderer/config/providers'
import { useTheme } from '@renderer/context/ThemeProvider'
import { useAllProviders, useProvider, useProviders } from '@renderer/hooks/useProvider'
import { checkModelsHealth, getModelCheckSummary } from '@renderer/services/HealthCheckService'
import { isProviderSupportAuth } from '@renderer/services/ProviderService'
import { Provider } from '@renderer/types'
import { formatApiHost, splitApiKeyString } from '@renderer/utils/api'
import { lightbulbVariants } from '@renderer/utils/motionVariants'
import { Button, Divider, Flex, Input, Space, Switch, Tooltip } from 'antd'
import Link from 'antd/es/typography/Link'
import { isEmpty } from 'lodash'
import { Settings2, SquareArrowOutUpRight } from 'lucide-react'
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
import ApiKeyList from './ApiKeyList'
import DMXAPISettings from './DMXAPISettings'
import GithubCopilotSettings from './GithubCopilotSettings'
import GPUStackSettings from './GPUStackSettings'
import HealthCheckPopup from './HealthCheckPopup'
import LMStudioSettings from './LMStudioSettings'
import ModelList, { ModelStatus } from './ModelList'
import ModelListSearchBar from './ModelListSearchBar'
import ProviderOAuth from './ProviderOAuth'
import ProviderSettingsPopup from './ProviderSettingsPopup'
import VertexAISettings from './VertexAISettings'

interface Props {
  provider: Provider
}

const ProviderSetting: FC<Props> = ({ provider: _provider }) => {
  const { provider } = useProvider(_provider.id)
  const allProviders = useAllProviders()
  const { updateProviders } = useProviders()
  const [apiKey, setApiKey] = useState(provider.apiKey)
  const [apiHost, setApiHost] = useState(provider.apiHost)
  const [apiVersion, setApiVersion] = useState(provider.apiVersion)
  const [modelSearchText, setModelSearchText] = useState('')
  const deferredModelSearchText = useDeferredValue(modelSearchText)
  const { updateProvider, models } = useProvider(provider.id)
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
      updateProvider({ ...provider, apiHost })
    } else {
      setApiHost(provider.apiHost)
    }
  }

  const handleApiKeyChange = (newApiKey: string) => {
    setApiKey(newApiKey)
    updateProvider({ ...provider, apiKey: newApiKey })
  }

  const onUpdateApiVersion = () => updateProvider({ ...provider, apiVersion })

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

    const keys = splitApiKeyString(apiKey)

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

  const onReset = () => {
    setApiHost(configedApiHost)
    updateProvider({ ...provider, apiHost: configedApiHost })
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
    setApiKey(provider.apiKey)
    setApiHost(provider.apiHost)
  }, [provider.apiKey, provider.apiHost, provider.id])

  // Save apiKey to provider when unmount
  useEffect(() => {
    return () => {
      if (apiKey.trim() && apiKey !== provider.apiKey) {
        updateProvider({ ...provider, apiKey })
      }
    }
  }, [apiKey, provider, updateProvider])

  return (
    <SettingContainer theme={theme} style={{ background: 'var(--color-background)' }}>
      <SettingTitle>
        <Flex align="center" gap={5}>
          <ProviderName>{provider.isSystem ? t(`provider.${provider.id}`) : provider.name}</ProviderName>
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
            updateProvider({ ...provider, apiKey, apiHost, enabled })
            if (enabled) {
              moveProviderToTop(provider.id)
            }
          }}
        />
      </SettingTitle>
      <Divider style={{ width: '100%', margin: '10px 0' }} />
      {isProviderSupportAuth(provider) && (
        <ProviderOAuth
          provider={provider}
          setApiKey={(v) => {
            setApiKey(v)
            updateProvider({ ...provider, apiKey: v })
          }}
        />
      )}
      {provider.id === 'openai' && <OpenAIAlert />}
      {isDmxapi && <DMXAPISettings provider={provider} setApiKey={setApiKey} />}
      {provider.id !== 'vertexai' && (
        <>
          <SettingSubtitle style={{ marginBottom: 5 }}>
            <Space align="center" style={{ width: '100%', justifyContent: 'space-between' }}>
              <SettingSubtitle style={{ marginTop: 0 }}>{t('settings.provider.api_key')}</SettingSubtitle>
            </Space>
          </SettingSubtitle>
          <ApiKeyList provider={provider} apiKeys={apiKey} onChange={handleApiKeyChange} type="provider" />
          {apiKeyWebsite && (
            <SettingHelpTextRow style={{ justifyContent: 'space-between', marginTop: '10px' }}>
              <HStack>
                {!isDmxapi && (
                  <SettingHelpLink target="_blank" href={apiKeyWebsite}>
                    {t('settings.provider.get_api_key')}
                  </SettingHelpLink>
                )}
              </HStack>
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
