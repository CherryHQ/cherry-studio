import type { FC } from 'react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { type ImageOperation, ImageOperationSchema, resolveImageCapability } from '@cherrystudio/provider-registry'
import { Button } from '@cherrystudio/ui'
import { InfoTooltip } from '@cherrystudio/ui'

import { type BaseConfigItem, isOptionsConfigItem } from '../form/baseConfigItem'
import { imageGenerationToFields } from '../form/imageGenerationToFields'
import { PaintingFieldRenderer } from '../form/PaintingFieldRenderer'
import { useImageGenerationSupport } from '../hooks/useImageGenerationSupport'
import type { PaintingData } from '../model/types/paintingData'
import { computeImageFieldReset } from '../utils/computeModelFieldReset'
import { paintingOperation } from '../utils/paintingProviderMode'
import PaintingSectionTitle from './PaintingSectionTitle'

const OPERATION_LABELS: Record<ImageOperation, string> = {
  generate: 'paintings.mode.generate',
  remix: 'paintings.mode.remix',
  upscale: 'paintings.mode.upscale'
}

function resolveItemOptions(item: BaseConfigItem, painting: Record<string, unknown>) {
  if (!isOptionsConfigItem(item)) return []
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
  hasImages?: boolean
  onConfigChange: (updates: Partial<PaintingData>) => void
  onGenerateRandomSeed?: (key: string) => void
}

const PaintingSettings: FC<PaintingSettingsProps> = ({
  painting,
  onConfigChange,
  onGenerateRandomSeed,
  hasImages = Boolean(painting.inputFiles?.length)
}) => {
  const { t } = useTranslation()
  // Only canonical params participate in submission.
  const paintingParams = painting.params ?? {}
  const registrySupport = useImageGenerationSupport(painting.providerId, painting.model)
  const operation = paintingOperation(painting.mode)
  const operations = ImageOperationSchema.options.filter(
    (candidate) => resolveImageCapability(registrySupport, candidate, hasImages).kind === 'supported'
  )
  const configItems = useMemo(
    () =>
      imageGenerationToFields(registrySupport, {
        operation: paintingOperation(painting.mode),
        hasImages
      }),
    [registrySupport, painting.mode, hasImages]
  )

  return (
    <>
      {operations.some((candidate) => candidate !== 'generate') && (
        <div className="flex flex-wrap gap-2">
          {operations.map((candidate) => (
            <Button
              key={candidate}
              type="button"
              size="sm"
              variant={operation === candidate ? 'default' : 'outline'}
              aria-pressed={operation === candidate}
              onClick={() => {
                const fields = imageGenerationToFields(registrySupport, { operation: candidate, hasImages })
                onConfigChange({
                  mode: candidate,
                  params: { ...paintingParams, ...computeImageFieldReset(fields, paintingParams) }
                })
              }}>
              {t(OPERATION_LABELS[candidate])}
            </Button>
          ))}
        </div>
      )}
      {configItems
        .filter((item) => shouldRenderConfigItem(item, paintingParams))
        .map((item) => (
          <div key={item.key ?? `${item.type}-${item.title ?? ''}`}>
            {item.title && (
              <PaintingSectionTitle>
                {t(item.title)}
                {/* range fields (e.g. numImages) interpolate their actual {{min}}-{{max}} */}
                {item.tooltip && (
                  <InfoTooltip
                    content={t(item.tooltip, item.type === 'slider' ? { min: item.min, max: item.max } : undefined)}
                  />
                )}
              </PaintingSectionTitle>
            )}
            <PaintingFieldRenderer
              item={item}
              painting={paintingParams}
              onChange={(updates) => onConfigChange({ params: { ...paintingParams, ...updates } })}
              onGenerateRandomSeed={onGenerateRandomSeed}
            />
          </div>
        ))}
    </>
  )
}

export default PaintingSettings
