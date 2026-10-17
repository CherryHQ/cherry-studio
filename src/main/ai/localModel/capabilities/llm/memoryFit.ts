import type { LocalChatModelFit } from '@shared/data/presets/localModel'

import type { ChatModelRuntime } from '../../catalog/types'

// macOS shares memory between the CPU and GPU, so the system and other apps keep the rest.
const RECOMMENDED_SHARE = 0.5
const RUNNABLE_SHARE = 0.65

/**
 * Recommended when the model fits its full context in half of memory; runnable when it fits
 * an 8k context in about two thirds, where llama.cpp shrinks the context to what fits.
 */
export function chatModelMemoryFit(runtime: ChatModelRuntime, totalMemoryBytes: number): LocalChatModelFit {
  if (runtime.memoryBytes.maxContext <= totalMemoryBytes * RECOMMENDED_SHARE) return 'recommended'
  if (runtime.memoryBytes.minContext <= totalMemoryBytes * RUNNABLE_SHARE) return 'runnable'
  return 'not_recommended'
}
