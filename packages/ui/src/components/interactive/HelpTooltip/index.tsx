// Original path: src/renderer/src/components/TooltipIcons/HelpTooltip.tsx
import { HelpCircle } from 'lucide-react'

import Tooltip from '../../base/Tooltip'

interface HelpTooltipProps {
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

const HelpTooltip = ({
  title,
  placement = 'top',
  iconColor = 'var(--color-text-2)',
  iconSize = 14,
  iconStyle,
  ...rest
}: HelpTooltipProps) => {
  return (
    <Tooltip placement={placement} content={title} {...rest}>
      <HelpCircle size={iconSize} color={iconColor} style={{ ...iconStyle }} role="img" aria-label="Help" />
    </Tooltip>
  )
}

export default HelpTooltip
