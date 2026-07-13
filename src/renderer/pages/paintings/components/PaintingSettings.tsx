import { InfoTooltip } from '@cherrystudio/ui'
import type { FC } from 'react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import type { BaseConfigItem } from '../form/baseConfigItem'
import { imageGenerationToFields } from '../form/imageGenerationToFields'
import { PaintingFieldRenderer } from '../form/PaintingFieldRenderer'
import { useImageGenerationSupport } from '../hooks/useImageGenerationSupport'
import type { ComposerDraft } from '../model/composerDraft'
import { tabToImageGenerationMode } from '../utils/paintingProviderMode'
import PaintingSectionTitle from './PaintingSectionTitle'

function resolveItemOptions(item: BaseConfigItem, params: Record<string, unknown>) {
  return typeof item.options === 'function' ? item.options(item, params) : (item.options ?? [])
}

function shouldRenderConfigItem(item: BaseConfigItem, params: Record<string, unknown>) {
  if (item.condition && !item.condition(params)) {
    return false
  }
  if (item.type === 'sizeChips' && resolveItemOptions(item, params).length === 0) {
    return false
  }
  return true
}

export interface PaintingSettingsProps {
  draft: ComposerDraft
  onConfigChange: (updates: Partial<ComposerDraft>) => void
  onGenerateRandomSeed?: (key: string) => void
}

const PaintingSettings: FC<PaintingSettingsProps> = ({ draft, onConfigChange, onGenerateRandomSeed }) => {
  const { t } = useTranslation()
  // The form's reads/writes target `draft.params` — the canonical-name bag that
  // `canonicalGenerate` partitions into AI SDK args vs provider bag at request time.
  const params = draft.params
  const registrySupport = useImageGenerationSupport(draft.providerId, draft.model)
  const configItems = useMemo(
    () =>
      imageGenerationToFields(registrySupport, {
        mode: tabToImageGenerationMode(draft.mode)
      }),
    [registrySupport, draft.mode]
  )

  return (
    <>
      {configItems
        .filter((item) => shouldRenderConfigItem(item, params))
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
              painting={params}
              onChange={(updates) => onConfigChange({ params: { ...params, ...updates } })}
              onGenerateRandomSeed={onGenerateRandomSeed}
            />
          </div>
        ))}
    </>
  )
}

export default PaintingSettings
