import type { ReactNode } from 'react'

import { Separator } from '@cherrystudio/ui'

export default function MessageTimelineMarker({ children, busy = false }: { children: ReactNode; busy?: boolean }) {
  return (
    <div
      className="my-3 flex w-full items-center gap-2 text-xs text-muted-foreground"
      role={busy ? 'status' : 'separator'}
      aria-live={busy ? 'polite' : undefined}>
      <Separator
        aria-hidden="true"
        role="presentation"
        className="h-0 min-w-6 flex-1 border-t border-dashed border-border-subtle bg-transparent"
      />
      {children}
      <Separator
        aria-hidden="true"
        role="presentation"
        className="h-0 min-w-6 flex-1 border-t border-dashed border-border-subtle bg-transparent"
      />
    </div>
  )
}
