import { Skeleton } from '@cherrystudio/ui'
import { useEffect, useState } from 'react'

export const MESSAGE_LIST_INITIAL_LOADING_DELAY_MS = 160

export function MessageListInitialLoading({ delayMs = MESSAGE_LIST_INITIAL_LOADING_DELAY_MS }: { delayMs?: number }) {
  const [visible, setVisible] = useState(() => delayMs <= 0)

  useEffect(() => {
    if (delayMs <= 0) {
      setVisible(true)
      return
    }

    setVisible(false)
    const timer = window.setTimeout(() => setVisible(true), delayMs)
    return () => window.clearTimeout(timer)
  }, [delayMs])

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col px-6 py-8" aria-busy="true">
      {visible && (
        <div
          aria-hidden="true"
          data-message-list-loading-skeleton=""
          className="mx-auto flex w-full max-w-[800px] flex-col gap-7">
          <div className="flex justify-end">
            <div className="flex w-[min(58%,32rem)] flex-col items-end gap-2">
              <Skeleton className="h-3 w-2/3 rounded-sm" />
              <Skeleton className="h-3 w-full rounded-sm" />
            </div>
          </div>
          <div className="flex w-[min(76%,42rem)] items-start gap-3">
            <Skeleton className="size-7 shrink-0 rounded-full" />
            <div className="flex min-w-0 flex-1 flex-col gap-2 pt-1">
              <Skeleton className="h-3 w-11/12 rounded-sm" />
              <Skeleton className="h-3 w-full rounded-sm" />
              <Skeleton className="h-3 w-3/5 rounded-sm" />
            </div>
          </div>
          <div className="flex w-[min(68%,38rem)] items-start gap-3">
            <Skeleton className="size-7 shrink-0 rounded-full" />
            <div className="flex min-w-0 flex-1 flex-col gap-2 pt-1">
              <Skeleton className="h-3 w-full rounded-sm" />
              <Skeleton className="h-3 w-4/5 rounded-sm" />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
