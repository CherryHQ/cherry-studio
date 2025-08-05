import { EyeOutlined } from '@ant-design/icons'
import { useTranslation } from 'react-i18next'

import CustomTag, { CustomTagProps } from './CustomTag'

type Props = {
  size?: number
  showTooltip?: boolean
  shouldShowLabel?: boolean
} & Omit<CustomTagProps, 'size' | 'tooltip' | 'icon' | 'color' | 'children'>

export const VisionTag = ({ size, showTooltip, shouldShowLabel, ...restProps }: Props) => {
  const { t } = useTranslation()

  return (
    <CustomTag
      size={size}
      color="#00b96b"
      icon={<EyeOutlined style={{ fontSize: size }} />}
      tooltip={showTooltip ? t('models.type.vision') : undefined}
      {...restProps}>
      {shouldShowLabel ? t('models.type.vision') : ''}
    </CustomTag>
  )
}
