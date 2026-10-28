import { createContext, type ReactNode, use, useCallback, useMemo, useRef, useState } from 'react'

export interface MessageCaptureLeaseContextValue {
  acquireMessageCaptureLease: (messageId: string) => () => void
  getRenderedMessageElement: (messageId: string) => HTMLElement | null
}

interface MessageCaptureLeaseManager {
  leasedMessageIds: readonly string[]
  acquireMessageCaptureLease: (messageId: string) => () => void
}

const MessageCaptureLeaseContext = createContext<MessageCaptureLeaseContextValue | null>(null)

export function useOptionalMessageCaptureLease(): MessageCaptureLeaseContextValue | null {
  return use(MessageCaptureLeaseContext)
}

export function MessageCaptureLeaseProvider({
  children,
  value
}: {
  children: ReactNode
  value: MessageCaptureLeaseContextValue
}) {
  return <MessageCaptureLeaseContext value={value}>{children}</MessageCaptureLeaseContext>
}

export function useMessageCaptureLeases(): MessageCaptureLeaseManager {
  const [leasedMessageIds, setLeasedMessageIds] = useState<readonly string[]>([])
  const leaseCountsRef = useRef(new Map<string, number>())

  const acquireMessageCaptureLease = useCallback((messageId: string) => {
    const leaseCounts = leaseCountsRef.current
    const nextCount = (leaseCounts.get(messageId) ?? 0) + 1
    leaseCounts.set(messageId, nextCount)
    if (nextCount === 1) setLeasedMessageIds([...leaseCounts.keys()])

    let released = false
    return () => {
      if (released) return
      released = true

      const currentCount = leaseCounts.get(messageId) ?? 0
      if (currentCount <= 1) {
        leaseCounts.delete(messageId)
        setLeasedMessageIds([...leaseCounts.keys()])
      } else {
        leaseCounts.set(messageId, currentCount - 1)
      }
    }
  }, [])

  return useMemo(
    () => ({ leasedMessageIds, acquireMessageCaptureLease }),
    [acquireMessageCaptureLease, leasedMessageIds]
  )
}
