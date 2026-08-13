import { useEffect, useRef, useState } from 'react'

import type { ResourceListRevealRequest } from './ResourceListContext'

export function useDisplayModeRevealRequest(
  displayMode: string,
  activeItemId: string | null | undefined,
  revealRequest?: ResourceListRevealRequest
): ResourceListRevealRequest | undefined {
  const previousDisplayModeRef = useRef(displayMode)
  const modeRequestIdRef = useRef(0)
  const incomingRequestKey = revealRequest ? `${revealRequest.requestId}:${revealRequest.itemId}` : null
  const [modeRequest, setModeRequest] = useState<{
    incomingRequestKey: string | null
    request?: ResourceListRevealRequest
  }>()

  useEffect(() => {
    if (previousDisplayModeRef.current === displayMode) return
    previousDisplayModeRef.current = displayMode
    const request =
      revealRequest?.itemId === activeItemId
        ? revealRequest
        : activeItemId
          ? { itemId: activeItemId, requestId: 0 }
          : undefined
    if (!request) {
      setModeRequest(undefined)
      return
    }

    // Re-locate the active row under the new grouping while preserving every
    // unrelated collapse choice.
    modeRequestIdRef.current -= 1
    setModeRequest({
      incomingRequestKey,
      request: { ...request, requestId: modeRequestIdRef.current }
    })
  }, [activeItemId, displayMode, incomingRequestKey, revealRequest])

  return modeRequest?.incomingRequestKey === incomingRequestKey ? modeRequest.request : revealRequest
}
