// Original: src/renderer/src/components/TooltipIcons/InfoTooltip.tsx
import { Info } from 'lucide-react'

import { Tooltip } from '../../base/Tooltip'
import type { IconTooltipProps } from './types'

export const InfoTooltip = ({
  iconColor = 'var(--color-text-2)',
  iconSize = 14,
  iconStyle,
  ...rest
}: IconTooltipProps) => {
  return (
    <Tooltip {...rest}>
      <Info size={iconSize} color={iconColor} style={{ ...iconStyle }} role="img" aria-label="Information" />
    </Tooltip>
  )
}
