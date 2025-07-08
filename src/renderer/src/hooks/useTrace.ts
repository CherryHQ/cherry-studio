import { useAppDispatch, useAppSelector } from '@renderer/store'
import { setEnabled, setProvider, updateLangfuse } from '@renderer/store/trace'
import { LangfuseSettings, TraceProviderType } from '@renderer/types/trace'

export function useTrace() {
  const trace = useAppSelector((state) => state.trace)
  const dispatch = useAppDispatch()

  return {
    ...trace,
    setEnabled: (enabled: boolean) => dispatch(setEnabled(enabled)),
    setProvider: (provider: TraceProviderType) => dispatch(setProvider(provider)),
    updateLangfuse: (langfuse: Partial<LangfuseSettings>) => dispatch(updateLangfuse(langfuse))
  }
}
