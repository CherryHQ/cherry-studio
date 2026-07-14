import { InfoTooltip } from '@cherrystudio/ui'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'

import CreationSectionTitle from '../CreationSectionTitle'
import type { BaseConfigItem } from '../form/baseConfigItem'
import { PaintingFieldRenderer } from '../form/PaintingFieldRenderer'

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

export interface CreationParamsFormProps {
  /** Registry-derived form fields (`imageGenerationToFields` / `videoGenerationToFields`). */
  items: BaseConfigItem[]
  /** The canonical-name param bag the fields read from. */
  params: Record<string, unknown>
  /** Flat canonical-key updates, e.g. `{ size: '1024x1024' }` — merging is the caller's shape. */
  onChange: (updates: Record<string, unknown>) => void
  onGenerateRandomSeed?: (key: string) => void
}

/**
 * The generation parameter list shared by the Creation page's image and video
 * modes. Reads/writes target the canonical param bag that main partitions into
 * AI SDK args vs the provider bag at request time.
 */
const CreationParamsForm: FC<CreationParamsFormProps> = ({ items, params, onChange, onGenerateRandomSeed }) => {
  const { t } = useTranslation()

  return (
    <>
      {items
        .filter((item) => shouldRenderConfigItem(item, params))
        .map((item) => (
          <div key={item.key ?? `${item.type}-${item.title ?? ''}`}>
            {item.title && (
              <CreationSectionTitle>
                {t(item.title)}
                {/* range fields (e.g. numImages) interpolate their actual {{min}}-{{max}} */}
                {item.tooltip && <InfoTooltip content={t(item.tooltip, { min: item.min, max: item.max })} />}
              </CreationSectionTitle>
            )}
            <PaintingFieldRenderer
              item={item}
              painting={params}
              onChange={onChange}
              onGenerateRandomSeed={onGenerateRandomSeed}
            />
          </div>
        ))}
    </>
  )
}

export default CreationParamsForm
