// Browser `components/OpenTarget/OpenTargetButton`: a page cannot open a path in the computer's apps, so
// there is no button; what it was given to show, such as a session's folder, stays as a label.
import { NormalTooltip } from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'
import type { OpenTargetButtonProps } from '@renderer/components/OpenTarget/OpenTargetButton'

export type { OpenTargetButtonProps }

export function OpenTargetButton({ primaryContent, primaryClassName, tooltip, className }: OpenTargetButtonProps) {
  if (primaryContent === undefined) return null
  const label = (
    <span
      className={cn('inline-flex items-center', primaryClassName, 'cursor-default hover:bg-transparent', className)}>
      {primaryContent}
    </span>
  )
  return tooltip ? <NormalTooltip content={tooltip}>{label}</NormalTooltip> : label
}
