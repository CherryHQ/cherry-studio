import { Tabs, TabsList, TabsTrigger } from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import type { PaintingData } from '../model/types/paintingData'
import { paintingClasses } from '../PaintingPrimitives'
import { resolvePaintingProviderDefinition, resolvePaintingTabForMode } from '../utils/paintingProviderMode'

interface PaintingModeTabsProps {
  painting: PaintingData
  onPaintingChange: (updates: Partial<PaintingData>) => void
}

export function PaintingModeTabs({ painting, onPaintingChange }: PaintingModeTabsProps) {
  const { t } = useTranslation()
  const definition = useMemo(() => resolvePaintingProviderDefinition(painting.providerId), [painting.providerId])

  if (definition.mode.tabs.length <= 1) {
    return null
  }

  const currentTab = resolvePaintingTabForMode(definition, painting.mode) ?? definition.mode.defaultTab

  return (
    <Tabs
      value={currentTab}
      onValueChange={(value) => {
        const nextMode = definition.mode.tabToDbMode(value)
        onPaintingChange({ mode: nextMode } as Partial<PaintingData>)
      }}>
      <TabsList className={paintingClasses.promptModeTabsList}>
        {definition.mode.tabs.map((tab) => (
          <TabsTrigger key={tab.value} value={tab.value} className={cn(paintingClasses.promptModeTabsTrigger)}>
            {t(tab.labelKey)}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  )
}
