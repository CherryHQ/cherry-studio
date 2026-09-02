import {
  Input,
  PageSidePanelItem,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  Tooltip
} from '@cherrystudio/ui'
import { useProvider } from '@renderer/hooks/useProvider'
import { toast } from '@renderer/services/toast'
import { cn } from '@renderer/utils/style'
import {
  ANTHROPIC_CACHE_DEFAULT_LAST_N_MESSAGES,
  ANTHROPIC_CACHE_DEFAULT_TOKEN_THRESHOLD,
  ANTHROPIC_CACHE_DEFAULT_TTL
} from '@shared/ai/anthropicCache'
import { ENDPOINT_TYPE } from '@shared/data/types/model'
import {
  ANTHROPIC_CACHE_TTL_OPTIONS,
  type AnthropicCacheTtl,
  type EndpointDialect,
  type Provider
} from '@shared/data/types/provider'
import { isAnthropicSupportedProvider, resolveEndpointDialect } from '@shared/utils/provider'
import { Info } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import ProviderSettingsDrawer from '../primitives/ProviderSettingsDrawer'
import { drawerClasses } from '../primitives/ProviderSettingsPrimitives'
import { getProviderApiOptionsVisibility } from '../utils/providerApiOptions'

interface ProviderApiOptionsDrawerProps {
  providerId: string
  open: boolean
  onClose: () => void
}

type DialectKey = keyof EndpointDialect

interface ApiOption {
  key: DialectKey
  label: string
  help: string
}

const CACHE_TOKEN_THRESHOLD_MAX = 100000
const CACHE_LAST_N_MAX = 10
const CACHE_TTL_LABELS = {
  '5m': 'settings.provider.api.options.anthropic_cache.cache_ttl_5m',
  '1h': 'settings.provider.api.options.anthropic_cache.cache_ttl_1h'
} as const satisfies Record<AnthropicCacheTtl, string>

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

function OptionTitle({ id, label, help }: { id: string; label: string; help: string }) {
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <label htmlFor={id} className="min-w-0 cursor-pointer truncate">
        {label}
      </label>
      <Tooltip content={help}>
        <span
          className="inline-flex size-4 shrink-0 items-center justify-center rounded-full text-foreground-tertiary"
          aria-label={help}>
          <Info className="size-3" aria-hidden />
        </span>
      </Tooltip>
    </span>
  )
}

export default function ProviderApiOptionsDrawer({ providerId, open, onClose }: ProviderApiOptionsDrawerProps) {
  const { t } = useTranslation()
  const { provider, updateProvider } = useProvider(providerId)

  const endpointType = provider?.defaultChatEndpoint ?? undefined
  const dialect = provider
    ? resolveEndpointDialect(provider, endpointType)
    : { streamOptions: true, developerRole: false, reasoningSummary: false }

  const cacheControl = provider?.settings?.cacheControl
  const cacheTokenThreshold =
    cacheControl?.enabled === false ? 0 : (cacheControl?.tokenThreshold ?? ANTHROPIC_CACHE_DEFAULT_TOKEN_THRESHOLD)
  const cacheLastNMessages = cacheControl?.cacheLastNMessages ?? ANTHROPIC_CACHE_DEFAULT_LAST_N_MESSAGES
  const cacheTtl = cacheControl?.ttl ?? ANTHROPIC_CACHE_DEFAULT_TTL
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
        key: 'reasoningSummary',
        label: t('settings.provider.api.options.reasoning_summary.label'),
        help: t('settings.provider.api.options.reasoning_summary.help')
      }
    ],
    [t]
  )

  const options = useMemo<ApiOption[]>(() => {
    if (!provider) {
      return []
    }

    const visibility = getProviderApiOptionsVisibility(provider)
    if (!visibility.showDialectSettings) {
      return []
    }

    if (!visibility.isOpenAIProvider || endpointType === undefined) {
      return []
    }

    if (endpointType === ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS) {
      return openAIOptions.filter(({ key }) => key !== 'reasoningSummary')
    }
    if (endpointType === ENDPOINT_TYPE.OPENAI_RESPONSES) {
      return openAIOptions.filter(({ key }) => key !== 'streamOptions')
    }
    return openAIOptions.filter(({ key }) => key === 'developerRole')
  }, [endpointType, openAIOptions, provider])

  const handleSaveError = useCallback(() => {
    toast.error(t('settings.provider.save_failed'))
  }, [t])

  const updateDialect = useCallback(
    (key: DialectKey, checked: boolean) => {
      if (!provider || !endpointType) {
        return
      }
      const endpointConfig = provider.endpointConfigs?.[endpointType] ?? {}
      updateProvider({
        endpointConfigs: {
          ...provider.endpointConfigs,
          [endpointType]: {
            ...endpointConfig,
            dialect: { ...endpointConfig.dialect, [key]: checked }
          }
        }
      }).catch(handleSaveError)
    },
    [endpointType, handleSaveError, provider, updateProvider]
  )

  const updateCacheSettings = useCallback(
    (updates: NonNullable<Provider['settings']['cacheControl']>) => {
      if (!provider) {
        return
      }

      const next = {
        tokenThreshold: ANTHROPIC_CACHE_DEFAULT_TOKEN_THRESHOLD,
        cacheSystemMessage: true,
        cacheLastNMessages: ANTHROPIC_CACHE_DEFAULT_LAST_N_MESSAGES,
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

  if (!provider) {
    return <ProviderSettingsDrawer open={open} onClose={onClose} title={t('settings.provider.api.options.label')} />
  }

  const isSupportAnthropicPromptCache = isAnthropicSupportedProvider(provider)
  const showCacheDetailOptions = effectiveCacheTokenThreshold > 0
  const cacheSystemMessage = cacheControl?.cacheSystemMessage ?? true

  return (
    <ProviderSettingsDrawer
      open={open}
      onClose={onClose}
      title={t('settings.provider.api.options.label')}
      headerClassName="px-6 pt-4 pb-2"
      bodyClassName="space-y-0 px-6 pt-1 pb-6">
      <div className="flex min-w-0 flex-col gap-4">
        {options.length > 0 ? (
          <div className="flex flex-col gap-4">
            {options.map((item) => {
              const id = apiOptionId(providerId, item.key)
              return (
                <PageSidePanelItem
                  key={item.key}
                  title={<OptionTitle id={id} label={item.label} help={item.help} />}
                  action={
                    <Switch
                      id={id}
                      checked={dialect[item.key]}
                      onCheckedChange={(checked) => updateDialect(item.key, checked)}
                    />
                  }
                />
              )
            })}
          </div>
        ) : null}

        {isSupportAnthropicPromptCache ? (
          <>
            {options.length > 0 ? <div className={drawerClasses.divider} /> : null}
            <div className="flex flex-col gap-4">
              <PageSidePanelItem
                title={
                  <OptionTitle
                    id={apiOptionId(providerId, 'cache-token-threshold')}
                    label={t('settings.provider.api.options.anthropic_cache.token_threshold')}
                    help={t('settings.provider.api.options.anthropic_cache.token_threshold_help')}
                  />
                }
                action={
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
                    className={cn(drawerClasses.input, 'h-9 w-24 shrink-0 text-center')}
                  />
                }
              />

              {showCacheDetailOptions ? (
                <>
                  <PageSidePanelItem
                    title={
                      <OptionTitle
                        id={apiOptionId(providerId, 'cache-ttl')}
                        label={t('settings.provider.api.options.anthropic_cache.cache_ttl')}
                        help={t('settings.provider.api.options.anthropic_cache.cache_ttl_help')}
                      />
                    }
                    action={
                      <Select
                        value={cacheTtl}
                        onValueChange={(ttl) =>
                          updateCacheSettings({
                            enabled: effectiveCacheTokenThreshold > 0,
                            tokenThreshold: effectiveCacheTokenThreshold,
                            ttl: ttl as AnthropicCacheTtl
                          })
                        }>
                        <SelectTrigger
                          id={apiOptionId(providerId, 'cache-ttl')}
                          className={cn(drawerClasses.selectTrigger, 'h-9 w-32 shrink-0 py-1')}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent align="end" className={drawerClasses.selectContent}>
                          {ANTHROPIC_CACHE_TTL_OPTIONS.map((ttl) => (
                            <SelectItem key={ttl} value={ttl}>
                              {t(CACHE_TTL_LABELS[ttl])}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    }
                  />

                  <PageSidePanelItem
                    title={
                      <OptionTitle
                        id={apiOptionId(providerId, 'cache-last-n')}
                        label={t('settings.provider.api.options.anthropic_cache.cache_last_n')}
                        help={t('settings.provider.api.options.anthropic_cache.cache_last_n_help')}
                      />
                    }
                    action={
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
                        className={cn(drawerClasses.input, 'h-9 w-24 shrink-0 text-center')}
                      />
                    }
                  />

                  <PageSidePanelItem
                    title={
                      <OptionTitle
                        id={apiOptionId(providerId, 'cache-system-message')}
                        label={t('settings.provider.api.options.anthropic_cache.cache_system')}
                        help={t('settings.provider.api.options.anthropic_cache.cache_system_help')}
                      />
                    }
                    action={
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
                    }
                  />
                </>
              ) : null}
            </div>
          </>
        ) : null}
      </div>
    </ProviderSettingsDrawer>
  )
}
