// Original path: src/renderer/src/components/TooltipIcons/HelpTooltip.tsx
import { HelpCircle } from 'lucide-react'

import { Tooltip } from '../../base/Tooltip'
import type { IconTooltipProps } from './types'

interface HelpTooltipProps extends IconTooltipProps {}

export const HelpTooltip = ({
  iconColor = 'var(--color-text-2)',
  iconSize = 14,
  iconStyle,
  ...rest
}: HelpTooltipProps) => {
  return (
    <Tooltip {...rest}>
      <HelpCircle size={iconSize} color={iconColor} style={{ ...iconStyle }} role="img" aria-label="Help" />
    </Tooltip>
  )
}
