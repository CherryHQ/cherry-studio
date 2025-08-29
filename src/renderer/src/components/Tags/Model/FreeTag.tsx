import { Gift } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import CustomTag, { CustomTagProps } from '../CustomTag'

type Props = {
  size?: number
  showTooltip?: boolean
} & Omit<CustomTagProps, 'size' | 'tooltip' | 'icon' | 'color' | 'children'>

export const FreeTag = ({ size, showTooltip, ...restProps }: Props) => {
  const { t } = useTranslation()
  return (
    <CustomTag
      size={size}
      color="#7cb305"
      icon={t('models.type.free')}
      tooltip={showTooltip ? t('models.type.free') : undefined}
      {...restProps}
    />
  )
}

export const FreeTrialTag = ({ size, showTooltip, ...restProps }: Props) => {
  const { t } = useTranslation()
  return (
    <CustomTag
      size={size}
      color="#FF5F5F"
      icon={<Gift size={size} color="#FF5F5F" />}
      tooltip={showTooltip ? t('models.type.free_trial') : undefined}
      {...restProps}
    />
  )
}
