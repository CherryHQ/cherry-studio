import React from 'react'

const CompactionAnchorBlock: React.FC = () => {
  return (
    <div className="my-3 flex w-full items-center gap-3 text-muted-foreground" role="separator">
      <span className="h-px min-w-6 flex-1 border-border-subtle border-t border-dashed" aria-hidden />
      <span className="size-1.5 shrink-0 rounded-full bg-border" aria-hidden />
      <span className="h-px min-w-6 flex-1 border-border-subtle border-t border-dashed" aria-hidden />
    </div>
  )
}

export default React.memo(CompactionAnchorBlock)
