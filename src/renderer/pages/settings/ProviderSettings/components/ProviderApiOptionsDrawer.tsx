import {
  Button,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  Tooltip
} from '@cherrystudio/ui'
import { useProvider } from '@renderer/hooks/useProvider'
import { cn } from '@renderer/utils'
import { toOptionValue, toRealValue } from '@renderer/utils/select'
import type {
  GroqServiceTier,
  OpenAIServiceTier,
  Provider,
  ProviderSettings,
  RuntimeApiFeatures,
  ServiceTier
} from '@shared/data/types/provider'
import type { OpenAIReasoningSummary, OpenAIVerbosity } from '@shared/types/aiSdk'
import { Info } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import ProviderActions from '../primitives/ProviderActions'
import ProviderSettingsDrawer from '../primitives/ProviderSettingsDrawer'
import { drawerClasses } from '../primitives/ProviderSettingsPrimitives'
import { getProviderApiOptionsVisibility } from '../utils/providerApiOptions'

interface ProviderApiOptionsDrawerProps {
  providerId: string
  open: boolean
  onClose: () => void
}

type ApiFeatureKey = keyof RuntimeApiFeatures

interface ApiOption {
  key: ApiFeatureKey
  label: string
  help: string
}

type OpenAIServiceTierOption = {
  value: NonNullable<OpenAIServiceTier> | 'null' | 'undefined'
  label: string
}
type GroqServiceTierOption = {
  value: NonNullable<GroqServiceTier> | 'undefined'
  label: string
}
type SummaryTextOption = {
  value: NonNullable<OpenAIReasoningSummary> | 'undefined' | 'null'
  label: string
}
type VerbosityOption = {
  value: NonNullable<OpenAIVerbosity> | 'undefined' | 'null'
  label: string
}
const CACHE_TOKEN_THRESHOLD_MAX = 100000
const CACHE_LAST_N_MAX = 10

function clampInteger(value: string, min: number, max: number): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) {
    return min
  }
  return Math.min(max, Math.max(min, Math.trunc(parsed)))
}

function apiOptionId(providerId: string, key: string): string {
  return `provider-api-option-${providerId}-${key}`
}

function OptionLabel({ id, label, help }: { id: string; label: string; help: string }) {
  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <label htmlFor={id} className="min-w-0 cursor-pointer truncate text-[13px] text-foreground/75 leading-[1.35]">
        {label}
      </label>
      <Tooltip content={help}>
        <span
          className="inline-flex size-4 shrink-0 items-center justify-center rounded-full text-muted-foreground/55"
          aria-label={help}>
          <Info className="size-3" aria-hidden />
        </span>
      </Tooltip>
    </div>
  )
}

interface SelectOptionRowProps {
  id: string
  label: string
  help: string
  value: string
  options: ReadonlyArray<{ value: string; label: string }>
  onValueChange: (value: string) => void
}

function SelectOptionRow({ id, label, help, value, options, onValueChange }: SelectOptionRowProps) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-4 rounded-xl border border-[color:var(--section-border)] bg-muted/40 px-3 py-2.5">
      <OptionLabel id={id} label={label} help={help} />
      <Select value={value} onValueChange={onValueChange}>
        <SelectTrigger id={id} size="sm" className="h-8 w-[160px] shrink-0 rounded-xl text-[13px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="text-[13px]">
          {options.map((option) => (
            <SelectItem className="text-[13px]" key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

export default function ProviderApiOptionsDrawer({ providerId, open, onClose }: ProviderApiOptionsDrawerProps) {
  const { t } = useTranslation()
  const { provider, updateProvider } = useProvider(providerId)

  const cacheControl = provider?.settings?.cacheControl
  const cacheTokenThreshold = cacheControl?.tokenThreshold ?? 0
  const cacheLastNMessages = cacheControl?.cacheLastNMessages ?? 0
  const [tokenThresholdDraft, setTokenThresholdDraft] = useState(String(cacheTokenThreshold))
  const [cacheLastNDraft, setCacheLastNDraft] = useState(String(cacheLastNMessages))
  const effectiveCacheTokenThreshold = clampInteger(tokenThresholdDraft, 0, CACHE_TOKEN_THRESHOLD_MAX)

  useEffect(() => {
    if (!open) {
      return
    }
    setTokenThresholdDraft(String(cacheTokenThreshold))
    setCacheLastNDraft(String(cacheLastNMessages))
  }, [cacheLastNMessages, cacheTokenThreshold, open])

  const openAIOptions = useMemo<ApiOption[]>(
    () => [
      {
        key: 'developerRole',
        label: t('settings.provider.api.options.developer_role.label'),
        help: t('settings.provider.api.options.developer_role.help')
      },
      {
        key: 'streamOptions',
        label: t('settings.provider.api.options.stream_options.label'),
        help: t('settings.provider.api.options.stream_options.help')
      },
      {
        key: 'serviceTier',
        label: t('settings.provider.api.options.service_tier.label'),
        help: t('settings.provider.api.options.service_tier.help')
      },
      {
        key: 'verbosity',
        label: t('settings.provider.api.options.verbosity.label'),
        help: t('settings.provider.api.options.verbosity.help')
      }
    ],
    [t]
  )

  const options = useMemo<ApiOption[]>(() => {
    if (!provider) {
      return []
    }

    const visibility = getProviderApiOptionsVisibility(provider)
    if (!visibility.showApiFeatureSettings) {
      return []
    }

    const items: ApiOption[] = [
      {
        key: 'arrayContent',
        label: t('settings.provider.api.options.array_content.label'),
        help: t('settings.provider.api.options.array_content.help')
      }
    ]

    if (visibility.isOpenAIProvider) {
      items.push(...openAIOptions)
    }

    return items
  }, [openAIOptions, provider, t])

  const openAIServiceTierOptions = useMemo(() => {
    return [
      {
        value: 'undefined',
        label: t('common.ignore')
      },
      {
        value: 'null',
        label: t('common.off')
      },
      {
        value: 'auto',
        label: t('settings.openai.service_tier.auto')
      },
      {
        value: 'default',
        label: t('settings.openai.service_tier.default')
      },
      {
        value: 'flex',
        label: t('settings.openai.service_tier.flex')
      },
      {
        value: 'priority',
        label: t('settings.openai.service_tier.priority')
      }
    ] as const satisfies OpenAIServiceTierOption[]
  }, [t])

  const groqServiceTierOptions = useMemo(() => {
    return [
      {
        value: 'undefined',
        label: t('common.ignore')
      },
      {
        value: 'auto',
        label: t('settings.openai.service_tier.auto')
      },
      {
        value: 'on_demand',
        label: t('settings.openai.service_tier.on_demand')
      },
      {
        value: 'flex',
        label: t('settings.openai.service_tier.flex')
      }
    ] as const satisfies GroqServiceTierOption[]
  }, [t])

  const summaryTextOptions = useMemo(() => {
    return [
      {
        value: 'undefined',
        label: t('common.ignore')
      },
      {
        value: 'null',
        label: t('common.off')
      },
      {
        value: 'auto',
        label: t('settings.openai.summary_text_mode.auto')
      },
      {
        value: 'detailed',
        label: t('settings.openai.summary_text_mode.detailed')
      },
      {
        value: 'concise',
        label: t('settings.openai.summary_text_mode.concise')
      }
    ] as const satisfies SummaryTextOption[]
  }, [t])

  const verbosityOptions = useMemo(() => {
    return [
      {
        value: 'undefined',
        label: t('common.ignore')
      },
      {
        value: 'null',
        label: t('common.off')
      },
      {
        value: 'low',
        label: t('settings.openai.verbosity.low')
      },
      {
        value: 'medium',
        label: t('settings.openai.verbosity.medium')
      },
      {
        value: 'high',
        label: t('settings.openai.verbosity.high')
      }
    ] as const satisfies VerbosityOption[]
  }, [t])

  const handleSaveError = useCallback(() => {
    window.toast.error(t('settings.provider.save_failed'))
  }, [t])

  const updateApiFeature = useCallback(
    (key: ApiFeatureKey, checked: boolean) => {
      if (!provider) {
        return
      }
      updateProvider({
        apiFeatures: {
          ...provider.apiFeatures,
          [key]: checked
        }
      }).catch(handleSaveError)
    },
    [handleSaveError, provider, updateProvider]
  )

  const updateProviderSettings = useCallback(
    (updates: Partial<ProviderSettings>) => {
      if (!provider) {
        return
      }

      updateProvider({
        providerSettings: {
          ...provider.settings,
          ...updates
        }
      }).catch(handleSaveError)
    },
    [handleSaveError, provider, updateProvider]
  )

  const updateCacheSettings = useCallback(
    (updates: NonNullable<Provider['settings']['cacheControl']>) => {
      if (!provider) {
        return
      }

      const next = {
        tokenThreshold: 0,
        cacheSystemMessage: true,
        cacheLastNMessages: 0,
        ...provider.settings.cacheControl,
        ...updates
      }

      updateProvider({
        providerSettings: {
          ...provider.settings,
          cacheControl: {
            ...next,
            enabled: (next.tokenThreshold ?? 0) > 0
          }
        }
      }).catch(handleSaveError)
    },
    [handleSaveError, provider, updateProvider]
  )

  const commitTokenThreshold = useCallback(() => {
    const next = clampInteger(tokenThresholdDraft, 0, CACHE_TOKEN_THRESHOLD_MAX)
    setTokenThresholdDraft(String(next))
    updateCacheSettings({
      enabled: next > 0,
      tokenThreshold: next
    })
  }, [tokenThresholdDraft, updateCacheSettings])

  const commitCacheLastNMessages = useCallback(() => {
    const next = clampInteger(cacheLastNDraft, 0, CACHE_LAST_N_MAX)
    setCacheLastNDraft(String(next))
    updateCacheSettings({
      enabled: effectiveCacheTokenThreshold > 0,
      tokenThreshold: effectiveCacheTokenThreshold,
      cacheLastNMessages: next
    })
  }, [cacheLastNDraft, effectiveCacheTokenThreshold, updateCacheSettings])

  const footer = (
    <ProviderActions className={drawerClasses.footer}>
      <Button type="button" variant="outline" onClick={onClose}>
        {t('common.close')}
      </Button>
    </ProviderActions>
  )

  if (!provider) {
    return <ProviderSettingsDrawer open={open} onClose={onClose} title={t('settings.provider.api.options.label')} />
  }

  const {
    isSupportAnthropicPromptCache,
    showOpenAIServiceTierSetting,
    showGroqServiceTierSetting,
    showSummaryTextSetting,
    showVerbositySetting,
    showOpenAISettings,
    showProviderValueSettings
  } = getProviderApiOptionsVisibility(provider)
  const showCacheDetailOptions = effectiveCacheTokenThreshold > 0
  const cacheSystemMessage = cacheControl?.cacheSystemMessage ?? true
  const showApiFeatureSettings = options.length > 0

  return (
    <ProviderSettingsDrawer
      open={open}
      onClose={onClose}
      title={t('settings.provider.api.options.label')}
      footer={footer}>
      <div className="flex min-w-0 flex-col gap-5 py-1">
        {showApiFeatureSettings ? (
          <div className="space-y-3">
            {options.map((item) => {
              const id = apiOptionId(providerId, item.key)
              return (
                <div
                  key={item.key}
                  className="flex min-w-0 items-center justify-between gap-4 rounded-xl border border-[color:var(--section-border)] bg-muted/40 px-3 py-2.5">
                  <OptionLabel id={id} label={item.label} help={item.help} />
                  <Switch
                    id={id}
                    checked={provider.apiFeatures[item.key]}
                    onCheckedChange={(checked) => updateApiFeature(item.key, checked)}
                  />
                </div>
              )
            })}
          </div>
        ) : null}

        {showProviderValueSettings ? (
          <>
            {showApiFeatureSettings ? <div className={drawerClasses.divider} /> : null}
            <div className="space-y-3">
              {showOpenAISettings ? (
                <>
                  <div className="px-1 font-medium text-[12px] text-muted-foreground/80 leading-[1.35]">
                    {t('settings.openai.title')}
                  </div>
                  {showOpenAIServiceTierSetting ? (
                    <SelectOptionRow
                      id={apiOptionId(providerId, 'openai-service-tier')}
                      label={t('settings.openai.service_tier.title')}
                      help={t('settings.openai.service_tier.tip')}
                      value={toOptionValue(provider.settings.serviceTier as ServiceTier)}
                      options={openAIServiceTierOptions}
                      onValueChange={(value) =>
                        updateProviderSettings({
                          serviceTier: toRealValue(value as OpenAIServiceTierOption['value'])
                        })
                      }
                    />
                  ) : null}
                  {showSummaryTextSetting ? (
                    <SelectOptionRow
                      id={apiOptionId(providerId, 'openai-summary-text')}
                      label={t('settings.openai.summary_text_mode.title')}
                      help={t('settings.openai.summary_text_mode.tip')}
                      value={toOptionValue(provider.settings.summaryText)}
                      options={summaryTextOptions}
                      onValueChange={(value) =>
                        updateProviderSettings({
                          summaryText: toRealValue(value as SummaryTextOption['value'])
                        })
                      }
                    />
                  ) : null}
                  {showVerbositySetting ? (
                    <SelectOptionRow
                      id={apiOptionId(providerId, 'openai-verbosity')}
                      label={t('settings.openai.verbosity.title')}
                      help={t('settings.openai.verbosity.tip')}
                      value={toOptionValue(provider.settings.verbosity as OpenAIVerbosity)}
                      options={verbosityOptions}
                      onValueChange={(value) =>
                        updateProviderSettings({
                          verbosity: toRealValue(value as VerbosityOption['value'])
                        })
                      }
                    />
                  ) : null}
                </>
              ) : null}
              {showGroqServiceTierSetting ? (
                <>
                  <div className="px-1 font-medium text-[12px] text-muted-foreground/80 leading-[1.35]">
                    {t('settings.groq.title')}
                  </div>
                  <SelectOptionRow
                    id={apiOptionId(providerId, 'groq-service-tier')}
                    label={t('settings.openai.service_tier.title')}
                    help={t('settings.openai.service_tier.tip')}
                    value={toOptionValue(provider.settings.serviceTier as ServiceTier)}
                    options={groqServiceTierOptions}
                    onValueChange={(value) =>
                      updateProviderSettings({
                        serviceTier: toRealValue(value as GroqServiceTierOption['value'])
                      })
                    }
                  />
                </>
              ) : null}
            </div>
          </>
        ) : null}

        {isSupportAnthropicPromptCache ? (
          <>
            {showApiFeatureSettings || showProviderValueSettings ? <div className={drawerClasses.divider} /> : null}
            <div className="space-y-3">
              <div className="flex min-w-0 items-center justify-between gap-4 rounded-xl border border-[color:var(--section-border)] bg-muted/40 px-3 py-2.5">
                <OptionLabel
                  id={apiOptionId(providerId, 'cache-token-threshold')}
                  label={t('settings.provider.api.options.anthropic_cache.token_threshold')}
                  help={t('settings.provider.api.options.anthropic_cache.token_threshold_help')}
                />
                <Input
                  id={apiOptionId(providerId, 'cache-token-threshold')}
                  type="number"
                  min={0}
                  max={CACHE_TOKEN_THRESHOLD_MAX}
                  value={tokenThresholdDraft}
                  onChange={(event) => setTokenThresholdDraft(event.target.value)}
                  onBlur={commitTokenThreshold}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.currentTarget.blur()
                    }
                  }}
                  className={cn(drawerClasses.input, 'h-9 w-28 shrink-0 rounded-xl px-3 py-1.5 text-right')}
                />
              </div>

              {showCacheDetailOptions ? (
                <>
                  <div className="flex min-w-0 items-center justify-between gap-4 rounded-xl border border-[color:var(--section-border)] bg-muted/40 px-3 py-2.5">
                    <OptionLabel
                      id={apiOptionId(providerId, 'cache-system-message')}
                      label={t('settings.provider.api.options.anthropic_cache.cache_system')}
                      help={t('settings.provider.api.options.anthropic_cache.cache_system_help')}
                    />
                    <Switch
                      id={apiOptionId(providerId, 'cache-system-message')}
                      checked={cacheSystemMessage}
                      onCheckedChange={(checked) =>
                        updateCacheSettings({
                          enabled: effectiveCacheTokenThreshold > 0,
                          tokenThreshold: effectiveCacheTokenThreshold,
                          cacheSystemMessage: checked
                        })
                      }
                    />
                  </div>

                  <div className="flex min-w-0 items-center justify-between gap-4 rounded-xl border border-[color:var(--section-border)] bg-muted/40 px-3 py-2.5">
                    <OptionLabel
                      id={apiOptionId(providerId, 'cache-last-n')}
                      label={t('settings.provider.api.options.anthropic_cache.cache_last_n')}
                      help={t('settings.provider.api.options.anthropic_cache.cache_last_n_help')}
                    />
                    <Input
                      id={apiOptionId(providerId, 'cache-last-n')}
                      type="number"
                      min={0}
                      max={CACHE_LAST_N_MAX}
                      value={cacheLastNDraft}
                      onChange={(event) => setCacheLastNDraft(event.target.value)}
                      onBlur={commitCacheLastNMessages}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.currentTarget.blur()
                        }
                      }}
                      className={cn(drawerClasses.input, 'h-9 w-20 shrink-0 rounded-xl px-3 py-1.5 text-right')}
                    />
                  </div>
                </>
              ) : null}
            </div>
          </>
        ) : null}
      </div>
    </ProviderSettingsDrawer>
  )
}
