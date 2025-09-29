import type { TooltipProps } from 'src/components/base/Tooltip'

export interface IconTooltipProps extends TooltipProps {
  iconColor?: string
  iconSize?: string | number
  iconStyle?: React.CSSProperties
}
