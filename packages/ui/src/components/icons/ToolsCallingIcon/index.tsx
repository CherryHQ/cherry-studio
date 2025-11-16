/**
 * @deprecated 此组件使用频率仅为 1 次，不符合 UI 库提取标准（需 ≥3 次）
 * 计划在未来版本中移除。建议直接使用 lucide-react 的 Wrench 图标。
 *
 * This component has only 1 usage and does not meet the UI library extraction criteria (requires ≥3 usages).
 * Planned for removal in future versions. Consider using Wrench icon from lucide-react directly.
 */

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
      <Tooltip {...TooltipProps}>
        <Wrench className={cn('w-4 h-4 mr-1.5 text-[#00b96b]', iconClassName)} />
      </Tooltip>
    </div>
  )
}

export default ToolsCallingIcon
