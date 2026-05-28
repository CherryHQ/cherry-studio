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
  const paintingRecord = painting as unknown as Record<string, unknown>
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
            />
          </div>
        ))}
    </>
  )
}

export default PaintingSettings
