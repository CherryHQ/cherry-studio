/**
 * useMemoryCapabilities — returns the active memory provider's capabilities,
 * cached for the lifetime of the component.
 *
 * Returns null while the capabilities are loading, or if the provider is 'off'.
 */

import type { MemoryProviderCapabilities } from '@shared/memory'
import { useEffect, useState } from 'react'

import { memoryService } from '../services/MemoryService'

export function useMemoryCapabilities(): MemoryProviderCapabilities | null {
  const [capabilities, setCapabilities] = useState<MemoryProviderCapabilities | null>(null)

  useEffect(() => {
    let cancelled = false
    memoryService
      .capabilities()
      .then((caps) => {
        if (!cancelled) setCapabilities(caps)
      })
      .catch(() => {
        if (!cancelled) setCapabilities(null)
      })
    return () => {
      cancelled = true
    }
  }, [])

  return capabilities
}
