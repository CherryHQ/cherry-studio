import { LOCAL_MODEL_BUNDLE_BY_CAPABILITY } from '@shared/data/presets/localModel'

import { useLocalModel } from './useLocalModel'

/** Voice-owned view of the FunASR asset lifecycle; callers do not address local-model IPC. */
export function useFunAsrModel() {
  return useLocalModel(LOCAL_MODEL_BUNDLE_BY_CAPABILITY.asr)
}
