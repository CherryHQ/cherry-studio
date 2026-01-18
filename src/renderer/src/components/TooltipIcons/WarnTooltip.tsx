import { AlertTriangle } from 'lucide-react'

import IconTooltip, { type IconTooltipProps } from './IconTooltip'

type WarnTooltipProps = Omit<IconTooltipProps, 'icon' | 'ariaLabel'>

/**
 * A tooltip with a warning icon.
 * Used for displaying warnings or cautions.
 */
const WarnTooltip = ({ iconColor = 'var(--color-status-warning)', ...rest }: WarnTooltipProps) => {
  return <IconTooltip icon={AlertTriangle} iconColor={iconColor} ariaLabel="Warning" {...rest} />
}

export default WarnTooltip
