import { ToolOutlined } from '@ant-design/icons'
import { Tag, type TagProps, Tooltip } from '@cherrystudio/ui'
import { useTranslation } from 'react-i18next'

type Props = {
  size?: TagProps['size']
  showTooltip?: boolean
  showLabel?: boolean
} & Omit<TagProps, 'size' | 'icon' | 'color' | 'children'>

export const ToolsCallingTag = ({ size, showTooltip, showLabel, ...restProps }: Props) => {
  const { t } = useTranslation()

  const tag = (
    <Tag size={size} color="#f18737" icon={<ToolOutlined />} {...restProps}>
      {showLabel ? t('models.type.function_calling') : ''}
    </Tag>
  )

  return showTooltip ? (
    <Tooltip content={t('models.type.function_calling')} delay={300}>
      {tag}
    </Tooltip>
  ) : (
    tag
  )
}
