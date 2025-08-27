import { SYSTEM_PROVIDERS_CONFIG } from '@renderer/config/providers'
import { isSystemProvider, Provider, SystemProviderId, SystemProviderIds } from '@renderer/types'

/**
 * Clean up provider data by removing duplicates and adding missing system providers
 *
 * Priority rules for duplicate system providers:
 * 1. Provider with non-empty apiKey takes precedence
 * 2. If both have empty apiKey, enabled provider takes precedence
 * 3. Otherwise, keep the first occurrence
 *
 * @param providers - Array of providers to clean up
 * @returns Object containing cleaned providers and whether changes were made
 */
export function cleanupProviders(providers: Provider[]): {
  cleanedProviders: Provider[]
  hasChanges: boolean
} {
  const systemProviderIds = Object.keys(SystemProviderIds) as SystemProviderId[]
  const cleanedProviders: Provider[] = []
  const processedIds = new Set<string>()
  let hasChanges = false

  // Remove duplicates with priority logic
  providers.forEach((p) => {
    if (!processedIds.has(p.id)) {
      cleanedProviders.push(p)
      processedIds.add(p.id)
      return
    }

    // Handle duplicate system providers
    if (!isSystemProvider(p)) {
      hasChanges = true // Found duplicate non-system provider (should not happen, but mark as change)
      return
    }

    const existingIndex = cleanedProviders.findIndex((existing) => existing.id === p.id)
    if (existingIndex === -1) return

    const existingProvider = cleanedProviders[existingIndex]
    if (shouldReplaceProvider(p, existingProvider)) {
      cleanedProviders[existingIndex] = p
      hasChanges = true
    } else {
      hasChanges = true // Found duplicate but didn't replace
    }
  })

  // Add missing system providers
  const existingProviderIds = cleanedProviders.map((p) => p.id)
  const missingSystemProviderIds = systemProviderIds.filter((id) => !existingProviderIds.includes(id))

  missingSystemProviderIds.forEach((id: SystemProviderId) => {
    const systemProvider = SYSTEM_PROVIDERS_CONFIG[id]
    cleanedProviders.push({ ...systemProvider })
    hasChanges = true
  })

  return {
    cleanedProviders,
    hasChanges
  }
}

/**
 * Determine if current provider should replace existing provider
 *
 * @param current - Current provider being evaluated
 * @param existing - Existing provider in the list
 * @returns true if current should replace existing
 */
function shouldReplaceProvider(current: Provider, existing: Provider): boolean {
  const currentHasApiKey = current.apiKey && current.apiKey.trim() !== ''
  const existingHasApiKey = existing.apiKey && existing.apiKey.trim() !== ''

  // Priority: 1) has apiKey, 2) is enabled
  if (currentHasApiKey && !existingHasApiKey) {
    return true
  }

  if (!currentHasApiKey && !existingHasApiKey && current.enabled && !existing.enabled) {
    return true
  }

  return false
}
