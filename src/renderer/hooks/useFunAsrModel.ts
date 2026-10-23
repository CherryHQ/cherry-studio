import { FUNASR_BUNDLE_ID } from '@shared/ai/localVoice'

import { useLocalModel } from './useLocalModel'

/** Voice-owned view of the FunASR asset lifecycle; callers do not address local-model IPC. */
export function useFunAsrModel() {
  return useLocalModel(FUNASR_BUNDLE_ID)
}
