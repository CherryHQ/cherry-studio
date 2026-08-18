import { useEffect, useRef, useState } from 'react'

import type { ResourceListItemBase, ResourceListRevealRequest } from './ResourceListContext'
import type { ResourceListRemoteGroupSnapshot } from './ResourceListRemoteGroups'

type UsePrepareResourceListRemoteRevealOptions<T extends ResourceListItemBase> = {
  candidateSnapshots: readonly ResourceListRemoteGroupSnapshot<T>[]
  isQueryReady: boolean
  onPrepare: (request: ResourceListRevealRequest) => void
  revealRequest?: ResourceListRevealRequest
}

type RevealGeneration = {
  attemptedSnapshots: Map<string, string>
  generation: number
  requestKey: string
  stopped: boolean
}

type PreparedReveal = {
  request: ResourceListRevealRequest
  requestKey: string
}

/** Loads authoritative remote pages until the requested row exists locally. */
export function usePrepareResourceListRemoteReveal<T extends ResourceListItemBase>({
  candidateSnapshots,
  isQueryReady,
  onPrepare,
  revealRequest
}: UsePrepareResourceListRemoteRevealOptions<T>): ResourceListRevealRequest | undefined {
  const requestKey = revealRequest ? `${revealRequest.requestId}:${revealRequest.itemId}` : null
  const generationRef = useRef(0)
  const activeGenerationRef = useRef<RevealGeneration | null>(null)
  const onPrepareRef = useRef(onPrepare)
  const revealRequestRef = useRef(revealRequest)
  const [preparedReveal, setPreparedReveal] = useState<PreparedReveal>()
  onPrepareRef.current = onPrepare
  revealRequestRef.current = revealRequest

  useEffect(() => {
    const request = revealRequestRef.current
    const generation = ++generationRef.current
    if (!request || !requestKey) {
      activeGenerationRef.current = null
      return
    }

    activeGenerationRef.current = {
      attemptedSnapshots: new Map(),
      generation,
      requestKey,
      stopped: false
    }
    onPrepareRef.current(request)
  }, [requestKey])

  useEffect(() => {
    const request = revealRequestRef.current
    const activeGeneration = activeGenerationRef.current
    if (
      !request ||
      !requestKey ||
      !activeGeneration ||
      activeGeneration.requestKey !== requestKey ||
      activeGeneration.stopped ||
      !isQueryReady ||
      candidateSnapshots.length === 0
    ) {
      return
    }

    const settledSnapshots = candidateSnapshots.filter(
      (snapshot) => !snapshot.error && !snapshot.isLoading && !snapshot.isRefreshing
    )
    if (settledSnapshots.some((snapshot) => snapshot.items.some((item) => item.id === request.itemId))) {
      activeGeneration.stopped = true
      setPreparedReveal({ request, requestKey })
      return
    }

    const availableSnapshots = candidateSnapshots.filter((snapshot) => !snapshot.error)
    if (availableSnapshots.length === 0) {
      activeGeneration.stopped = true
      return
    }

    const loadableSnapshots = availableSnapshots.filter(
      (snapshot) => snapshot.hasNext && !snapshot.isLoading && !snapshot.isRefreshing
    )
    if (
      loadableSnapshots.length === 0 &&
      availableSnapshots.every((snapshot) => !snapshot.isLoading && !snapshot.isRefreshing)
    ) {
      activeGeneration.stopped = true
      return
    }

    let requestedNextPage = false
    for (const snapshot of loadableSnapshots) {
      const snapshotKey = JSON.stringify([snapshot.groupId, snapshot.queryKey])
      const progressKey = snapshot.items.map((item) => item.id).join('\u001f')
      if (activeGeneration.attemptedSnapshots.get(snapshotKey) === progressKey) continue

      activeGeneration.attemptedSnapshots.set(snapshotKey, progressKey)
      requestedNextPage = true
      snapshot.loadNext()
    }

    // A backend cursor that reports another page without adding any rows must not spin forever.
    if (
      !requestedNextPage &&
      availableSnapshots.every((snapshot) => !snapshot.isLoading && !snapshot.isRefreshing) &&
      activeGeneration.generation === generationRef.current
    ) {
      activeGeneration.stopped = true
    }
  }, [candidateSnapshots, isQueryReady, requestKey])

  return preparedReveal?.requestKey === requestKey ? preparedReveal.request : undefined
}
