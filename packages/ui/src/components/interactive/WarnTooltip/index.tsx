// Original path: src/renderer/src/components/TooltipIcons/WarnTooltip.tsx
import { AlertTriangle } from 'lucide-react'

import Tooltip from '../../base/Tooltip'

interface WarnTooltipProps {
  title: React.ReactNode
  placement?:
    | 'top'
    | 'bottom'
    | 'left'
    | 'right'
    | 'top-start'
    | 'top-end'
    | 'bottom-start'
    | 'bottom-end'
    | 'left-start'
    | 'left-end'
    | 'right-start'
    | 'right-end'
  iconColor?: string
  iconSize?: string | number
  iconStyle?: React.CSSProperties
  [key: string]: any
}

const WarnTooltip = ({
  title,
  placement = 'top',
  iconColor = 'var(--color-status-warning)',
  iconSize = 14,
  iconStyle,
  ...rest
}: WarnTooltipProps) => {
  return (
    <Tooltip placement={placement} content={title} {...rest}>
      <AlertTriangle size={iconSize} color={iconColor} style={{ ...iconStyle }} role="img" aria-label="Information" />
    </Tooltip>
  )
}

export default WarnTooltip
