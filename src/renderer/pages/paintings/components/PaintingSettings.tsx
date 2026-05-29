import { InfoTooltip } from '@cherrystudio/ui'
import type { FC } from 'react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import type { BaseConfigItem } from '../form/baseConfigItem'
import { imageGenerationToFields } from '../form/imageGenerationToFields'
import { PaintingFieldRenderer } from '../form/PaintingFieldRenderer'
import { useImageGenerationSupport } from '../hooks/useImageGenerationSupport'
import type { PaintingData } from '../model/types/paintingData'
import { tabToImageGenerationMode } from '../utils/paintingProviderMode'
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
  // The form's reads/writes target `painting.params` — the canonical-name bag
  // that `canonicalGenerate` partitions into AI SDK args vs provider bag at
  // request time. Top-level PaintingData fields are not visible to the wire.
  const paintingParams = painting.params ?? {}
  const registrySupport = useImageGenerationSupport(painting.providerId, painting.model)
  const configItems = useMemo(
    () =>
      imageGenerationToFields(registrySupport, {
        mode: tabToImageGenerationMode(painting.mode)
      }),
    [registrySupport, painting.mode]
  )

  return (
    <>
      {configItems
        .filter((item) => shouldRenderConfigItem(item, paintingParams))
        .map((item) => (
          <div key={item.key ?? `${item.type}-${item.title ?? ''}`}>
            {item.title && (
              <PaintingSectionTitle>
                {t(item.title)}
                {/* range fields (e.g. numImages) interpolate their actual {{min}}-{{max}} */}
                {item.tooltip && <InfoTooltip content={t(item.tooltip, { min: item.min, max: item.max })} />}
              </PaintingSectionTitle>
            )}
            <PaintingFieldRenderer
              item={item}
              painting={paintingParams}
              onChange={(updates) =>
                onConfigChange({ params: { ...paintingParams, ...updates } } as Partial<PaintingData>)
              }
              onGenerateRandomSeed={onGenerateRandomSeed}
            />
          </div>
        ))}
    </>
  )
}

export default PaintingSettings
