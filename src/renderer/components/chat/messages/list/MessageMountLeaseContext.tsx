import { createContext, type ReactNode, use, useCallback, useMemo, useRef, useState } from 'react'

interface MessageMountLeaseContextValue {
  acquireMessageMountLease: (messageId: string) => () => void
  getRenderedMessageElement: (messageId: string) => HTMLElement | null
}

interface MessageMountLeaseManager {
  leasedMessageIds: readonly string[]
  acquireMessageMountLease: MessageMountLeaseContextValue['acquireMessageMountLease']
}

const MessageMountLeaseContext = createContext<MessageMountLeaseContextValue | null>(null)

export function useOptionalMessageMountLease(): MessageMountLeaseContextValue | null {
  return use(MessageMountLeaseContext)
}

export function MessageMountLeaseProvider({
  children,
  value
}: {
  children: ReactNode
  value: MessageMountLeaseContextValue
}) {
  return <MessageMountLeaseContext value={value}>{children}</MessageMountLeaseContext>
}

export function useMessageMountLeases(): MessageMountLeaseManager {
  const [leasedMessageIds, setLeasedMessageIds] = useState<readonly string[]>([])
  const leaseCountsRef = useRef(new Map<string, number>())

  const acquireMessageMountLease = useCallback((messageId: string) => {
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

  return useMemo(() => ({ leasedMessageIds, acquireMessageMountLease }), [acquireMessageMountLease, leasedMessageIds])
}
