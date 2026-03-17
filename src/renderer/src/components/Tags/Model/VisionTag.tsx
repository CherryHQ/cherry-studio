import { EyeOutlined } from '@ant-design/icons'
import { Tag, type TagProps } from '@cherrystudio/ui'
import { useTranslation } from 'react-i18next'

type Props = {
  size?: TagProps['size']
  showTooltip?: boolean
  showLabel?: boolean
} & Omit<TagProps, 'size' | 'tooltip' | 'icon' | 'color' | 'children'>

export const VisionTag = ({ size, showTooltip, showLabel, ...restProps }: Props) => {
  const { t } = useTranslation()

  return (
    <Tag
      size={size}
      color="#00b96b"
      icon={<EyeOutlined />}
      tooltip={showTooltip ? t('models.type.vision') : undefined}
      {...restProps}>
      {showLabel ? t('models.type.vision') : ''}
    </Tag>
  )
}
