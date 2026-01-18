import { Info } from 'lucide-react'

import IconTooltip, { type IconTooltipProps } from './IconTooltip'

type InfoTooltipProps = Omit<IconTooltipProps, 'icon' | 'ariaLabel'>

/**
 * A tooltip with an info icon.
 * Used for providing additional information or context.
 */
const InfoTooltip = ({ iconColor = 'var(--color-text-2)', ...rest }: InfoTooltipProps) => {
  return <IconTooltip icon={Info} iconColor={iconColor} ariaLabel="Information" {...rest} />
}

export default InfoTooltip
