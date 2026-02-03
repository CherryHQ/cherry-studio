import { AlertTriangle } from 'lucide-react'

import { IconTooltip } from './IconTooltip'
import type { IconTooltipProps } from './types'

/**
 * A tooltip with a warning icon.
 * Used for displaying warnings or cautions.
 */
export const WarnTooltip = (props: IconTooltipProps) => {
  return <IconTooltip icon={AlertTriangle} ariaLabel="Warning" defaultColor="var(--color-status-warning)" {...props} />
}
