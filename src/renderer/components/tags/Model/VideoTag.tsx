import { Video } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import type { CustomTagProps } from '../CustomTag'
import CustomTag from '../CustomTag'

type Props = {
  size?: number
  showTooltip?: boolean
  showLabel?: boolean
} & Omit<CustomTagProps, 'size' | 'tooltip' | 'icon' | 'color' | 'children'>

export const VideoTag = ({ size = 12, showTooltip, showLabel, ...restProps }: Props) => {
  const { t } = useTranslation()

  return (
    <CustomTag
      size={size}
      color="#722ed1"
      icon={<Video size={size} color="currentColor" className="text-current" />}
      tooltip={showTooltip ? t('models.type.video') : undefined}
      {...restProps}>
      {showLabel ? t('models.type.video') : ''}
    </CustomTag>
  )
}
