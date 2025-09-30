import type { TooltipProps as HeroUITooltipProps } from '@heroui/react'
import { cn, Tooltip as HeroUITooltip } from '@heroui/react'

export interface TooltipProps extends HeroUITooltipProps {}

export const Tooltip = ({ children, classNames, ...rest }: TooltipProps) => {
  return (
    <HeroUITooltip
      classNames={{
        ...classNames,
        content: cn('max-w-60', classNames?.content)
      }}
      showArrow={true}
      {...rest}>
      {children}
    </HeroUITooltip>
  )
}
