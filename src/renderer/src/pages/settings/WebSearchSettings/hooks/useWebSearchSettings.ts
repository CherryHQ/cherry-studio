import { useMultiplePreferences } from '@data/hooks/usePreference'
import { CHERRYAI_PROVIDER } from '@renderer/config/providers'
import {
  buildCompressionPreferenceUpdates,
  resolveWebSearchCompressionConfig,
  WEB_SEARCH_SETTINGS_KEYS
} from '@renderer/config/webSearch/setting'
import { useAppSelector } from '@renderer/store'
import type { CompressionConfig } from '@renderer/store/websearch'
import { useCallback, useMemo } from 'react'

export const useWebSearchSettings = () => {
  const llmProviders = useAppSelector((state) => state.llm.providers)
  const [preferenceValues, updatePreferenceValues] = useMultiplePreferences(WEB_SEARCH_SETTINGS_KEYS)
  const allProviders = useMemo(() => [...llmProviders, CHERRYAI_PROVIDER], [llmProviders])
  const compressionConfig = useMemo(
    () => resolveWebSearchCompressionConfig(preferenceValues, allProviders),
    [allProviders, preferenceValues]
  )

  const setCompressionConfig = useCallback(
    async (config: CompressionConfig) => {
      await updatePreferenceValues(buildCompressionPreferenceUpdates(config))
    },
    [updatePreferenceValues]
  )

  const updateCompressionConfig = useCallback(
    async (config: Partial<CompressionConfig>) => {
      await updatePreferenceValues(
        buildCompressionPreferenceUpdates({
          ...compressionConfig,
          ...config
        })
      )
    },
    [compressionConfig, updatePreferenceValues]
  )

  return {
    searchWithTime: preferenceValues.searchWithTime,
    maxResults: preferenceValues.maxResults,
    excludeDomains: preferenceValues.excludeDomains,
    compressionConfig,
    setSearchWithTime: (searchWithTime: boolean) => updatePreferenceValues({ searchWithTime }),
    setMaxResults: (maxResults: number) => updatePreferenceValues({ maxResults }),
    setExcludeDomains: (excludeDomains: string[]) => updatePreferenceValues({ excludeDomains }),
    setCompressionConfig,
    updateCompressionConfig
  }
}
