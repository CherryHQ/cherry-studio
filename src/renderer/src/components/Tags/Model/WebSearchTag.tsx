import { Globe } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import type { CustomTagProps } from '../CustomTag'
import CustomTag from '../CustomTag'

type Props = {
  size?: number
  showTooltip?: boolean
  showLabel?: boolean
} & Omit<CustomTagProps, 'size' | 'tooltip' | 'icon' | 'color' | 'children'>

export const WebSearchTag = ({ size = 12, showTooltip, showLabel, ...restProps }: Props) => {
  const { t } = useTranslation()

  return (
    <CustomTag
      size={size}
      color="#1677ff"
      icon={<Globe size={size} color="currentColor" className="text-current" />}
      tooltip={showTooltip ? t('models.type.websearch') : undefined}
      {...restProps}>
      {showLabel ? t('models.type.websearch') : ''}
    </CustomTag>
  )
}
