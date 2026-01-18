import type { TooltipProps } from 'antd'
import { Tooltip } from 'antd'
import type { LucideIcon } from 'lucide-react'

type InheritedTooltipProps = Omit<TooltipProps, 'children'>

export interface IconTooltipProps extends InheritedTooltipProps {
  /** The Lucide icon component to render */
  icon: LucideIcon
  /** Icon color, can be CSS variable or color value */
  iconColor?: string
  /** Icon size in pixels */
  iconSize?: string | number
  /** Additional styles for the icon */
  iconStyle?: React.CSSProperties
  /** Accessible label for screen readers */
  ariaLabel?: string
}

/**
 * A reusable tooltip component that wraps a Lucide icon.
 * This is the base component for InfoTooltip, WarnTooltip, and HelpTooltip.
 */
const IconTooltip = ({
  icon: Icon,
  iconColor,
  iconSize = 14,
  iconStyle,
  ariaLabel = 'Icon',
  ...tooltipProps
}: IconTooltipProps) => {
  return (
    <Tooltip {...tooltipProps}>
      <Icon size={iconSize} color={iconColor} style={{ ...iconStyle }} role="img" aria-label={ariaLabel} />
    </Tooltip>
  )
}

export default IconTooltip
