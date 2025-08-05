import { useTranslation } from 'react-i18next'

import CustomTag from './CustomTag'

type Props = {
  size?: number
  showTooltip?: boolean
  shouldShowLabel?: boolean
}

export const ReasoningTag = ({ size, showTooltip, shouldShowLabel }: Props) => {
  const { t } = useTranslation()
  return (
    <CustomTag
      size={size}
      color="#6372bd"
      icon={<i className="iconfont icon-thinking" />}
      tooltip={showTooltip ? t('models.type.reasoning') : undefined}>
      {shouldShowLabel ? t('models.type.reasoning') : ''}
    </CustomTag>
  )
}
