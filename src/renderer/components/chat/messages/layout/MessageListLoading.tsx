import { LoadingIcon } from '@renderer/components/Icons'
import { useEffect, useState } from 'react'

export const MESSAGE_LIST_INITIAL_LOADING_DELAY_MS = 1000

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
    <div className="flex h-full flex-1 items-center justify-center">
      {visible && <LoadingIcon color="var(--color-foreground-secondary)" />}
    </div>
  )
}
