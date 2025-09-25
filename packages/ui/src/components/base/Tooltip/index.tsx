import type { TooltipProps as HeroUITooltipProps } from '@heroui/react'
import { Tooltip as HeroUITooltip } from '@heroui/react'

interface TooltipProps {
  title: React.ReactNode
  children: React.ReactNode
  placement?: HeroUITooltipProps['placement']
  [key: string]: any
}

const Tooltip = ({ title, placement, children, ...rest }: TooltipProps) => {
  return (
    <HeroUITooltip
      classNames={{
        content: 'max-w-[240px]'
      }}
      content={title}
      placement={placement}
      showArrow={true}
      closeDelay={0}
      delay={500}
      {...rest}>
      {children}
    </HeroUITooltip>
  )
}

export default Tooltip
