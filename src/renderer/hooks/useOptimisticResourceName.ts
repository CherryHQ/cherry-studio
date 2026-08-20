import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

interface VersionedNamedResource {
  id: string
  name: string
  updatedAt: string
}

interface OptimisticResourceName {
  /** Source version visible when this rename became the latest intent. */
  baseUpdatedAt: string
  name: string
  /** Monotonic intent id that prevents an older request from replacing a newer rename. */
  requestId: number
  /** The write completed successfully, but the source has not reconciled yet. */
  settled: boolean
}

/**
 * Keeps the latest submitted resource name visible until the versioned source becomes authoritative.
 *
 * A successful write remains overlaid while the source still exposes the same version. A matching name,
 * a newer `updatedAt`, or removal from the source retires that settled overlay. Renames for one resource
 * are serialized, and `requestId` ensures an older completion cannot replace newer user intent.
 */
export function useOptimisticResourceName<T extends VersionedNamedResource>(sourceItems: readonly T[]) {
  const [optimisticNames, setOptimisticNames] = useState<ReadonlyMap<string, OptimisticResourceName>>(() => new Map())
  const sourceItemsRef = useRef(sourceItems)
  const requestIdRef = useRef(0)
  const queuesRef = useRef(new Map<string, Promise<void>>())
  sourceItemsRef.current = sourceItems

  const items = useMemo(
    () =>
      optimisticNames.size === 0
        ? sourceItems
        : sourceItems.map((item) => {
            const optimisticName = optimisticNames.get(item.id)
            return optimisticName === undefined ? item : { ...item, name: optimisticName.name }
          }),
    [optimisticNames, sourceItems]
  )

  useEffect(() => {
    if (optimisticNames.size === 0) return

    setOptimisticNames((current) => {
      if (current.size === 0) return current

      const sourceItemById = new Map(sourceItems.map((item) => [item.id, item]))
      let next: Map<string, OptimisticResourceName> | undefined
      for (const [id, optimisticName] of current) {
        if (!optimisticName.settled) continue

        const item = sourceItemById.get(id)
        if (
          item === undefined ||
          item.name === optimisticName.name ||
          item.updatedAt !== optimisticName.baseUpdatedAt
        ) {
          next ??= new Map(current)
          next.delete(id)
        }
      }

      return next ?? current
    })
  }, [optimisticNames, sourceItems])

  /**
   * @param item - The source snapshot being renamed.
   * @param name - The latest user-submitted name to display immediately.
   * @param persist - Performs the write. `true` keeps the overlay until source reconciliation, `false`
   * rolls it back, and a rejection rolls it back before propagating the error to the caller.
   */
  const rename = useCallback((item: T, name: string, persist: () => Promise<boolean>) => {
    const requestId = ++requestIdRef.current
    setOptimisticNames((current) => {
      const next = new Map(current)
      next.set(item.id, { baseUpdatedAt: item.updatedAt, name, requestId, settled: false })
      return next
    })

    const previousRequest = queuesRef.current.get(item.id) ?? Promise.resolve()
    const request = previousRequest.then(() => {
      const latestItem = sourceItemsRef.current.find((candidate) => candidate.id === item.id)
      setOptimisticNames((current) => {
        const optimisticName = current.get(item.id)
        if (
          optimisticName?.requestId !== requestId ||
          latestItem === undefined ||
          optimisticName.baseUpdatedAt === latestItem.updatedAt
        ) {
          return current
        }
        const next = new Map(current)
        next.set(item.id, { ...optimisticName, baseUpdatedAt: latestItem.updatedAt })
        return next
      })
      return persist()
    })
    const settledRequest = request.then(
      (persisted) => {
        setOptimisticNames((current) => {
          const optimisticName = current.get(item.id)
          if (optimisticName?.requestId !== requestId) return current
          const next = new Map(current)
          if (persisted) {
            next.set(item.id, { ...optimisticName, settled: true })
          } else {
            next.delete(item.id)
          }
          return next
        })
        return persisted
      },
      (error) => {
        setOptimisticNames((current) => {
          if (current.get(item.id)?.requestId !== requestId) return current
          const next = new Map(current)
          next.delete(item.id)
          return next
        })
        throw error
      }
    )
    const queueTail = settledRequest.then(
      () => undefined,
      () => undefined
    )
    queuesRef.current.set(item.id, queueTail)
    void queueTail.finally(() => {
      if (queuesRef.current.get(item.id) === queueTail) {
        queuesRef.current.delete(item.id)
      }
    })

    return settledRequest
  }, [])

  return { items, rename }
}
