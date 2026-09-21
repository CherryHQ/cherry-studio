import { useLocalModel } from '@renderer/hooks/useLocalModel'
import { LOCAL_MODEL_BUNDLE_BY_CAPABILITY } from '@shared/data/presets/localModel'

/** Voice-owned view of the FunASR asset lifecycle; callers do not address local-model IPC. */
export function useFunAsrModel() {
  return useLocalModel(LOCAL_MODEL_BUNDLE_BY_CAPABILITY.asr)
}
