import { GlobalOutlined } from '@ant-design/icons'
import { Tag, type TagProps, Tooltip } from '@cherrystudio/ui'
import { useTranslation } from 'react-i18next'

type Props = {
  size?: TagProps['size']
  showTooltip?: boolean
  showLabel?: boolean
} & Omit<TagProps, 'size' | 'icon' | 'color' | 'children'>

export const WebSearchTag = ({ size, showTooltip, showLabel, ...restProps }: Props) => {
  const { t } = useTranslation()

  const tag = (
    <Tag size={size} color="#1677ff" icon={<GlobalOutlined />} {...restProps}>
      {showLabel ? t('models.type.websearch') : ''}
    </Tag>
  )

  return showTooltip ? (
    <Tooltip content={t('models.type.websearch')} delay={300}>
      {tag}
    </Tooltip>
  ) : (
    tag
  )
}
