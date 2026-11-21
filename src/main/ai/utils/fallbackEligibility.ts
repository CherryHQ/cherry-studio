import type { NativeFileSupport } from '@main/ai/runtime/aiSdk'
import type { Model } from '@shared/data/types/model'
import { isFunctionCallingModel } from '@shared/utils/model'

/**
 * Sync gates shared by retry execution and attachment budgeting (media + tools).
 *
 * Native support must use the resolved converter routing, not only intrinsic
 * model metadata. Budgeting and retry must reject the same media shapes.
 */
export function isFallbackEligibleForRequestShape(input: {
  fallbackModel: Model
  fallbackNativeFileSupport: NativeFileSupport
  primaryHasTools: boolean
  requiredNativeFileSupport: NativeFileSupport
}): boolean {
  const { fallbackModel, fallbackNativeFileSupport, primaryHasTools, requiredNativeFileSupport } = input
  for (const type of Object.keys(requiredNativeFileSupport) as Array<keyof NativeFileSupport>) {
    if (requiredNativeFileSupport[type] && !fallbackNativeFileSupport[type]) return false
  }
  if (primaryHasTools && !isFunctionCallingModel(fallbackModel)) return false
  return true
}
