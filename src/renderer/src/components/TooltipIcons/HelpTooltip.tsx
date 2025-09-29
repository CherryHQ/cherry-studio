import type { TooltipProps } from 'antd'
import { Tooltip } from 'antd'
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
      <HelpCircle
        size={iconSize}
        color={iconColor}
        style={{ ...iconStyle, cursor: 'help' }}
        role="img"
        aria-label="Help"
        className="relative z-10"
      />
    </Tooltip>
  )
}

export default HelpTooltip
