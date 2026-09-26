import type { FC } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { ReasoningEffort } from '@cherrystudio/provider-registry'
import { REASONING_EFFORT_ORDER } from '@cherrystudio/provider-registry'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
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
import type { ReasoningEffortMappingOverrides, UserReasoningEffortMap } from '@shared/data/preference/preferenceTypes'

const MAPPING_TIERS = REASONING_EFFORT_ORDER.filter((effort) => effort !== 'auto')

type MappingScope = 'global' | 'provider'

const AUTOMATIC_VALUE = '__automatic__'

function readScopeMap(overrides: ReasoningEffortMappingOverrides, scope: MappingScope, providerId?: string) {
  if (scope === 'global') return overrides.global ?? {}
  if (!providerId) return {}
  return overrides.providers?.[providerId]?.default ?? {}
}

function writeScopeMap(
  overrides: ReasoningEffortMappingOverrides,
  scope: MappingScope,
  providerId: string | undefined,
  map: UserReasoningEffortMap
): ReasoningEffortMappingOverrides {
  const cleaned = Object.fromEntries(
    Object.entries(map).filter(([, target]) => target !== undefined)
  ) as UserReasoningEffortMap

  if (scope === 'global') {
    return { ...overrides, global: Object.keys(cleaned).length > 0 ? cleaned : undefined }
  }
  if (!providerId) return overrides

  const providerScope = overrides.providers?.[providerId] ?? {}
  const nextProviderScope = {
    ...providerScope,
    default: Object.keys(cleaned).length > 0 ? cleaned : undefined
  }
  const providers = { ...(overrides.providers ?? {}), [providerId]: nextProviderScope }
  return { ...overrides, providers }
}

const ReasoningEffortMappingSettings: FC = () => {
  const { t } = useTranslation()
  const { theme } = useTheme()
  const { providers } = useProviders()
  const [overrides, setOverrides] = usePreference('feature.reasoning.effort_mappings')
  const [scope, setScope] = useState<MappingScope>('global')
  const [providerId, setProviderId] = useState('')

  useEffect(() => {
    if (providerId || providers.length === 0) return
    setProviderId(providers[0].id)
  }, [providerId, providers])

  const selectedProviderId = providerId || providers[0]?.id
  const providerScopeReady = scope !== 'provider' || Boolean(selectedProviderId)

  const scopeMap = useMemo(
    () => readScopeMap(overrides, scope, selectedProviderId),
    [overrides, scope, selectedProviderId]
  )

  const updateTier = useCallback(
    (source: ReasoningEffort, target: string) => {
      if (scope === 'provider' && !selectedProviderId) return

      const nextMap = { ...scopeMap }
      if (target === AUTOMATIC_VALUE) {
        delete nextMap[source]
      } else {
        nextMap[source] = target as ReasoningEffort
      }
      void setOverrides(writeScopeMap(overrides, scope, selectedProviderId, nextMap))
    },
    [overrides, scope, scopeMap, selectedProviderId, setOverrides]
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
          <Select value={scope} onValueChange={(value) => setScope(value as MappingScope)}>
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
