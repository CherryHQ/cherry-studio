import { useCallback, useEffect, useRef } from 'react'

type UseOwnerResourceActivationOptions<TOwner, TResource> = {
  loadResourceForOwner: (owner: TOwner) => Promise<TResource | null>
  createResourceForOwner: (owner: TOwner) => Promise<TResource | null>
  onActivateResource: (resource: TResource) => void
  onError: (error: unknown) => void
}

/** Resolve owner navigation without allowing an older request to overwrite a newer selection. */
export function useOwnerResourceActivation<TOwner, TResource>({
  loadResourceForOwner,
  createResourceForOwner,
  onActivateResource,
  onError
}: UseOwnerResourceActivationOptions<TOwner, TResource>) {
  const requestGenerationRef = useRef(0)

  const cancelOwnerResourceActivation = useCallback(() => {
    requestGenerationRef.current += 1
  }, [])

  useEffect(() => cancelOwnerResourceActivation, [cancelOwnerResourceActivation])

  const activateOwnerResource = useCallback(
    async (owner: TOwner) => {
      const requestGeneration = ++requestGenerationRef.current
      try {
        let resource = await loadResourceForOwner(owner)
        if (requestGeneration !== requestGenerationRef.current) return
        if (!resource) resource = await createResourceForOwner(owner)
        if (requestGeneration !== requestGenerationRef.current) return
        if (resource) onActivateResource(resource)
      } catch (error) {
        if (requestGeneration === requestGenerationRef.current) onError(error)
      }
    },
    [createResourceForOwner, loadResourceForOwner, onActivateResource, onError]
  )

  return { activateOwnerResource, cancelOwnerResourceActivation }
}
