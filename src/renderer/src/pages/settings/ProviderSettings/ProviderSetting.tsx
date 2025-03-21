import { CheckOutlined, ExportOutlined, HeartOutlined, LoadingOutlined, SettingOutlined } from '@ant-design/icons'
import { HStack } from '@renderer/components/Layout'
import OAuthButton from '@renderer/components/OAuth/OAuthButton'
import { PROVIDER_CONFIG } from '@renderer/config/providers'
import { useTheme } from '@renderer/context/ThemeProvider'
import { useProvider } from '@renderer/hooks/useProvider'
import i18n from '@renderer/i18n'
import { isOpenAIProvider } from '@renderer/providers/ProviderFactory'
import { checkApi, formatApiKeys } from '@renderer/services/ApiService'
import { checkModelsHealth, ModelCheckStatus } from '@renderer/services/HealthCheckService'
import { isProviderSupportAuth, isProviderSupportCharge } from '@renderer/services/ProviderService'
import { Provider } from '@renderer/types'
import { formatApiHost } from '@renderer/utils/api'
import { providerCharge } from '@renderer/utils/oauth'
import { Button, Divider, Flex, Input, Space, Switch } from 'antd'
import Link from 'antd/es/typography/Link'
import { isEmpty } from 'lodash'
import { FC, useEffect, useState } from 'react'
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
import ApiCheckPopup from './ApiCheckPopup'
import GithubCopilotSettings from './GithubCopilotSettings'
import GPUStackSettings from './GPUStackSettings'
import GraphRAGSettings from './GraphRAGSettings'
import HealthCheckPopup from './HealthCheckPopup'
import LMStudioSettings from './LMStudioSettings'
import ModelList, { ModelStatus } from './ModelList'
import OllamSettings from './OllamaSettings'
import ProviderSettingsPopup from './ProviderSettingsPopup'
import SelectProviderModelPopup from './SelectProviderModelPopup'

interface Props {
  provider: Provider
}

const ProviderSetting: FC<Props> = ({ provider: _provider }) => {
  const { provider } = useProvider(_provider.id)
  const [apiKey, setApiKey] = useState(provider.apiKey)
  const [apiHost, setApiHost] = useState(provider.apiHost)
  const [apiVersion, setApiVersion] = useState(provider.apiVersion)
  const [apiValid, setApiValid] = useState(false)
  const [apiChecking, setApiChecking] = useState(false)
  const { updateProvider, models } = useProvider(provider.id)
  const { t } = useTranslation()
  const { theme } = useTheme()

  const isAzureOpenAI = provider.id === 'azure-openai' || provider.type === 'azure-openai'

  const providerConfig = PROVIDER_CONFIG[provider.id]
  const officialWebsite = providerConfig?.websites?.official
  const apiKeyWebsite = providerConfig?.websites?.apiKey
  const configedApiHost = providerConfig?.api?.url

  const [modelStatuses, setModelStatuses] = useState<ModelStatus[]>([])
  const [isHealthChecking, setIsHealthChecking] = useState(false)

  const onUpdateApiKey = () => {
    if (apiKey !== provider.apiKey) {
      updateProvider({ ...provider, apiKey })
    }
  }

  const onUpdateApiHost = () => {
    if (apiHost.trim()) {
      updateProvider({ ...provider, apiHost })
    } else {
      setApiHost(provider.apiHost)
    }
  }

  const onUpdateApiVersion = () => updateProvider({ ...provider, apiVersion })

  const onHealthCheck = async () => {
    if (isEmpty(models)) {
      window.message.error({
        key: 'no-models',
        style: { marginTop: '3vh' },
        duration: 5,
        content: t('settings.provider.no_models')
      })
      return
    }

    const keys = apiKey
      .split(',')
      .map((k) => k.trim())
      .filter((k) => k)

    if (keys.length === 0) {
      window.message.error({
        key: 'no-api-keys',
        style: { marginTop: '3vh' },
        duration: 5,
        content: t('settings.models.check.no_api_keys')
      })
      return
    }

    // Show configuration dialog to get health check parameters
    const result = await HealthCheckPopup.show({
      title: t('settings.models.check.title'),
      provider: { ...provider, apiHost },
      apiKeys: keys
    })

    if (result.cancelled || result.apiKeys.length === 0) {
      return
    }

    // Prepare the list of models to be checked
    const initialStatuses = models.map((model) => ({
      model,
      checking: true,
      status: undefined
    }))
    setModelStatuses(initialStatuses)
    setIsHealthChecking(true)

    const checkResults = await checkModelsHealth(
      {
        provider: { ...provider, apiHost },
        models,
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

    // Show summary of results after checking
    const failedModels = checkResults.filter((result) => result.status === ModelCheckStatus.FAILED)
    const partialModels = checkResults.filter((result) => result.status === ModelCheckStatus.PARTIAL)
    const successModels = checkResults.filter((result) => result.status === ModelCheckStatus.SUCCESS)

    // Display statistics of all model check results
    window.message.info({
      key: 'health-check-summary',
      style: { marginTop: '3vh' },
      duration: 10,
      content: t('settings.models.check.model_status_summary', {
        provider: provider.name,
        count_passed: successModels.length,
        count_failed: failedModels.length,
        count_partial: partialModels.length
      })
    })

    // Reset health check status
    setIsHealthChecking(false)
  }

  const onCheckApi = async () => {
    if (isEmpty(models)) {
      window.message.error({
        key: 'no-models',
        style: { marginTop: '3vh' },
        duration: 5,
        content: t('settings.provider.no_models')
      })
      return
    }

    const model = await SelectProviderModelPopup.show({ provider })

    if (!model) {
      window.message.error({ content: i18n.t('message.error.enter.model'), key: 'api-check' })
      return
    }

    if (apiKey.includes(',')) {
      const keys = apiKey
        .split(',')
        .map((k) => k.trim())
        .filter((k) => k)

      const result = await ApiCheckPopup.show({
        title: t('settings.provider.check_multiple_keys'),
        provider: { ...provider, apiHost },
        model,
        apiKeys: keys,
        type: 'provider'
      })

      if (result?.validKeys) {
        setApiKey(result.validKeys.join(','))
        updateProvider({ ...provider, apiKey: result.validKeys.join(',') })
      }
    } else {
      setApiChecking(true)

      const { valid, error } = await checkApi({ ...provider, apiKey, apiHost }, model)

      const errorMessage = error && error?.message ? ' ' + error?.message : ''

      window.message[valid ? 'success' : 'error']({
        key: 'api-check',
        style: { marginTop: '3vh' },
        duration: valid ? 2 : 8,
        content: valid
          ? i18n.t('message.api.connection.success')
          : i18n.t('message.api.connection.failed') + errorMessage
      })

      setApiValid(valid)
      setApiChecking(false)
      setTimeout(() => setApiValid(false), 3000)
    }
  }

  const onReset = () => {
    setApiHost(configedApiHost)
    updateProvider({ ...provider, apiHost: configedApiHost })
  }

  const hostPreview = () => {
    if (apiHost.endsWith('#')) {
      return apiHost.replace('#', '')
    }

    return formatApiHost(apiHost) + 'chat/completions'
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
    <SettingContainer theme={theme}>
      <SettingTitle>
        <Flex align="center" gap={8}>
          <ProviderName>{provider.isSystem ? t(`provider.${provider.id}`) : provider.name}</ProviderName>
          {officialWebsite! && (
            <Link target="_blank" href={providerConfig.websites.official}>
              <ExportOutlined style={{ color: 'var(--color-text)', fontSize: '12px' }} />
            </Link>
          )}
          {!provider.isSystem && (
            <Button type="text" style={{ width: 30 }} onClick={() => ProviderSettingsPopup.show({ provider })}>
              <SettingOutlined />
            </Button>
          )}
        </Flex>
        <Switch
          value={provider.enabled}
          key={provider.id}
          onChange={(enabled) => updateProvider({ ...provider, apiKey, apiHost, enabled })}
        />
      </SettingTitle>
      <Divider style={{ width: '100%', margin: '10px 0' }} />
      <SettingSubtitle style={{ marginTop: 5 }}>{t('settings.provider.api_key')}</SettingSubtitle>
      <Space.Compact style={{ width: '100%', marginTop: 5 }}>
        <Input.Password
          value={apiKey}
          placeholder={t('settings.provider.api_key')}
          onChange={(e) => setApiKey(formatApiKeys(e.target.value))}
          onBlur={onUpdateApiKey}
          spellCheck={false}
          type="password"
          autoFocus={provider.enabled && apiKey === ''}
          disabled={provider.id === 'copilot'}
        />
        {isProviderSupportAuth(provider) && <OAuthButton provider={provider} onSuccess={setApiKey} />}
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
          <HStack gap={5}>
            <SettingHelpLink target="_blank" href={apiKeyWebsite}>
              {t('settings.provider.get_api_key')}
            </SettingHelpLink>
            {isProviderSupportCharge(provider) && (
              <SettingHelpLink onClick={() => providerCharge(provider.id)}>
                {t('settings.provider.charge')}
              </SettingHelpLink>
            )}
          </HStack>
          <SettingHelpText>{t('settings.provider.api_key.tip')}</SettingHelpText>
        </SettingHelpTextRow>
      )}
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
          <SettingHelpText style={{ minWidth: 'fit-content' }}>{t('settings.provider.api.url.tip')}</SettingHelpText>
        </SettingHelpTextRow>
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
      {provider.id === 'ollama' && <OllamSettings />}
      {provider.id === 'lmstudio' && <LMStudioSettings />}
      {provider.id === 'gpustack' && <GPUStackSettings />}
      {provider.id === 'graphrag-kylin-mountain' && provider.models.length > 0 && (
        <GraphRAGSettings provider={provider} />
      )}
      {provider.id === 'copilot' && <GithubCopilotSettings provider={provider} setApiKey={setApiKey} />}
      <SettingSubtitle style={{ marginBottom: 5 }}>
        <Flex align="center" justify="space-between" style={{ width: '100%' }}>
          <span>{t('common.models')}</span>
          <Space>
            {!isEmpty(models) && (
              <Button
                type="text"
                size="small"
                icon={<HeartOutlined />}
                onClick={onHealthCheck}
                loading={isHealthChecking}
                title={t('settings.models.check.button_caption')}></Button>
            )}
          </Space>
        </Flex>
      </SettingSubtitle>
      <ModelList provider={provider} modelStatuses={modelStatuses} />
    </SettingContainer>
  )
}

const ProviderName = styled.span`
  font-size: 14px;
  font-weight: 500;
`

export default ProviderSetting
