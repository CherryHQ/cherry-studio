/**
 * Feature flags for controlling gradual rollout of new features
 * These flags can be toggled to enable/disable features without code changes
 */

interface FeatureFlags {
  /**
   * Enable unified database service for both regular chats and agent sessions
   * When enabled, uses the new DbService facade pattern
   * When disabled, uses the original implementation with conditional checks
   */
  USE_UNIFIED_DB_SERVICE: boolean
}

/**
 * Default feature flag values
 * Set to false initially for safe rollout
 */
export const featureFlags: FeatureFlags = {
  USE_UNIFIED_DB_SERVICE: false
}

/**
 * Override feature flags from environment or local storage
 * Priority order (highest to lowest):
 * 1. localStorage (runtime overrides)
 * 2. Environment variables (build-time config)
 * 3. Default values
 */
export function initializeFeatureFlags(): void {
  // First, check environment variables (build-time configuration)
  // In Vite, env vars must be prefixed with VITE_ to be exposed to the client
  // Usage: VITE_USE_UNIFIED_DB_SERVICE=true yarn dev
  if (import.meta.env?.VITE_USE_UNIFIED_DB_SERVICE === 'true') {
    featureFlags.USE_UNIFIED_DB_SERVICE = true
    console.log('[FeatureFlags] USE_UNIFIED_DB_SERVICE enabled via environment variable')
  }

  // Then check localStorage for runtime overrides (higher priority)
  // This allows toggling features without rebuilding
  try {
    const localOverrides = localStorage.getItem('featureFlags')
    if (localOverrides) {
      const overrides = JSON.parse(localOverrides)
      Object.keys(overrides).forEach((key) => {
        if (key in featureFlags) {
          featureFlags[key as keyof FeatureFlags] = overrides[key]
          console.log(`[FeatureFlags] ${key} set to ${overrides[key]} via localStorage`)
        }
      })
    }
  } catch (e) {
    console.warn('[FeatureFlags] Failed to parse feature flags from localStorage:', e)
  }

  console.log('[FeatureFlags] Current flags:', featureFlags)
}

/**
 * Update a feature flag value at runtime
 * Useful for A/B testing or gradual rollout
 */
export function setFeatureFlag(flag: keyof FeatureFlags, value: boolean): void {
  featureFlags[flag] = value

  // Persist to localStorage for consistency across app restarts
  const currentFlags = localStorage.getItem('featureFlags')
  const flags = currentFlags ? JSON.parse(currentFlags) : {}
  flags[flag] = value
  localStorage.setItem('featureFlags', JSON.stringify(flags))
}

/**
 * Get current value of a feature flag
 */
export function getFeatureFlag(flag: keyof FeatureFlags): boolean {
  return featureFlags[flag]
}

// Initialize on import
initializeFeatureFlags()
