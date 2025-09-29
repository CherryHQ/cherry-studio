// Original path: src/renderer/src/components/TooltipIcons/WarnTooltip.tsx
import { AlertTriangle } from 'lucide-react'

import { Tooltip } from '../../base/Tooltip'
import type { IconTooltipProps } from './types'

export const WarnTooltip = ({
  iconColor = 'var(--color-status-warning)',
  iconSize = 14,
  iconStyle,
  ...rest
}: IconTooltipProps) => {
  return (
    <Tooltip {...rest}>
      <AlertTriangle size={iconSize} color={iconColor} style={{ ...iconStyle }} role="img" aria-label="Information" />
    </Tooltip>
  )
}
