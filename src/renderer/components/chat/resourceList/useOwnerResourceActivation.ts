import { useCallback, useEffect, useRef } from 'react'

type UseOwnerResourceActivationOptions<TOwner, TResource> = {
  loadResourceForOwner: (owner: TOwner) => Promise<TResource | null>
  onActivateResource: (resource: TResource) => void
  onEmptyOwner?: (owner: TOwner) => void
}

/** Shared owner-entry policy for grouped sidebars and two-pane owner selectors. */
export function useOwnerResourceActivation<TOwner, TResource>({
  loadResourceForOwner,
  onActivateResource,
  onEmptyOwner
}: UseOwnerResourceActivationOptions<TOwner, TResource>) {
  const requestGenerationRef = useRef(0)

  const cancelOwnerResourceActivation = useCallback(() => {
    requestGenerationRef.current += 1
  }, [])

  useEffect(() => cancelOwnerResourceActivation, [cancelOwnerResourceActivation, loadResourceForOwner])

  const activateOwnerResource = useCallback(
    async (owner: TOwner) => {
      const requestGeneration = ++requestGenerationRef.current
      try {
        const resource = await loadResourceForOwner(owner)
        if (requestGeneration !== requestGenerationRef.current) return
        if (resource) onActivateResource(resource)
        else onEmptyOwner?.(owner)
      } catch (error) {
        // A superseded lookup no longer represents the requested owner. The current
        // lookup still rejects so each surface can report it through its normal UI.
        if (requestGeneration === requestGenerationRef.current) throw error
      }
    },
    [loadResourceForOwner, onActivateResource, onEmptyOwner]
  )

  return { activateOwnerResource, cancelOwnerResourceActivation }
}
