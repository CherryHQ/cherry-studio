import type { FC } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { ReasoningEffort } from '@cherrystudio/provider-registry'
import { REASONING_EFFORT_ORDER } from '@cherrystudio/provider-registry'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import { loggerService } from '@logger'
import {
  SettingDescription,
  SettingGroup,
  SettingRow,
  SettingRowTitle,
  SettingsContentColumn,
  SettingTitle
} from '@renderer/components/SettingsPrimitives'
import { useProviders } from '@renderer/hooks/useProvider'
import { useTheme } from '@renderer/hooks/useTheme'
import { ipcApi } from '@renderer/ipc'
import {
  readReasoningEffortScopeMap,
  type ReasoningEffortMappingScope
} from '@shared/data/preference/reasoningEffortMapping'

const logger = loggerService.withContext('ReasoningEffortMappingSettings')

const MAPPING_TIERS = REASONING_EFFORT_ORDER.filter((effort) => effort !== 'auto' && effort !== 'none')

const AUTOMATIC_VALUE = '__automatic__'

const ReasoningEffortMappingSettings: FC = () => {
  const { t } = useTranslation()
  const { theme } = useTheme()
  const { providers } = useProviders()
  const [overrides] = usePreference('feature.reasoning.effort_mappings')
  const [scope, setScope] = useState<ReasoningEffortMappingScope>('global')
  const [providerId, setProviderId] = useState('')

  useEffect(() => {
    if (providerId || providers.length === 0) return
    setProviderId(providers[0].id)
  }, [providerId, providers])

  const selectedProviderId = providerId || providers[0]?.id
  const providerScopeReady = scope !== 'provider' || Boolean(selectedProviderId)

  const scopeMap = useMemo(
    () => readReasoningEffortScopeMap(overrides, scope, selectedProviderId),
    [overrides, scope, selectedProviderId]
  )

  const updateTier = useCallback(
    (source: ReasoningEffort, target: string) => {
      const mappedTarget = target === AUTOMATIC_VALUE ? null : (target as ReasoningEffort)
      // Entry-level write, applied atomically in the main process against its
      // authoritative cache: detached Settings windows editing different
      // entries merge instead of clobbering each other's whole-object
      // snapshots. This window's view refreshes from the preference broadcast.
      const request =
        scope === 'provider'
          ? selectedProviderId
            ? ipcApi.request('preference.set_reasoning_effort_mapping_entry', {
                scope,
                providerId: selectedProviderId,
                source,
                target: mappedTarget
              })
            : undefined
          : ipcApi.request('preference.set_reasoning_effort_mapping_entry', { scope, source, target: mappedTarget })
      request?.catch((error: unknown) => logger.error('Failed to update reasoning effort mapping:', error as Error))
    },
    [scope, selectedProviderId]
  )

  const effortLabel = (effort: ReasoningEffort) =>
    t(`assistants.settings.reasoning_effort.${effort === 'none' ? 'off' : effort}`)

  return (
    <SettingsContentColumn theme={theme}>
      <SettingGroup>
        <SettingTitle>{t('settings.reasoning_effort_mappings.title')}</SettingTitle>
        <SettingDescription>{t('settings.reasoning_effort_mappings.description')}</SettingDescription>

        <SettingRow className="items-center gap-4 py-2">
          <SettingRowTitle>{t('settings.reasoning_effort_mappings.scope.label')}</SettingRowTitle>
          <Select value={scope} onValueChange={(value) => setScope(value as ReasoningEffortMappingScope)}>
            <SelectTrigger className="w-[200px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="global">{t('settings.reasoning_effort_mappings.scope.global')}</SelectItem>
              <SelectItem value="provider">{t('settings.reasoning_effort_mappings.scope.provider')}</SelectItem>
            </SelectContent>
          </Select>
        </SettingRow>

        {scope === 'provider' ? (
          <SettingRow className="items-center gap-4 py-2">
            <SettingRowTitle>{t('settings.provider.title')}</SettingRowTitle>
            <Select value={selectedProviderId ?? ''} onValueChange={setProviderId} disabled={providers.length === 0}>
              <SelectTrigger className="w-[280px]">
                <SelectValue placeholder={t('settings.reasoning_effort_mappings.provider_placeholder')} />
              </SelectTrigger>
              <SelectContent>
                {providers.map((provider) => (
                  <SelectItem key={provider.id} value={provider.id}>
                    {provider.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </SettingRow>
        ) : null}

        <div className="mt-4 space-y-2">
          {MAPPING_TIERS.map((source) => {
            const current = scopeMap[source] ?? AUTOMATIC_VALUE
            return (
              <SettingRow key={source} className="items-center gap-4 py-1.5">
                <SettingRowTitle className="w-40 shrink-0">{effortLabel(source)}</SettingRowTitle>
                <Select
                  value={current}
                  disabled={!providerScopeReady}
                  onValueChange={(value) => updateTier(source, value)}>
                  <SelectTrigger className="w-[220px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={AUTOMATIC_VALUE}>{t('settings.reasoning_effort_mappings.automatic')}</SelectItem>
                    {MAPPING_TIERS.map((target) => (
                      <SelectItem key={target} value={target}>
                        {effortLabel(target)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </SettingRow>
            )
          })}
        </div>
      </SettingGroup>
    </SettingsContentColumn>
  )
}

export default ReasoningEffortMappingSettings
