import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@cherrystudio/ui'
import { isSupportFlexServiceTierModel } from '@renderer/config/models'
import { SettingRowTitleSmall } from '@renderer/pages/chat-settings/settingsPanelPrimitives'
import { SettingRow } from '@renderer/pages/settings'
import type { Model } from '@renderer/types'
import { toOptionValue, toRealValue } from '@renderer/utils/select'
import type { OpenAIServiceTier, ServiceTier } from '@shared/data/types/provider'
import type { FC } from 'react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

type OpenAIServiceTierOption = { value: NonNullable<OpenAIServiceTier> | 'null' | 'undefined'; label: string }

interface Props {
  model: Model
  serviceTierMode: ServiceTier
  disabled?: boolean
  onServiceTierChange: (value: ServiceTier) => void
}

const ServiceTierSetting: FC<Props> = ({ model, serviceTierMode, disabled, onServiceTierChange }) => {
  const { t } = useTranslation()
  const isSupportFlexServiceTier = isSupportFlexServiceTierModel(model)

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
      <SettingRowTitleSmall hint={t('settings.openai.service_tier.tip')}>
        {t('settings.openai.service_tier.title')}
      </SettingRowTitleSmall>
      <Select
        disabled={disabled}
        value={toOptionValue(serviceTierMode)}
        onValueChange={(value) => {
          onServiceTierChange(toRealValue(value as OpenAIServiceTierOption['value']))
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
  )
}

export default ServiceTierSetting
