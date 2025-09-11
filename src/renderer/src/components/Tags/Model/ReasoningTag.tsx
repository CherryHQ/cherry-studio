import { useTranslation } from 'react-i18next'

import CustomTag, { CustomTagProps } from '../CustomTag'

type Props = {
  size?: number
  showTooltip?: boolean
  showLabel?: boolean
} & Omit<CustomTagProps, 'size' | 'tooltip' | 'icon' | 'color' | 'children'>

export const ReasoningTag = ({ size, showTooltip, showLabel, ...restProps }: Props) => {
  const { t } = useTranslation()
  return (
    <CustomTag
      size={size}
      color="#6372bd"
      icon={<i className="iconfont icon-thinking" />}
      tooltip={showTooltip ? t('models.type.reasoning') : undefined}
      {...restProps}>
      {showLabel ? t('models.type.reasoning') : ''}
    </CustomTag>
  )
}
