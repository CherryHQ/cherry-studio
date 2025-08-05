import { GlobalOutlined } from '@ant-design/icons'
import { useTranslation } from 'react-i18next'

import CustomTag, { CustomTagProps } from './CustomTag'

type Props = {
  size?: number
  showTooltip?: boolean
  shouldShowLabel?: boolean
} & Omit<CustomTagProps, 'size' | 'tooltip' | 'icon' | 'color' | 'children'>

export const WebSearchTag = ({ size, showTooltip, shouldShowLabel, ...restProps }: Props) => {
  const { t } = useTranslation()

  return (
    <CustomTag
      size={size}
      color="#1677ff"
      icon={<GlobalOutlined style={{ fontSize: size }} />}
      tooltip={showTooltip ? t('models.type.websearch') : undefined}
      {...restProps}>
      {shouldShowLabel ? t('models.type.websearch') : ''}
    </CustomTag>
  )
}
