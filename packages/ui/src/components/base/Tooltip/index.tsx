import type { TooltipProps as HeroUITooltipProps } from '@heroui/react'
import { cn, Tooltip as HeroUITooltip } from '@heroui/react'

export interface TooltipProps extends HeroUITooltipProps {}

/**
 * Tooltip wrapper that applies consistent styling and arrow display.
 * Differences from raw HeroUI Tooltip:
 * 1. Defaults showArrow={true}
 * 2. Merges a default max-w-60 class into the content slot, capping width at 240px.
 * All other HeroUI Tooltip props/behaviors remain unchanged.
 *
 * @see https://www.heroui.com/docs/components/tooltip
 */
export const Tooltip = ({ children, classNames, showArrow, ...rest }: TooltipProps) => {
  return (
    <HeroUITooltip
      classNames={{
        ...classNames,
        content: cn('max-w-60', classNames?.content)
      }}
      showArrow={showArrow ?? true}
      {...rest}>
      {children}
    </HeroUITooltip>
  )
}
