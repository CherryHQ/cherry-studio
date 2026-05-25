import { InfoTooltip } from '@cherrystudio/ui'
import type { FC } from 'react'
import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { imageGenerationToFields } from '../form/imageGenerationToFields'
import { PaintingFieldRenderer } from '../form/PaintingFieldRenderer'
import { useImageGenerationSupport } from '../hooks/useImageGenerationSupport'
import { usePaintingModelCatalog } from '../hooks/usePaintingModelCatalog'
import { usePaintingProviderOptions } from '../hooks/usePaintingProviderOptions'
import { usePaintingProviderRuntime } from '../hooks/usePaintingProviderRuntime'
import type { PaintingData } from '../model/types/paintingData'
import type { BaseConfigItem } from '../providers/shared/providerFieldSchema'
import {
  resolvePaintingProviderDefinition,
  resolvePaintingTabForMode,
  tabToImageGenerationMode
} from '../utils/paintingProviderMode'
import { PaintingSettingsExtras } from './PaintingProviderViews'
import PaintingSectionTitle from './PaintingSectionTitle'

function resolveItemOptions(item: BaseConfigItem, painting: Record<string, unknown>) {
  return typeof item.options === 'function' ? item.options(item, painting) : (item.options ?? [])
}

function shouldRenderConfigItem(item: BaseConfigItem, painting: Record<string, unknown>) {
  if (item.condition && !item.condition(painting)) {
    return false
  }

  if (item.type === 'sizeChips' && resolveItemOptions(item, painting).length === 0) {
    return false
  }

  return true
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
  // Always call the hook (rules-of-hooks); it stays disabled when the
  // provider doesn't opt in or has no model selected.
  const registrySupport = useImageGenerationSupport(
    providerDefinition.useRegistryForm ? painting.providerId : undefined,
    providerDefinition.useRegistryForm ? painting.model : undefined
  )
  const configItems = useMemo(() => {
    const ownFields = providerDefinition.fields.byTab[tab] || []
    if (providerDefinition.useRegistryForm) {
      // Current tab feeds the per-mode merge so registry's
      // `modeSchemas[currentMode]` overrides extend the top-level shape
      // (ideogram remix gains `imageWeight`, upscale gains `resemblance` etc.).
      const derived = imageGenerationToFields(registrySupport, {
        keyMap: providerDefinition.registryKeyMap,
        mode: tabToImageGenerationMode(providerDefinition.mode.tabToDbMode(tab))
      })
      // Fall back to the provider's own fields on a registry miss so the page
      // never renders empty during the first load or for unknown models.
      if (derived.length === 0) return ownFields
      // When the provider declares `useRegistryForm` AND ships its own
      // `fields.byTab`, treat the byTab list as "extra fields" appended
      // after the registry-derived ones. Lets a provider compose registry
      // size/batch/etc. with vendor-specific UI knobs that don't fit the
      // standard registry schema (dmxapi's `style_type`, `autoCreate`).
      return [...derived, ...ownFields]
    }
    return ownFields
  }, [
    providerDefinition.useRegistryForm,
    providerDefinition.registryKeyMap,
    providerDefinition.fields.byTab,
    registrySupport,
    tab
  ])

  const handleImageUpload = useCallback(
    (key: string, file: File) => {
      providerDefinition.image?.onUpload?.({
        key,
        file,
        patchPainting: onConfigChange as (updates: Partial<PaintingData>) => void,
        painting
      })
    },
    [onConfigChange, painting, providerDefinition.image]
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
        .filter((item) => shouldRenderConfigItem(item, paintingRecord))
        .map((item) => (
          <div key={item.key ?? `${item.type}-${item.title ?? ''}`}>
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
