import { HelpCircle } from 'lucide-react'

import { IconTooltip } from './IconTooltip'
import type { IconTooltipProps } from './types'

/**
 * A tooltip with a help icon.
 * Used for providing help or guidance.
 */
export const HelpTooltip = (props: IconTooltipProps) => {
  return <IconTooltip icon={HelpCircle} ariaLabel="Help" defaultColor="var(--color-text-2)" {...props} />
}
