import { ToolOutlined } from '@ant-design/icons'
import { Tag, type TagProps } from '@cherrystudio/ui'
import { useTranslation } from 'react-i18next'

type Props = {
  size?: TagProps['size']
  showTooltip?: boolean
  showLabel?: boolean
} & Omit<TagProps, 'size' | 'tooltip' | 'icon' | 'color' | 'children'>

export const ToolsCallingTag = ({ size, showTooltip, showLabel, ...restProps }: Props) => {
  const { t } = useTranslation()
  return (
    <Tag
      size={size}
      color="#f18737"
      icon={<ToolOutlined />}
      tooltip={showTooltip ? t('models.type.function_calling') : undefined}
      {...restProps}>
      {showLabel ? t('models.type.function_calling') : ''}
    </Tag>
  )
}
