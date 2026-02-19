import Selector from '@renderer/components/Selector'
import { isSupportFlexServiceTierModel } from '@renderer/config/models'
import { useProvider } from '@renderer/hooks/useProvider'
import { SettingRow } from '@renderer/pages/settings'
import type { Model, OpenAIServiceTier, ServiceTier } from '@renderer/types'
import { toOptionValue, toRealValue } from '@renderer/utils/select'
import { Tooltip } from 'antd'
import { CircleHelp } from 'lucide-react'
import type { FC } from 'react'
import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

type OpenAIServiceTierOption = { value: NonNullable<OpenAIServiceTier> | 'null' | 'undefined'; label: string }

interface Props {
  model: Model
  providerId: string
  SettingRowTitleSmall: FC<{ children: React.ReactNode }>
}

const ServiceTierSetting: FC<Props> = ({ model, providerId, SettingRowTitleSmall }) => {
  const { t } = useTranslation()
  const { provider, updateProvider } = useProvider(providerId)
  const serviceTierMode = provider.serviceTier
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
    return options.filter((option) => {
      if (option.value === 'flex') {
        return isSupportFlexServiceTier
      }
      return true
    })
  }, [isSupportFlexServiceTier, t])

  return (
    <SettingRow>
      <SettingRowTitleSmall>
        {t('settings.openai.service_tier.title')}{' '}
        <Tooltip title={t('settings.openai.service_tier.tip')}>
          <CircleHelp size={14} style={{ marginLeft: 4 }} color="var(--color-text-2)" />
        </Tooltip>
      </SettingRowTitleSmall>
      <Selector
        value={toOptionValue(serviceTierMode)}
        onChange={(value) => {
          setServiceTierMode(toRealValue(value))
        }}
        options={serviceTierOptions}
      />
    </SettingRow>
  )
}

export default ServiceTierSetting
