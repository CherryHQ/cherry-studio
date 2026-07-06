import { Gift } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import type { CustomTagProps } from '../CustomTag'
import CustomTag from '../CustomTag'

type Props = {
  size?: number
  showTooltip?: boolean
  showLabel?: boolean
} & Omit<CustomTagProps, 'size' | 'tooltip' | 'icon' | 'color' | 'children'>

export const FreeTag = ({ size = 12, showTooltip, showLabel = true, ...restProps }: Props) => {
  const { t } = useTranslation()
  return (
    <CustomTag
      size={size}
      color="#7cb305"
      icon={<Gift size={size} color="currentColor" className="text-current" />}
      tooltip={showTooltip ? t('models.type.free') : undefined}
      {...restProps}>
      {showLabel ? t('models.type.free') : ''}
    </CustomTag>
  )
}
