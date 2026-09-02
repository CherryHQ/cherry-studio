import type { TooltipProps } from '@cherrystudio/ui/components/primitives/tooltip'
import type { LucideProps } from 'lucide-react'

export interface IconTooltipProps extends TooltipProps {
  /** Localized accessible name for the focusable icon trigger. */
  ariaLabel?: string
  iconProps?: LucideProps
}
