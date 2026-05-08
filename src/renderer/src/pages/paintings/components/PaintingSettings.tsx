import { InfoTooltip } from '@cherrystudio/ui'
import type { FC, ReactNode } from 'react'
import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { PaintingFieldRenderer } from '../form/PaintingFieldRenderer'
import { usePaintingModelCatalog } from '../hooks/usePaintingModelCatalog'
import { usePaintingProviderOptions } from '../hooks/usePaintingProviderOptions'
import { usePaintingProviderRuntime } from '../hooks/usePaintingProviderRuntime'
import type { PaintingData } from '../model/types/paintingData'
import { resolvePaintingProviderDefinition, resolvePaintingTabForMode } from '../utils/paintingProviderMode'
import { PaintingSettingsExtras } from './PaintingProviderViews'
import PaintingSectionTitle from './PaintingSectionTitle'

export function PaintingSettingsHeader({
  actions
}: {
  /** Inline with title: e.g. provider “Learn more” before the close button. */
  actions?: ReactNode
}) {
  const { t } = useTranslation()

  return (
    <div className="flex w-full min-w-0 items-center justify-between gap-2">
      <span className="min-w-0 truncate text-foreground text-xs tracking-wider">{t('paintings.parameters')}</span>
      <div className="flex shrink-0 flex-nowrap items-center gap-x-1">{actions}</div>
    </div>
  )
}

export interface PaintingSettingsProps {
  painting: PaintingData
  onConfigChange: (updates: Partial<PaintingData>) => void
  onGenerateRandomSeed?: (key: string) => void
}

const PaintingSettings: FC<PaintingSettingsProps> = ({ painting, onConfigChange, onGenerateRandomSeed }) => {
  const { t } = useTranslation()
  const paintingRecord = painting as unknown as Record<string, unknown>

  const providerOptions = usePaintingProviderOptions()
  const { provider } = usePaintingProviderRuntime(painting.providerId)
  const providerDefinition = useMemo(
    () => resolvePaintingProviderDefinition(painting.providerId),
    [painting.providerId]
  )
  const tab = useMemo(
    () => resolvePaintingTabForMode(providerDefinition, painting.mode) ?? providerDefinition.mode.defaultTab,
    [painting.mode, providerDefinition]
  )
  const isLoading = painting.generationStatus === 'running'
  const { currentModelOptions, selectedModelOption } = usePaintingModelCatalog({
    providerOptions,
    painting,
    shouldPrefetch: false
  })
  const configItems = useMemo(() => providerDefinition.fields.byTab[tab] || [], [providerDefinition.fields.byTab, tab])

  const handleImageUpload = useCallback(
    (key: string, file: File) => {
      providerDefinition.image?.onUpload?.({
        key,
        file,
        patchPainting: onConfigChange as (updates: Partial<PaintingData>) => void
      })
    },
    [onConfigChange, providerDefinition.image]
  )

  const getImagePreviewSrc = useCallback(
    (key: string) => {
      return providerDefinition.image?.getPreviewSrc?.({
        key,
        painting
      })
    },
    [painting, providerDefinition.image]
  )

  const onImageUpload = providerDefinition.image?.onUpload ? handleImageUpload : undefined
  const imagePreviewResolver = providerDefinition.image?.getPreviewSrc ? getImagePreviewSrc : undefined

  return (
    <>
      {configItems
        .filter((item) => !item.condition || item.condition(paintingRecord))
        .map((item, index) => (
          <div key={item.key || index}>
            {item.title && (
              <PaintingSectionTitle>
                {t(item.title)}
                {item.tooltip && <InfoTooltip content={t(item.tooltip)} />}
              </PaintingSectionTitle>
            )}
            <PaintingFieldRenderer
              item={item}
              painting={paintingRecord}
              onChange={(updates) => onConfigChange(updates as Partial<PaintingData>)}
              onGenerateRandomSeed={onGenerateRandomSeed}
              onImageUpload={onImageUpload ? (key, file) => onImageUpload(key, file) : undefined}
              imagePreviewSrc={imagePreviewResolver ? imagePreviewResolver(item.key || '') : undefined}
              imagePlaceholder={providerDefinition.image?.placeholder}
            />
          </div>
        ))}

      <PaintingSettingsExtras
        provider={provider}
        painting={painting}
        modelOptions={currentModelOptions}
        selectedModelOption={selectedModelOption}
        isLoading={isLoading}
        patchPainting={onConfigChange}
        tab={tab}
      />
    </>
  )
}

export default PaintingSettings
