import Selector from '@renderer/components/Selector'
import { isSupportFlexServiceTierModel } from '@renderer/config/models'
import { useProvider } from '@renderer/hooks/useProvider'
import { SettingDivider, SettingRow } from '@renderer/pages/settings'
import { CollapsibleSettingGroup } from '@renderer/pages/settings/SettingGroup'
import type { GroqServiceTier, Model, ServiceTier } from '@renderer/types'
import { GroqServiceTiers, OpenAIServiceTiers, SystemProviderIds } from '@renderer/types'
import { Tooltip } from 'antd'
import { CircleHelp } from 'lucide-react'
import type { FC } from 'react'
import { useCallback, useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

type ServiceTierOptions = { value: GroqServiceTier; label: string }

interface Props {
  model: Model
  SettingGroup: FC<{ children: React.ReactNode }>
  SettingRowTitleSmall: FC<{ children: React.ReactNode }>
}

const GroqSettingsGroup: FC<Props> = ({ model, SettingGroup, SettingRowTitleSmall }) => {
  const { t } = useTranslation()
  const { provider, updateProvider } = useProvider(SystemProviderIds.groq)
  const serviceTierMode = provider.serviceTier

  // I'm not sure if this function applies to Groq, but it should be fine to use
  const isSupportFlexServiceTier = isSupportFlexServiceTierModel(model)

  const setServiceTierMode = useCallback(
    (value: ServiceTier) => {
      updateProvider({ serviceTier: value })
    },
    [updateProvider]
  )

  const serviceTierOptions = useMemo(() => {
    const options = [
      {
        value: null,
        label: t('common.off')
      },
      {
        value: undefined,
        label: t('common.default')
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
    return options.filter((option) => {
      if (option.value === 'flex') {
        return isSupportFlexServiceTier
      }
      return true
    })
  }, [isSupportFlexServiceTier, t])

  useEffect(() => {
    if (serviceTierMode && !serviceTierOptions.some((option) => option.value === serviceTierMode)) {
      if (provider.id === SystemProviderIds.groq) {
        setServiceTierMode(GroqServiceTiers.on_demand)
      } else {
        setServiceTierMode(OpenAIServiceTiers.auto)
      }
    }
  }, [provider.id, serviceTierMode, serviceTierOptions, setServiceTierMode])

  return (
    <CollapsibleSettingGroup title={t('settings.groq.title')} defaultExpanded={true}>
      <SettingGroup>
        <SettingRow>
          <SettingRowTitleSmall>
            {t('settings.openai.service_tier.title')}{' '}
            <Tooltip title={t('settings.openai.service_tier.tip')}>
              <CircleHelp size={14} style={{ marginLeft: 4 }} color="var(--color-text-2)" />
            </Tooltip>
          </SettingRowTitleSmall>
          <Selector
            value={serviceTierMode}
            onChange={(value) => {
              setServiceTierMode(value)
            }}
            options={serviceTierOptions}
            placeholder={t('settings.openai.service_tier.auto')}
          />
        </SettingRow>
      </SettingGroup>
      <SettingDivider />
    </CollapsibleSettingGroup>
  )
}

export default GroqSettingsGroup
