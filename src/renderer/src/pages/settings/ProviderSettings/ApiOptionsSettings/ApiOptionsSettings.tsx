import { ColFlex, RowFlex, Switch } from '@cherrystudio/ui'
import { InfoTooltip } from '@cherrystudio/ui'
import { useProvider } from '@renderer/hooks/useProviders'
import { isAnthropicProvider, isAzureOpenAIProvider, isOpenAICompatibleProvider } from '@renderer/utils/provider.v2'
import { Divider, InputNumber } from 'antd'
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

  const patchProvider = useCallback(
    (updates: Record<string, unknown>) => {
      startTransition(() => {
        void updateProvider(updates)
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
          patchProvider({ apiFeatures: { ...provider?.apiFeatures, developerRole: checked } })
        },
        checked: provider?.apiFeatures.developerRole ?? false
      },
      {
        key: 'openai_stream_options',
        label: t('settings.provider.api.options.stream_options.label'),
        tip: t('settings.provider.api.options.stream_options.help'),
        onChange: (checked: boolean) => {
          patchProvider({ apiFeatures: { ...provider?.apiFeatures, streamOptions: checked } })
        },
        checked: provider?.apiFeatures.streamOptions ?? true
      },
      {
        key: 'openai_service_tier',
        label: t('settings.provider.api.options.service_tier.label'),
        tip: t('settings.provider.api.options.service_tier.help'),
        onChange: (checked: boolean) => {
          patchProvider({ apiFeatures: { ...provider?.apiFeatures, serviceTier: checked } })
        },
        checked: provider?.apiFeatures.serviceTier ?? false
      },
      {
        key: 'openai_enable_thinking',
        label: t('settings.provider.api.options.enable_thinking.label'),
        tip: t('settings.provider.api.options.enable_thinking.help'),
        onChange: (checked: boolean) => {
          patchProvider({ apiFeatures: { ...provider?.apiFeatures, enableThinking: checked } })
        },
        checked: provider?.apiFeatures.enableThinking ?? true
      },
      {
        key: 'openai_verbosity',
        label: t('settings.provider.api.options.verbosity.label'),
        tip: t('settings.provider.api.options.verbosity.help'),
        onChange: (checked: boolean) => {
          patchProvider({ apiFeatures: { ...provider?.apiFeatures, verbosity: checked } })
        },
        checked: provider?.apiFeatures.verbosity ?? false
      }
    ],
    [t, provider, patchProvider]
  )

  const options = useMemo(() => {
    const items: OptionType[] = [
      {
        key: 'openai_array_content',
        label: t('settings.provider.api.options.array_content.label'),
        tip: t('settings.provider.api.options.array_content.help'),
        onChange: (checked: boolean) => {
          patchProvider({ apiFeatures: { ...provider?.apiFeatures, arrayContent: checked } })
        },
        checked: provider?.apiFeatures.arrayContent ?? true
      }
    ]

    if (provider && (isOpenAICompatibleProvider(provider) || isAzureOpenAIProvider(provider))) {
      items.push(...openAIOptions)
    }

    return items
  }, [openAIOptions, provider, t, patchProvider])

  const isSupportAnthropicPromptCache = provider ? isAnthropicProvider(provider) : false

  const cacheSettings = useMemo(
    () =>
      provider?.settings?.cacheControl ?? {
        enabled: false,
        tokenThreshold: 0,
        cacheSystemMessage: true,
        cacheLastNMessages: 0
      },
    [provider?.settings?.cacheControl]
  )

  const updateCacheSettings = useCallback(
    (updates: Partial<typeof cacheSettings>) => {
      patchProvider({
        providerSettings: {
          ...provider?.settings,
          cacheControl: { ...cacheSettings, enabled: true, ...updates }
        }
      })
    },
    [cacheSettings, provider?.settings, patchProvider]
  )

  return (
    <ColFlex className="gap-4">
      {options.map((item) => (
        <RowFlex key={item.key} className="justify-between">
          <RowFlex className="items-center gap-2">
            <label style={{ cursor: 'pointer' }} htmlFor={item.key}>
              {item.label}
            </label>
            <InfoTooltip content={item.tip}></InfoTooltip>
          </RowFlex>
          <Switch id={item.key} checked={item.checked} onCheckedChange={item.onChange} />
        </RowFlex>
      ))}

      {isSupportAnthropicPromptCache && (
        <>
          <Divider style={{ margin: '8px 0' }} />
          <RowFlex className="justify-between">
            <RowFlex className="items-center gap-2">
              <span>{t('settings.provider.api.options.anthropic_cache.token_threshold')}</span>
              <InfoTooltip title={t('settings.provider.api.options.anthropic_cache.token_threshold_help')} />
            </RowFlex>
            <InputNumber
              min={0}
              max={100000}
              value={cacheSettings.tokenThreshold}
              onChange={(v) => updateCacheSettings({ tokenThreshold: v ?? 0 })}
              style={{ width: 100 }}
            />
          </RowFlex>
          {(cacheSettings.tokenThreshold ?? 0) > 0 && (
            <>
              <RowFlex className="justify-between">
                <RowFlex className="items-center gap-2">
                  <span>{t('settings.provider.api.options.anthropic_cache.cache_system')}</span>
                  <InfoTooltip title={t('settings.provider.api.options.anthropic_cache.cache_system_help')} />
                </RowFlex>
                <Switch
                  checked={cacheSettings.cacheSystemMessage}
                  onCheckedChange={(v) => updateCacheSettings({ cacheSystemMessage: v })}
                />
              </RowFlex>
              <RowFlex className="justify-between">
                <RowFlex className="items-center gap-2">
                  <span>{t('settings.provider.api.options.anthropic_cache.cache_last_n')}</span>
                  <InfoTooltip title={t('settings.provider.api.options.anthropic_cache.cache_last_n_help')} />
                </RowFlex>
                <InputNumber
                  min={0}
                  max={10}
                  value={cacheSettings.cacheLastNMessages}
                  onChange={(v) => updateCacheSettings({ cacheLastNMessages: v ?? 0 })}
                  style={{ width: 100 }}
                />
              </RowFlex>
            </>
          )}
        </>
      )}
    </ColFlex>
  )
}

export default ApiOptionsSettings
