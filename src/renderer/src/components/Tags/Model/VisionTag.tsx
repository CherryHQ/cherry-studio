import { EyeOutlined } from '@ant-design/icons'
import { Tag, type TagProps, Tooltip } from '@cherrystudio/ui'
import { useTranslation } from 'react-i18next'

type Props = {
  size?: TagProps['size']
  showTooltip?: boolean
  showLabel?: boolean
} & Omit<TagProps, 'size' | 'icon' | 'color' | 'children'>

export const VisionTag = ({ size, showTooltip, showLabel, ...restProps }: Props) => {
  const { t } = useTranslation()

  const tag = (
    <Tag size={size} color="#00b96b" icon={<EyeOutlined />} {...restProps}>
      {showLabel ? t('models.type.vision') : ''}
    </Tag>
  )

  return showTooltip ? (
    <Tooltip content={t('models.type.vision')} delay={300}>
      {tag}
    </Tooltip>
  ) : (
    tag
  )
}
