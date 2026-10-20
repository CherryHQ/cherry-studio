import type { NativeFileSupport } from '@main/ai/runtime/aiSdk'
import type { Model } from '@shared/data/types/model'
import { isAudioModel, isFunctionCallingModel, isVideoModel, isVisionModel } from '@shared/utils/model'

/**
 * Sync gates shared by retry execution and attachment budgeting (media + tools).
 *
 * The PDF gate needs the fallback's ROUTED support (`supportsNativePdf` on its
 * resolved endpoint's provider id) rather than a model capability — first-party
 * providers only, per converter. Callers must derive it exactly like
 * `resolveNativeFileSupport` does, so budget-time exclusion matches the
 * fallback-time rejection; the resolved check there remains the backstop.
 */
export function isFallbackEligibleForRequestShape(input: {
  fallbackModel: Model
  fallbackSupportsNativePdf: boolean
  primaryHasTools: boolean
  requiredNativeFileSupport: NativeFileSupport
}): boolean {
  const { fallbackModel, fallbackSupportsNativePdf, primaryHasTools, requiredNativeFileSupport } = input
  if (requiredNativeFileSupport.pdf && !fallbackSupportsNativePdf) return false
  if (requiredNativeFileSupport.image && !isVisionModel(fallbackModel)) return false
  if (requiredNativeFileSupport.video && !isVideoModel(fallbackModel)) return false
  if (requiredNativeFileSupport.audio && !isAudioModel(fallbackModel)) return false
  if (primaryHasTools && !isFunctionCallingModel(fallbackModel)) return false
  return true
}
