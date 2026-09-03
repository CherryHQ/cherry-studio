import type { TooltipProps } from '@cherrystudio/ui/components/primitives/tooltip'
import type { LucideProps } from 'lucide-react'
import type { MouseEventHandler } from 'react'

export interface IconTooltipProps extends Omit<TooltipProps, 'asChild' | 'children' | 'onClick'> {
  /** Localized accessible name for the focusable icon trigger. */
  ariaLabel?: string
  iconProps?: LucideProps
  onClick?: MouseEventHandler<HTMLButtonElement>
}
