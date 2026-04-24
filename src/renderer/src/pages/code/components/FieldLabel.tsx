import { Tooltip } from '@cherrystudio/ui'
import { Info } from 'lucide-react'
import type { ReactNode } from 'react'

export function FieldLabel({ children, hint, trailing }: { children: ReactNode; hint?: string; trailing?: ReactNode }) {
  return (
    <div className="mb-1.5 flex items-center gap-1.5">
      <span className="text-[10px] text-muted-foreground/80">{children}</span>
      {hint && (
        <Tooltip content={hint} placement="top" className="w-fit max-w-sm px-2.5 py-1.5 text-[10px] leading-relaxed">
          <Info size={9} className="cursor-help text-muted-foreground/60" />
        </Tooltip>
      )}
      {trailing}
    </div>
  )
}
