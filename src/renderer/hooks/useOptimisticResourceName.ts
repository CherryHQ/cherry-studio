import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

interface VersionedNamedResource {
  id: string
  name: string
  updatedAt: string
}

interface OptimisticResourceName {
  baseUpdatedAt: string
  name: string
  requestId: number
  settled: boolean
}

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
    setOptimisticNames((current) => {
      if (current.size === 0) return current

      let next: Map<string, OptimisticResourceName> | undefined
      for (const item of sourceItems) {
        const optimisticName = current.get(item.id)
        if (
          optimisticName?.settled &&
          (item.name === optimisticName.name || item.updatedAt !== optimisticName.baseUpdatedAt)
        ) {
          next ??= new Map(current)
          next.delete(item.id)
        }
      }

      return next ?? current
    })
  }, [optimisticNames, sourceItems])

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
