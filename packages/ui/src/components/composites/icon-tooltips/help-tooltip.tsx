import { HelpCircle } from 'lucide-react'

import { IconTooltip } from './icon-tooltip'
import type { IconTooltipProps } from './types'

/**
 * A tooltip with a help icon.
 * Used for providing help or guidance.
 */
export const HelpTooltip = (props: IconTooltipProps) => {
  return <IconTooltip icon={HelpCircle} defaultAriaLabel="Help" defaultColor="var(--muted-foreground)" {...props} />
}
