import { Tag, type TagProps, Tooltip } from '@cherrystudio/ui'
import { useTranslation } from 'react-i18next'

type Props = {
  size?: TagProps['size']
  showTooltip?: boolean
  showLabel?: boolean
} & Omit<TagProps, 'size' | 'icon' | 'color' | 'children'>

export const ReasoningTag = ({ size, showTooltip, showLabel, ...restProps }: Props) => {
  const { t } = useTranslation()

  const tag = (
    <Tag size={size} color="#6372bd" icon={<i className="iconfont icon-thinking" />} {...restProps}>
      {showLabel ? t('models.type.reasoning') : ''}
    </Tag>
  )

  return showTooltip ? (
    <Tooltip content={t('models.type.reasoning')} delay={300}>
      {tag}
    </Tooltip>
  ) : (
    tag
  )
}
