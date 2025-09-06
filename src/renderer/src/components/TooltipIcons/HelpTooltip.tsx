import { Tooltip, TooltipProps } from 'antd'
import { HelpCircle } from 'lucide-react'

type InheritedTooltipProps = Omit<TooltipProps, 'children'>

interface HelpTooltipProps extends InheritedTooltipProps {
  iconColor?: string
  iconSize?: string | number
  iconStyle?: React.CSSProperties
}

const HelpTooltip = ({ iconColor = 'var(--color-text-2)', iconSize = 14, iconStyle, ...rest }: HelpTooltipProps) => {
  return (
    <Tooltip {...rest}>
      <HelpCircle size={iconSize} color={iconColor} style={{ ...iconStyle }} role="img" aria-label="Help" />
    </Tooltip>
  )
}

export default HelpTooltip
