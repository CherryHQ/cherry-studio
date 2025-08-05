import { useTranslation } from 'react-i18next'

import CustomTag, { CustomTagProps } from './CustomTag'

type Props = {
  size?: number
  showTooltip?: boolean
  shouldShowLabel?: boolean
} & Omit<CustomTagProps, 'size' | 'tooltip' | 'icon' | 'color' | 'children'>

export const ReasoningTag = ({ size, showTooltip, shouldShowLabel, ...restProps }: Props) => {
  const { t } = useTranslation()
  return (
    <CustomTag
      size={size}
      color="#6372bd"
      icon={<i className="iconfont icon-thinking" />}
      tooltip={showTooltip ? t('models.type.reasoning') : undefined}
      {...restProps}>
      {shouldShowLabel ? t('models.type.reasoning') : ''}
    </CustomTag>
  )
}
