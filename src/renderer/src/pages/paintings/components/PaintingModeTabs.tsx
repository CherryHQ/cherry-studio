import { Tabs, TabsList, TabsTrigger } from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'
import { useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { useImageGenerationSupport } from '../hooks/useImageGenerationSupport'
import type { PaintingData } from '../model/types/paintingData'
import { paintingClasses } from '../PaintingPrimitives'
import {
  resolvePaintingProviderDefinition,
  resolvePaintingTabForMode,
  tabToImageGenerationMode
} from '../utils/paintingProviderMode'

interface PaintingModeTabsProps {
  painting: PaintingData
  onPaintingChange: (updates: Partial<PaintingData>) => void
}

export function PaintingModeTabs({ painting, onPaintingChange }: PaintingModeTabsProps) {
  const { t } = useTranslation()
  const definition = useMemo(() => resolvePaintingProviderDefinition(painting.providerId), [painting.providerId])
  // Registry lookup for the selected model's supported modes. `createNewApiProvider`
  // declares both `generate` and `edit` tabs unconditionally so the user could
  // pick either; the registry per-model `imageGeneration.modes` is what
  // narrows that down to what the model actually accepts (qwen-image is
  // generate-only; gpt-image-1 supports edit; imagen is generate-only; …).
  // Falls back to the unfiltered provider tabs when the model isn't in
  // the registry.
  const registrySupport = useImageGenerationSupport(painting.providerId, painting.model)

  const visibleTabs = useMemo(() => {
    const supportedModes = registrySupport?.modes ? Object.keys(registrySupport.modes) : []
    if (supportedModes.length === 0) {
      return definition.mode.tabs
    }
    const supported = new Set(supportedModes)
    const filtered = definition.mode.tabs.filter((tab) => {
      const canonical = tabToImageGenerationMode(definition.mode.tabToDbMode(tab.value))
      return canonical === undefined || supported.has(canonical)
    })
    return filtered.length > 0 ? filtered : definition.mode.tabs
  }, [registrySupport, definition])

  const currentTab = resolvePaintingTabForMode(definition, painting.mode) ?? definition.mode.defaultTab
  const currentTabStillVisible = visibleTabs.some((tab) => tab.value === currentTab)
  const fallbackTab = visibleTabs[0]?.value ?? definition.mode.defaultTab

  useEffect(() => {
    // If the current tab got filtered out (e.g. user was on 'edit', then
    // switched to an edit-incapable model), snap to the first remaining
    // tab. The mode change flows through the same patch path the user
    // would trigger by clicking a tab.
    if (!currentTabStillVisible && fallbackTab !== currentTab) {
      const nextMode = definition.mode.tabToDbMode(fallbackTab)
      if (nextMode !== painting.mode) {
        onPaintingChange({ mode: nextMode } as Partial<PaintingData>)
      }
    }
  }, [currentTabStillVisible, fallbackTab, currentTab, definition.mode, painting.mode, onPaintingChange])

  if (visibleTabs.length <= 1) {
    return null
  }

  const displayTab = currentTabStillVisible ? currentTab : fallbackTab

  return (
    <Tabs
      value={displayTab}
      onValueChange={(value) => {
        const nextMode = definition.mode.tabToDbMode(value)
        onPaintingChange({ mode: nextMode } as Partial<PaintingData>)
      }}>
      <TabsList className={paintingClasses.promptModeTabsList}>
        {visibleTabs.map((tab) => (
          <TabsTrigger key={tab.value} value={tab.value} className={cn(paintingClasses.promptModeTabsTrigger)}>
            {t(tab.labelKey)}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  )
}
