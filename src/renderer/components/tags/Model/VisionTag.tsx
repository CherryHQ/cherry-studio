import { Eye } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import type { CustomTagProps } from '../CustomTag'
import CustomTag from '../CustomTag'

type Props = {
  size?: number
  showTooltip?: boolean
  showLabel?: boolean
} & Omit<CustomTagProps, 'size' | 'tooltip' | 'icon' | 'color' | 'children'>

export const VisionTag = ({ size = 12, showTooltip, showLabel, ...restProps }: Props) => {
  const { t } = useTranslation()

  return (
    <CustomTag
      size={size}
      color="#00b96b"
      icon={<Eye size={size} color="currentColor" className="text-current" />}
      tooltip={showTooltip ? t('models.type.vision') : undefined}
      {...restProps}>
      {showLabel ? t('models.type.vision') : ''}
    </CustomTag>
  )
}
