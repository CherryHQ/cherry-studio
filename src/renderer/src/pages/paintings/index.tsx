import './painting-theme.css'

import { cn } from '@cherrystudio/ui/lib/utils'
import Scrollbar from '@renderer/components/Scrollbar'
import { type FC, useCallback, useMemo, useState } from 'react'

import PaintingModelSelector from './components/PaintingModelSelector'
import PaintingPromptBar from './components/PaintingPromptBar'
import { PaintingPromptLeadingActions } from './components/PaintingPromptLeadingActions'
import { PaintingArtboard, PaintingProviderHeaderActions } from './components/PaintingProviderViews'
import PaintingSettings, { PaintingSettingsHeader } from './components/PaintingSettings'
import PaintingStrip from './components/PaintingStrip'
import { usePaintingModelCatalog } from './components/usePaintingModelCatalog'
import { useInitialPaintingProvider } from './hooks/useInitialPaintingProvider'
import { usePaintingGenerationSubmit } from './hooks/usePaintingGenerationSubmit'
import { usePaintingInitialSelection } from './hooks/usePaintingInitialSelection'
import { usePaintingList } from './hooks/usePaintingList'
import { usePaintingModelSwitch } from './hooks/usePaintingModelSwitch'
import { usePaintingProviderOptions } from './hooks/usePaintingProviderOptions'
import type { PaintingData } from './model/types/paintingData'
import { paintingClasses } from './PaintingPrimitives'
import { resolvePaintingProviderDefinition } from './utils/paintingProviderMode'

const PaintingPage: FC = () => {
  const providerOptions = usePaintingProviderOptions()
  const { initialProviderId, initialProviderDefinition } = useInitialPaintingProvider(providerOptions)

  const [isParametersOpen, setIsParametersOpen] = useState(true)
  const [currentPainting, setCurrentPainting] = useState<PaintingData>(() =>
    initialProviderDefinition.mode.createPaintingData({ tab: initialProviderDefinition.mode.defaultTab })
  )

  const patchPainting = useCallback((updates: Partial<PaintingData>) => {
    setCurrentPainting((current) => ({ ...current, ...updates }) as PaintingData)
  }, [])

  usePaintingInitialSelection({ currentPainting, setCurrentPainting })

  const currentProviderId = currentPainting.providerId || initialProviderId
  const currentProviderDefinition = useMemo(
    () => resolvePaintingProviderDefinition(currentProviderId),
    [currentProviderId]
  )

  const modelCatalog = usePaintingModelCatalog({
    providerOptions,
    painting: currentPainting,
    shouldPrefetch: false
  })

  const {
    generating,
    submit,
    cancel: cancelGeneration
  } = usePaintingGenerationSubmit({
    painting: currentPainting,
    onPaintingChange: setCurrentPainting,
    selectorData: modelCatalog.selectorData,
    ensureCurrentCatalog: modelCatalog.ensureCurrentCatalog
  })

  const switchModel = usePaintingModelSwitch({
    painting: currentPainting,
    onPaintingChange: patchPainting,
    currentModelOptions: modelCatalog.currentModelOptions,
    ensureProviderCatalog: modelCatalog.ensureProviderCatalog
  })

  const list = usePaintingList({
    painting: currentPainting,
    setCurrentPainting,
    currentProviderDefinition,
    modelOptions: modelCatalog.currentModelOptions,
    cancelGeneration
  })

  const onCancel = useCallback(() => cancelGeneration(currentPainting.id), [cancelGeneration, currentPainting.id])

  return (
    <div className={paintingClasses.page}>
      <div id="content-container" className={paintingClasses.content}>
        <div className="flex h-full flex-1 flex-col bg-white dark:bg-background">
          <div className={paintingClasses.frame}>
            <div className={paintingClasses.surface}>
              <div
                className={cn(
                  paintingClasses.panel,
                  isParametersOpen ? paintingClasses.panelVisible : paintingClasses.panelHidden
                )}>
                <div className={paintingClasses.panelHeader}>
                  <PaintingSettingsHeader
                    actions={<PaintingProviderHeaderActions providerId={currentProviderId} />}
                    onClose={() => setIsParametersOpen(false)}
                  />
                </div>
                <div className={paintingClasses.panelBody}>
                  <Scrollbar className={paintingClasses.panelScroll}>
                    <PaintingSettings painting={currentPainting} onConfigChange={patchPainting} />
                  </Scrollbar>
                </div>
              </div>

              <div className={paintingClasses.centerPane}>
                <PaintingArtboard painting={currentPainting} isLoading={generating} onCancel={onCancel} />
              </div>

              <PaintingStrip
                selectedPaintingId={currentPainting.id}
                onDeletePainting={list.remove}
                onSelectPainting={setCurrentPainting}
                onAddPainting={list.add}
              />
            </div>
          </div>

          <PaintingPromptBar
            painting={currentPainting}
            generating={generating}
            leadingActions={
              <PaintingPromptLeadingActions
                painting={currentPainting}
                onPaintingChange={patchPainting}
                onToggleParameters={() => setIsParametersOpen((open) => !open)}
              />
            }
            modelSelector={<PaintingModelSelector painting={currentPainting} onSelect={switchModel} />}
            onPromptChange={(prompt) => patchPainting({ prompt } as Partial<PaintingData>)}
            onGenerate={submit}
          />
        </div>
      </div>
    </div>
  )
}

export default PaintingPage
