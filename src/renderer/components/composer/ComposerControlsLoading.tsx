import { Skeleton } from '@cherrystudio/ui'

interface ComposerControlsLoadingProps {
  compact?: boolean
}

export default function ComposerControlsLoading({ compact = false }: ComposerControlsLoadingProps) {
  return (
    <div
      aria-hidden="true"
      data-composer-controls-loading=""
      className="flex min-w-0 items-center gap-2 overflow-hidden">
      <Skeleton className="size-7 shrink-0 rounded-full" />
      {!compact ? (
        <>
          <Skeleton className="size-7 shrink-0 rounded-full" />
          <Skeleton className="h-7 w-16 shrink-0 rounded-full" />
        </>
      ) : null}
    </div>
  )
}
