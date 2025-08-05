import { ToolOutlined } from '@ant-design/icons'
import { useTranslation } from 'react-i18next'

import CustomTag from './CustomTag'

type Props = {
  size?: number
  showTooltip?: boolean
  shouldShowLabel?: boolean
}

export const ToolsCallingTag = ({ size, showTooltip, shouldShowLabel }: Props) => {
  const { t } = useTranslation()
  return (
    <CustomTag
      size={size}
      color="#f18737"
      icon={<ToolOutlined style={{ fontSize: size }} />}
      tooltip={showTooltip ? t('models.type.function_calling') : undefined}>
      {shouldShowLabel ? t('models.type.function_calling') : ''}
    </CustomTag>
  )
}
