import { HelpTooltip } from '@cherrystudio/ui'
import Selector from '@renderer/components/Selector'
import { useProvider } from '@renderer/hooks/useProvider'
import { SettingDivider, SettingRow } from '@renderer/pages/settings'
import { CollapsibleSettingGroup } from '@renderer/pages/settings/SettingGroup'
import type { GroqServiceTier, ServiceTier } from '@renderer/types'
import { SystemProviderIds } from '@renderer/types'
import { toOptionValue, toRealValue } from '@renderer/utils/select'
import type { FC } from 'react'
import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

type ServiceTierOptions = { value: NonNullable<GroqServiceTier> | 'undefined'; label: string }

interface Props {
  SettingGroup: FC<{ children: React.ReactNode }>
  SettingRowTitleSmall: FC<{ children: React.ReactNode }>
}

const GroqSettingsGroup: FC<Props> = ({ SettingGroup, SettingRowTitleSmall }) => {
  const { t } = useTranslation()
  const { provider, updateProvider } = useProvider(SystemProviderIds.groq)
  const serviceTierMode = provider.serviceTier

  const setServiceTierMode = useCallback(
    (value: ServiceTier) => {
      updateProvider({ serviceTier: value })
    },
    [updateProvider]
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
          <SettingRowTitleSmall>
            {t('settings.openai.service_tier.title')}{' '}
            <HelpTooltip content={t('settings.openai.service_tier.tip')} iconProps={{ className: 'ml-1' }} />
          </SettingRowTitleSmall>
          <Selector
            value={toOptionValue(serviceTierMode)}
            onChange={(value) => {
              setServiceTierMode(toRealValue(value))
            }}
            options={serviceTierOptions}
          />
        </SettingRow>
      </SettingGroup>
      <SettingDivider />
    </CollapsibleSettingGroup>
  )
}

export default GroqSettingsGroup
