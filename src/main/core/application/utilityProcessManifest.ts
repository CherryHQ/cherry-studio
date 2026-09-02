import type { UtilityProcessManifest } from '@main/core/utilityProcess/types'

/**
 * Every utility process the app can run, installed once at boot (before `registerAll`).
 * Consumers add their `defineUtilityProcess()` result here; V1 ships no consumers.
 */
export const utilityProcessManifest: UtilityProcessManifest = Object.freeze([])
