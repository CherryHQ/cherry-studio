import { Tag, type TagProps } from '@cherrystudio/ui'
import { useTranslation } from 'react-i18next'

type Props = {
  size?: TagProps['size']
  showTooltip?: boolean
  showLabel?: boolean
} & Omit<TagProps, 'size' | 'tooltip' | 'icon' | 'color' | 'children'>

export const ReasoningTag = ({ size, showTooltip, showLabel, ...restProps }: Props) => {
  const { t } = useTranslation()
  return (
    <Tag
      size={size}
      color="#6372bd"
      icon={<i className="iconfont icon-thinking" />}
      tooltip={showTooltip ? t('models.type.reasoning') : undefined}
      {...restProps}>
      {showLabel ? t('models.type.reasoning') : ''}
    </Tag>
  )
}
