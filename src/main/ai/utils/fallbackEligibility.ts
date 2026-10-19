import type { NativeFileSupport } from '@main/ai/runtime/aiSdk'
import type { Model } from '@shared/data/types/model'
import { isAudioModel, isFunctionCallingModel, isVideoModel, isVisionModel } from '@shared/utils/model'

/** Sync gates shared by retry execution and attachment budgeting (media + tools). */
export function isFallbackEligibleForRequestShape(input: {
  fallbackModel: Model
  primaryHasTools: boolean
  requiredNativeFileSupport: NativeFileSupport
}): boolean {
  const { fallbackModel, primaryHasTools, requiredNativeFileSupport } = input
  if (requiredNativeFileSupport.image && !isVisionModel(fallbackModel)) return false
  if (requiredNativeFileSupport.video && !isVideoModel(fallbackModel)) return false
  if (requiredNativeFileSupport.audio && !isAudioModel(fallbackModel)) return false
  if (primaryHasTools && !isFunctionCallingModel(fallbackModel)) return false
  return true
}
