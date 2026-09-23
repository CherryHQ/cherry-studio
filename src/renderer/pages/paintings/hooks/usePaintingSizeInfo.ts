import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { imageSizeSelection } from '@shared/ai/imageCanvases'

import { imageGenerationToFields } from '../form/imageGenerationToFields'
import { resolveRatio, resolveSizeLabel } from '../form/paintingSize'
import type { PaintingData } from '../model/types/paintingData'
import { tabToImageGenerationMode } from '../utils/paintingProviderMode'
import { useImageGenerationSupport } from './useImageGenerationSupport'

export interface PaintingSizeInfo {
  /** Aspect ratio of the selected size, or null when the model declares no size. */
  ratio: number | null
  /** Human-readable size label (e.g. `1024×1024`, `auto`), or undefined. */
  sizeLabel: string | undefined
  selectionLabel?: string
}

/**
 * Derives the aspect ratio + size label for a painting's selected size field from
 * the model's image-generation registry. Both the artboard prompt bar (label) and
 * the skeleton (ratio) read the same effective value, so they share this one hook
 * instead of each re-running the registry lookup. The underlying query is cached,
 * so two consumers don't double-fetch.
 */
export function usePaintingSizeInfo(painting: PaintingData): PaintingSizeInfo {
  const { t } = useTranslation()
  const registrySupport = useImageGenerationSupport(painting.providerId, painting.model)
  const configItems = useMemo(
    () => imageGenerationToFields(registrySupport, { mode: tabToImageGenerationMode(painting.mode) }),
    [registrySupport, painting.mode]
  )
  const ratio = useMemo(() => resolveRatio(painting.params, configItems), [painting.params, configItems])
  const sizeLabel = useMemo(() => resolveSizeLabel(painting.params, configItems, t), [painting.params, configItems, t])
  const selection = imageSizeSelection(
    registrySupport,
    tabToImageGenerationMode(painting.mode) ?? 'generate',
    painting.params ?? {}
  )
  const summary = [
    selection.tier,
    selection.ratio,
    selection.pixels
      ? t('paintings.model_parameters.expected_size', { size: selection.pixels.replace('x', '×') })
      : undefined
  ]
    .filter(Boolean)
    .join(' · ')
  return {
    ratio,
    sizeLabel: summary || sizeLabel,
    selectionLabel: [selection.tier, selection.ratio].filter(Boolean).join(' · ')
  }
}
