import { ColFlex, RowFlex, Switch } from '@cherrystudio/ui'
import { InfoTooltip } from '@cherrystudio/ui'
import { useProvider } from '@renderer/hooks/useProvider'
import { type AnthropicCacheControlSettings, type Provider } from '@renderer/types'
import { isLegacyCacheSettings } from '@renderer/types/provider'
import { isSupportAnthropicPromptCacheProvider } from '@renderer/utils/provider'
import { Divider, Select } from 'antd'
import { startTransition, useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

type Props = {
  providerId: string
}

type OptionType = {
  key: string
  label: string
  tip: string
  checked: boolean
  onChange: (checked: boolean) => void
}

const ApiOptionsSettings = ({ providerId }: Props) => {
  const { t } = useTranslation()
  const { provider, updateProvider } = useProvider(providerId)

  const updateProviderTransition = useCallback(
    (updates: Partial<Provider>) => {
      startTransition(() => {
        updateProvider(updates)
      })
    },
    [updateProvider]
  )

  const openAIOptions: OptionType[] = useMemo(
    () => [
      {
        key: 'openai_developer_role',
        label: t('settings.provider.api.options.developer_role.label'),
        tip: t('settings.provider.api.options.developer_role.help'),
        onChange: (checked: boolean) => {
          updateProviderTransition({
            apiOptions: { ...provider.apiOptions, isSupportDeveloperRole: checked }
          })
        },
        checked: !!provider.apiOptions?.isSupportDeveloperRole
      },
      {
        key: 'openai_stream_options',
        label: t('settings.provider.api.options.stream_options.label'),
        tip: t('settings.provider.api.options.stream_options.help'),
        onChange: (checked: boolean) => {
          updateProviderTransition({
            apiOptions: { ...provider.apiOptions, isNotSupportStreamOptions: !checked }
          })
        },
        checked: !provider.apiOptions?.isNotSupportStreamOptions
      },
      {
        key: 'openai_service_tier',
        label: t('settings.provider.api.options.service_tier.label'),
        tip: t('settings.provider.api.options.service_tier.help'),
        onChange: (checked: boolean) => {
          updateProviderTransition({
            apiOptions: { ...provider.apiOptions, isSupportServiceTier: checked }
          })
        },
        checked: !!provider.apiOptions?.isSupportServiceTier
      },
      {
        key: 'openai_enable_thinking',
        label: t('settings.provider.api.options.enable_thinking.label'),
        tip: t('settings.provider.api.options.enable_thinking.help'),
        onChange: (checked: boolean) => {
          updateProviderTransition({
            apiOptions: { ...provider.apiOptions, isNotSupportEnableThinking: !checked }
          })
        },
        checked: !provider.apiOptions?.isNotSupportEnableThinking
      },
      {
        key: 'openai_verbosity',
        label: t('settings.provider.api.options.verbosity.label'),
        tip: t('settings.provider.api.options.verbosity.help'),
        onChange: (checked: boolean) => {
          updateProviderTransition({
            apiOptions: { ...provider.apiOptions, isNotSupportVerbosity: !checked }
          })
        },
        checked: !provider.apiOptions?.isNotSupportVerbosity
      }
    ],
    [t, provider, updateProviderTransition]
  )

  const options = useMemo(() => {
    const items: OptionType[] = [
      {
        key: 'openai_array_content',
        label: t('settings.provider.api.options.array_content.label'),
        tip: t('settings.provider.api.options.array_content.help'),
        onChange: (checked: boolean) => {
          updateProviderTransition({
            apiOptions: { ...provider.apiOptions, isNotSupportArrayContent: !checked }
          })
        },
        checked: !provider.apiOptions?.isNotSupportArrayContent
      }
    ]

    if (provider.type === 'openai' || provider.type === 'openai-response' || provider.type === 'azure-openai') {
      items.push(...openAIOptions)
    }

    return items
  }, [openAIOptions, provider.apiOptions, provider.type, t, updateProviderTransition])

  const isSupportAnthropicPromptCache = isSupportAnthropicPromptCacheProvider(provider)

  const cacheSettings = useMemo<AnthropicCacheControlSettings>(() => {
    const raw = provider.anthropicCacheControl
    if (!raw) return { enabled: false, ttl: 'ephemeral' }
    if (isLegacyCacheSettings(raw)) {
      return { enabled: raw.tokenThreshold > 0, ttl: 'ephemeral' }
    }
    return raw
  }, [provider.anthropicCacheControl])

  const updateCacheSettings = useCallback(
    (updates: Partial<AnthropicCacheControlSettings>) => {
      updateProviderTransition({
        anthropicCacheControl: { ...cacheSettings, ...updates }
      })
    },
    [cacheSettings, updateProviderTransition]
  )

  return (
    <ColFlex className="gap-4">
      {options.map((item) => (
        <RowFlex key={item.key} className="justify-between">
          <RowFlex className="items-center gap-2">
            <label style={{ cursor: 'pointer' }} htmlFor={item.key}>
              {item.label}
            </label>
            <InfoTooltip title={item.tip} />
          </RowFlex>
          <Switch id={item.key} checked={item.checked} onCheckedChange={item.onChange} />
        </RowFlex>
      ))}

      {isSupportAnthropicPromptCache && (
        <>
          <Divider style={{ margin: '8px 0' }} />
          <RowFlex className="justify-between">
            <RowFlex className="items-center gap-2">
              <span>{t('settings.provider.api.options.anthropic_cache.prompt_caching')}</span>
              <InfoTooltip title={t('settings.provider.api.options.anthropic_cache.prompt_caching_help')} />
            </RowFlex>
            <Switch checked={cacheSettings.enabled} onCheckedChange={(v) => updateCacheSettings({ enabled: v })} />
          </RowFlex>
          {cacheSettings.enabled && (
            <RowFlex className="justify-between">
              <RowFlex className="items-center gap-2">
                <span>{t('settings.provider.api.options.anthropic_cache.ttl')}</span>
                <InfoTooltip title={t('settings.provider.api.options.anthropic_cache.ttl_help')} />
              </RowFlex>
              <Select
                value={cacheSettings.ttl || 'ephemeral'}
                onChange={(v) => updateCacheSettings({ ttl: v })}
                style={{ width: 120 }}
                options={[
                  {
                    value: 'ephemeral',
                    label: t('settings.provider.api.options.anthropic_cache.ttl_5min')
                  },
                  { value: '1h', label: t('settings.provider.api.options.anthropic_cache.ttl_1h') }
                ]}
              />
            </RowFlex>
          )}
        </>
      )}
    </ColFlex>
  )
}

export default ApiOptionsSettings
