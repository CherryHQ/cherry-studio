import { GlobalOutlined } from '@ant-design/icons'
import { Tag, type TagProps } from '@cherrystudio/ui'
import { useTranslation } from 'react-i18next'

type Props = {
  size?: TagProps['size']
  showTooltip?: boolean
  showLabel?: boolean
} & Omit<TagProps, 'size' | 'tooltip' | 'icon' | 'color' | 'children'>

export const WebSearchTag = ({ size, showTooltip, showLabel, ...restProps }: Props) => {
  const { t } = useTranslation()

  return (
    <Tag
      size={size}
      color="#1677ff"
      icon={<GlobalOutlined />}
      tooltip={showTooltip ? t('models.type.websearch') : undefined}
      {...restProps}>
      {showLabel ? t('models.type.websearch') : ''}
    </Tag>
  )
}
