// Original: src/renderer/src/components/Icons/ToolsCallingIcon.tsx
import { Tooltip, type TooltipProps } from '@heroui/react'
import { Wrench } from 'lucide-react'
import React from 'react'

import { cn } from '../../../utils'

interface ToolsCallingIconProps extends React.HTMLAttributes<HTMLDivElement> {
  className?: string
  iconClassName?: string
  TooltipProps?: TooltipProps
}

const ToolsCallingIcon = ({ className, iconClassName, TooltipProps, ...props }: ToolsCallingIconProps) => {
  return (
    <div className={cn('flex justify-center items-center', className)} {...props}>
      <Tooltip placement="top" {...TooltipProps}>
        <Wrench className={cn('w-4 h-4 mr-1.5 text-[#00b96b]', iconClassName)} />
      </Tooltip>
    </div>
  )
}

export default ToolsCallingIcon
