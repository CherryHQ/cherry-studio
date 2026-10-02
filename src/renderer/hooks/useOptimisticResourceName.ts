import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

interface VersionedNamedResource {
  id: string
  name: string
  updatedAt: string
}

interface OptimisticNameOverlay {
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
  const [nameOverlays, setNameOverlays] = useState<ReadonlyMap<string, OptimisticNameOverlay>>(() => new Map())
  const sourceItemsRef = useRef(sourceItems)
  const requestIdRef = useRef(0)
  const queuesRef = useRef(new Map<string, Promise<void>>())
  sourceItemsRef.current = sourceItems

  const items = useMemo(
    () =>
      nameOverlays.size === 0
        ? sourceItems
        : sourceItems.map((item) => {
            const overlay = nameOverlays.get(item.id)
            return overlay === undefined ? item : { ...item, name: overlay.name }
          }),
    [nameOverlays, sourceItems]
  )

  useEffect(() => {
    if (nameOverlays.size === 0) return

    setNameOverlays((current) => {
      if (current.size === 0) return current

      const sourceItemById = new Map(sourceItems.map((item) => [item.id, item]))
      let next: Map<string, OptimisticNameOverlay> | undefined
      for (const [id, overlay] of current) {
        if (!overlay.settled) continue

        const item = sourceItemById.get(id)
        if (
          item === undefined ||
          item.name === overlay.name ||
          Date.parse(item.updatedAt) > Date.parse(overlay.baseUpdatedAt)
        ) {
          next ??= new Map(current)
          next.delete(id)
        }
      }

      return next ?? current
    })
  }, [nameOverlays, sourceItems])

  /**
   * @param item - The source snapshot being renamed.
   * @param name - The latest user-submitted name to display immediately.
   * @param persist - Performs the write. `true` keeps the overlay until source reconciliation, `false`
   * rolls it back, and a rejection rolls it back before propagating the error to the caller.
   */
  const rename = useCallback((item: T, name: string, persist: () => Promise<boolean>) => {
    const requestId = ++requestIdRef.current
    setNameOverlays((current) => {
      const next = new Map(current)
      next.set(item.id, { baseUpdatedAt: item.updatedAt, name, requestId, settled: false })
      return next
    })

    const previousRequest = queuesRef.current.get(item.id) ?? Promise.resolve()
    const request = previousRequest.then(() => {
      const latestItem = sourceItemsRef.current.find((candidate) => candidate.id === item.id)
      setNameOverlays((current) => {
        const overlay = current.get(item.id)
        if (
          overlay?.requestId !== requestId ||
          latestItem === undefined ||
          overlay.baseUpdatedAt === latestItem.updatedAt
        ) {
          return current
        }
        const next = new Map(current)
        next.set(item.id, { ...overlay, baseUpdatedAt: latestItem.updatedAt })
        return next
      })
      return persist()
    })
    const settledRequest = request.then(
      (persisted) => {
        setNameOverlays((current) => {
          const overlay = current.get(item.id)
          if (overlay?.requestId !== requestId) return current
          const next = new Map(current)
          if (persisted) {
            next.set(item.id, { ...overlay, settled: true })
          } else {
            next.delete(item.id)
          }
          return next
        })
        return persisted
      },
      (error) => {
        setNameOverlays((current) => {
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
