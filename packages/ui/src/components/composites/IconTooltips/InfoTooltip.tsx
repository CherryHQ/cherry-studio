import { Info } from 'lucide-react'

import { IconTooltip } from './IconTooltip'
import type { IconTooltipProps } from './types'

/**
 * A tooltip with an info icon.
 * Used for providing additional information or context.
 */
export const InfoTooltip = (props: IconTooltipProps) => {
  return <IconTooltip icon={Info} ariaLabel="Information" defaultColor="var(--color-text-2)" {...props} />
}
