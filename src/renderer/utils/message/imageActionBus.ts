export type ImageActionType = 'copy' | 'export'

type ImageActionSettlement = {
  reject: (reason?: unknown) => void
  resolve: () => void
}

export type ImageActionRequest<TTarget, TTargetKey extends string> = {
  id: number
  promise: Promise<void>
  type: ImageActionType
} & Record<TTargetKey, TTarget>

interface CreateImageActionBusOptions<TTarget, TTargetKey extends string, TRequestOptions> {
  getTargetId: (target: TTarget) => string
  onRequest?: (type: ImageActionType, target: TTarget, options: TRequestOptions | undefined) => void
  targetKey: TTargetKey
}

export function createImageActionBus<TTarget, TTargetKey extends string, TRequestOptions = undefined>({
  getTargetId,
  onRequest,
  targetKey
}: CreateImageActionBusOptions<TTarget, TTargetKey, TRequestOptions>) {
  let nextRequestId = 1
  let pendingRequests: ImageActionRequest<TTarget, TTargetKey>[] = []
  const settlements = new Map<number, ImageActionSettlement>()

  const getRequestTarget = (request: ImageActionRequest<TTarget, TTargetKey>) => request[targetKey]

  function requestImageAction(
    type: ImageActionType,
    target: TTarget,
    options?: TRequestOptions
  ): ImageActionRequest<TTarget, TTargetKey> {
    let settlement: ImageActionSettlement | undefined
    const promise = new Promise<void>((resolve, reject) => {
      settlement = { resolve, reject }
    })
    const request = {
      id: nextRequestId++,
      promise,
      type,
      [targetKey]: target
    } as ImageActionRequest<TTarget, TTargetKey>
    settlements.set(request.id, settlement as ImageActionSettlement)
    pendingRequests.push(request)
    onRequest?.(type, target, options)
    return request
  }

  function settleImageActionRequest(
    request: ImageActionRequest<TTarget, TTargetKey>,
    actionPromise: Promise<void> | void
  ): void {
    const settlement = settlements.get(request.id)
    if (!settlement) return

    settlements.delete(request.id)
    void Promise.resolve(actionPromise).then(settlement.resolve, settlement.reject)
  }

  function consumePendingImageActions(
    targetId: string,
    type?: ImageActionType
  ): ImageActionRequest<TTarget, TTargetKey>[] {
    const matches: ImageActionRequest<TTarget, TTargetKey>[] = []
    const remaining: ImageActionRequest<TTarget, TTargetKey>[] = []

    for (const request of pendingRequests) {
      if (getTargetId(getRequestTarget(request)) === targetId && (!type || request.type === type)) {
        matches.push(request)
      } else {
        remaining.push(request)
      }
    }

    pendingRequests = remaining
    return matches
  }

  function rejectPendingImageActions(targetId: string | undefined, reason: unknown): void {
    const remaining: ImageActionRequest<TTarget, TTargetKey>[] = []

    for (const request of pendingRequests) {
      if (targetId === undefined || getTargetId(getRequestTarget(request)) === targetId) {
        const settlement = settlements.get(request.id)
        settlements.delete(request.id)
        settlement?.reject(reason)
      } else {
        remaining.push(request)
      }
    }

    pendingRequests = remaining
  }

  function clearPendingImageActionsForTest(): void {
    pendingRequests = []
    settlements.clear()
    nextRequestId = 1
  }

  return {
    clearPendingImageActionsForTest,
    consumePendingImageActions,
    rejectPendingImageActions,
    requestImageAction,
    settleImageActionRequest
  }
}
