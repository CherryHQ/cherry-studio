import { HelpCircle } from 'lucide-react'

import IconTooltip, { type IconTooltipProps } from './IconTooltip'

type HelpTooltipProps = Omit<IconTooltipProps, 'icon' | 'ariaLabel'>

/**
 * A tooltip with a help icon.
 * Used for providing help or guidance.
 */
const HelpTooltip = ({ iconColor = 'var(--color-text-2)', ...rest }: HelpTooltipProps) => {
  return <IconTooltip icon={HelpCircle} iconColor={iconColor} ariaLabel="Help" {...rest} />
}

export default HelpTooltip
