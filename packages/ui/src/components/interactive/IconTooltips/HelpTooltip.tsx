// Original path: src/renderer/src/components/TooltipIcons/HelpTooltip.tsx
import { HelpCircle } from 'lucide-react'

import { Tooltip } from '../../base/Tooltip'
import type { IconTooltipProps } from './types'

export const HelpTooltip = ({
  iconColor = 'var(--color-text-2)',
  iconSize = 14,
  iconStyle,
  ...rest
}: IconTooltipProps) => {
  return (
    <Tooltip {...rest}>
      <HelpCircle size={iconSize} color={iconColor} style={{ ...iconStyle }} role="img" aria-label="Help" />
    </Tooltip>
  )
}
