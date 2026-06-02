import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@cherrystudio/ui'
import { SettingGroup, SettingRowTitleSmall } from '@renderer/components/chat/settings/settingsPanelPrimitives'
import { SettingDivider, SettingGroup as PageSettingGroup, SettingRow, SettingTitle } from '@renderer/pages/settings'
import { toOptionValue, toRealValue } from '@renderer/utils/select'
import type { GroqServiceTier, Provider, ProviderSettings, ServiceTier } from '@shared/data/types/provider'
import type { FC } from 'react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

type ServiceTierOptions = { value: NonNullable<GroqServiceTier> | 'undefined'; label: string }

interface Props {
  provider: Provider
  disabled?: boolean
  onProviderSettingsChange: (providerSettings: Partial<ProviderSettings>) => void
}

const GroqSettingsGroup: FC<Props> = ({ provider, disabled, onProviderSettingsChange }) => {
  const { t } = useTranslation()
  const serviceTierMode = provider.settings.serviceTier as ServiceTier

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
    <PageSettingGroup>
      <SettingTitle>{t('settings.groq.title')}</SettingTitle>
      <SettingDivider />
      <SettingGroup>
        <SettingRow>
          <SettingRowTitleSmall hint={t('settings.openai.service_tier.tip')}>
            {t('settings.openai.service_tier.title')}
          </SettingRowTitleSmall>
          <Select
            disabled={disabled}
            value={toOptionValue(serviceTierMode)}
            onValueChange={(value) => {
              onProviderSettingsChange({ serviceTier: toRealValue(value as ServiceTierOptions['value']) })
            }}>
            <SelectTrigger disabled={disabled} size="sm" className="w-[220px] text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="text-sm">
              {serviceTierOptions.map((option) => (
                <SelectItem className="text-sm" key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </SettingRow>
      </SettingGroup>
    </PageSettingGroup>
  )
}

export default GroqSettingsGroup
