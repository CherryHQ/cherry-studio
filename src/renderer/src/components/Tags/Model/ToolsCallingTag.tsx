import { ToolOutlined } from '@ant-design/icons'
import { useTranslation } from 'react-i18next'

import CustomTag, { CustomTagProps } from '../CustomTag'

type Props = {
  size?: number
  showTooltip?: boolean
  showLabel?: boolean
} & Omit<CustomTagProps, 'size' | 'tooltip' | 'icon' | 'color' | 'children'>

export const ToolsCallingTag = ({ size, showTooltip, showLabel, ...restProps }: Props) => {
  const { t } = useTranslation()
  return (
    <CustomTag
      size={size}
      color="#f18737"
      icon={<ToolOutlined style={{ fontSize: size }} />}
      tooltip={showTooltip ? t('models.type.function_calling') : undefined}
      {...restProps}>
      {showLabel ? t('models.type.function_calling') : ''}
    </CustomTag>
  )
}
