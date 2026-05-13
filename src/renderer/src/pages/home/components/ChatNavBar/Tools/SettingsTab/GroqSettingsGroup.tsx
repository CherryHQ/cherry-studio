import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@cherrystudio/ui'
import { SettingRow } from '@renderer/pages/settings'
import { CollapsibleSettingGroup } from '@renderer/pages/settings/SettingGroup'
import { toOptionValue, toRealValue } from '@renderer/utils/select'
import type { GroqServiceTier, Provider, ProviderSettings, ServiceTier } from '@shared/data/types/provider'
import type { FC } from 'react'
import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

type ServiceTierOptions = { value: NonNullable<GroqServiceTier> | 'undefined'; label: string }

interface Props {
  provider: Provider
  disabled?: boolean
  onProviderSettingsChange: (providerSettings: Partial<ProviderSettings>) => void
  SettingGroup: FC<{ children: React.ReactNode }>
  SettingRowTitleSmall: FC<{ children: React.ReactNode; hint?: string }>
}

const GroqSettingsGroup: FC<Props> = ({
  provider,
  disabled,
  onProviderSettingsChange,
  SettingGroup,
  SettingRowTitleSmall
}) => {
  const { t } = useTranslation()
  const serviceTierMode = provider.settings.serviceTier as ServiceTier

  const setServiceTierMode = useCallback(
    (value: ServiceTier) => {
      onProviderSettingsChange({ serviceTier: value })
    },
    [onProviderSettingsChange]
  )

  const serviceTierOptions = useMemo(() => {
    const options = [
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
    ] as const satisfies ServiceTierOptions[]
    return options
  }, [t])

  return (
    <CollapsibleSettingGroup title={t('settings.groq.title')} defaultExpanded={true}>
      <SettingGroup>
        <SettingRow>
          <SettingRowTitleSmall hint={t('settings.openai.service_tier.tip')}>
            {t('settings.openai.service_tier.title')}
          </SettingRowTitleSmall>
          <Select
            disabled={disabled}
            value={toOptionValue(serviceTierMode)}
            onValueChange={(value) => {
              setServiceTierMode(toRealValue(value as ServiceTierOptions['value']))
            }}>
            <SelectTrigger disabled={disabled} size="sm" className="w-45 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="text-xs">
              {serviceTierOptions.map((option) => (
                <SelectItem className="text-xs" key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </SettingRow>
      </SettingGroup>
    </CollapsibleSettingGroup>
  )
}

export default GroqSettingsGroup
