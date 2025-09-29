// Original path: src/renderer/src/components/TooltipIcons/HelpTooltip.tsx
import { HelpCircle } from 'lucide-react'

import type { TooltipProps } from '../../base/Tooltip'
import { Tooltip } from '../../base/Tooltip'

interface HelpTooltipProps extends TooltipProps {
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
