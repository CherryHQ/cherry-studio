import type { TooltipProps as HeroUITooltipProps } from '@heroui/react'
import { Tooltip as HeroUITooltip } from '@heroui/react'

interface TooltipProps {
  content: React.ReactNode
  children: React.ReactNode
  placement?: HeroUITooltipProps['placement']
  [key: string]: any
}

const Tooltip = ({ content, placement, children, ...rest }: TooltipProps) => {
  return (
    <HeroUITooltip
      classNames={{
        content: 'max-w-[240px]'
      }}
      content={content}
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
