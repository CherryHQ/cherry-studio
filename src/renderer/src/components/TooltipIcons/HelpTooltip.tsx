import type { TooltipProps } from 'antd'
import { Tooltip } from 'antd'
import { HelpCircle } from 'lucide-react'
import { useTranslation } from 'react-i18next'

type InheritedTooltipProps = Omit<TooltipProps, 'children'>

interface HelpTooltipProps extends InheritedTooltipProps {
  iconColor?: string
  iconSize?: string | number
  iconStyle?: React.CSSProperties
}

const HelpTooltip = ({ iconColor = 'var(--color-text-2)', iconSize = 14, iconStyle, ...rest }: HelpTooltipProps) => {
  const { t } = useTranslation()
  return (
    <Tooltip {...rest}>
      <HelpCircle size={iconSize} color={iconColor} style={{ ...iconStyle }} role="img" aria-label={t('common.help', 'Help')} />
    </Tooltip>
  )
}

export default HelpTooltip
