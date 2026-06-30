import {
  ASSISTANT_CATALOG_MY_TAB,
  type AssistantCatalogPreset,
  type AssistantCatalogTab,
  buildAssistantCatalogTabs,
  filterAssistantCatalogPresets,
  getAssistantPresetCatalogKey,
  toCreateAssistantDtoFromCatalogPreset,
  useAssistantCatalogPresets
} from '@renderer/hooks/useAssistantCatalogPresets'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

export {
  ASSISTANT_CATALOG_MY_TAB,
  type AssistantCatalogPreset,
  type AssistantCatalogTab,
  buildAssistantCatalogTabs,
  filterAssistantCatalogPresets,
  getAssistantPresetCatalogKey,
  toCreateAssistantDtoFromCatalogPreset
}

interface UseAssistantPresetCatalogOptions {
  activeTab: string
  search: string
  mineCount: number
  enabled: boolean
}

export function useAssistantPresetCatalog({ activeTab, search, mineCount, enabled }: UseAssistantPresetCatalogOptions) {
  const { t } = useTranslation()
  const { presets } = useAssistantCatalogPresets({ enabled })

  const tabs = useMemo(
    () => buildAssistantCatalogTabs(presets, mineCount, t('library.assistant_catalog.mine')),
    [mineCount, presets, t]
  )

  const filteredPresets = useMemo(
    () => filterAssistantCatalogPresets(presets, activeTab, search),
    [activeTab, presets, search]
  )

  return {
    tabs,
    presets: filteredPresets
  }
}
