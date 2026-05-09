import './painting-theme.css'

import Scrollbar from '@renderer/components/Scrollbar'
import { type FC, useCallback, useMemo, useState } from 'react'

import PaintingModelSelector from './components/PaintingModelSelector'
import { PaintingModeTabs } from './components/PaintingModeTabs'
import PaintingPromptBar from './components/PaintingPromptBar'
import { PaintingArtboard, PaintingProviderHeaderActions } from './components/PaintingProviderViews'
import PaintingSettings, { PaintingSettingsHeader } from './components/PaintingSettings'
import PaintingStrip from './components/PaintingStrip'
import { usePaintingGenerationSubmit } from './hooks/usePaintingGenerationSubmit'
import { usePaintingInitialProvider } from './hooks/usePaintingInitialProvider'
import { usePaintingInitialSelection } from './hooks/usePaintingInitialSelection'
import { usePaintingList } from './hooks/usePaintingList'
import { usePaintingModelCatalog } from './hooks/usePaintingModelCatalog'
import { usePaintingModelSwitch } from './hooks/usePaintingModelSwitch'
import { usePaintingProviderOptions } from './hooks/usePaintingProviderOptions'
import type { PaintingData } from './model/types/paintingData'
import { paintingClasses } from './PaintingPrimitives'
import { resolvePaintingProviderDefinition } from './utils/paintingProviderMode'

const PaintingPage: FC = () => {
  const providerOptions = usePaintingProviderOptions()
  const { initialProviderId, initialProviderDefinition } = usePaintingInitialProvider(providerOptions)

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
              <div className={paintingClasses.panel}>
                <div className={paintingClasses.panelHeader}>
                  <PaintingSettingsHeader actions={<PaintingProviderHeaderActions providerId={currentProviderId} />} />
                </div>
                <div className={paintingClasses.panelModelSelector}>
                  <PaintingModelSelector
                    className={paintingClasses.panelModelSelectorTrigger}
                    painting={currentPainting}
                    onSelect={switchModel}
                  />
                </div>
                <div className={paintingClasses.panelBody}>
                  <Scrollbar className={paintingClasses.panelScroll}>
                    <PaintingSettings painting={currentPainting} onConfigChange={patchPainting} />
                  </Scrollbar>
                </div>
              </div>

              <div className={paintingClasses.centerPane}>
                <div className={paintingClasses.tabsWrap}>
                  <PaintingModeTabs painting={currentPainting} onPaintingChange={patchPainting} />
                </div>
                <PaintingArtboard painting={currentPainting} isLoading={generating} onCancel={onCancel} />
                <PaintingPromptBar
                  painting={currentPainting}
                  generating={generating}
                  onPromptChange={(prompt) => patchPainting({ prompt } as Partial<PaintingData>)}
                  onGenerate={submit}
                />
              </div>

              <PaintingStrip
                selectedPaintingId={currentPainting.id}
                onDeletePainting={list.remove}
                onSelectPainting={setCurrentPainting}
                onAddPainting={list.add}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default PaintingPage
