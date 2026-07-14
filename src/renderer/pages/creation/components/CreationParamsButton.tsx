import { Button, Popover, PopoverContent, PopoverTrigger } from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'
import { COMPOSER_SELECTOR_BUTTON_CLASS } from '@renderer/components/composer/variants/shared/ComposerControlScaffolding'
import { Settings2 } from 'lucide-react'
import { type FC, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import type { BaseConfigItem } from '../form/baseConfigItem'
import { deriveChipLabel } from '../form/fields/SizeChipsField'
import { resolveOptions } from '../form/resolveOptions'
import CreationParamsForm, { type CreationParamsFormProps } from './CreationParamsForm'

/** Size-bearing canonical keys — formatted as chip-style dimensions. */
const SIZE_PREVIEW_KEYS = ['size', 'imageResolution', 'aspectRatio'] as const

/** Field types worth surfacing in the compact button summary. */
const SUMMARY_TYPES = new Set<BaseConfigItem['type']>([
  'select',
  'sizeChips',
  'slider',
  'radio',
  'iconRadio',
  'styleToggle'
])

function formatSummaryValue(
  item: BaseConfigItem,
  value: unknown,
  params: Record<string, unknown>,
  translate: (key: string) => string
): string | undefined {
  // Size-bearing fields render as chip-style dimensions, matching the size chips.
  if ((SIZE_PREVIEW_KEYS as readonly string[]).includes(item.key ?? '')) {
    if (value === 'custom') {
      const w = params?.customSize_width
      const h = params?.customSize_height
      return w && h ? `${String(w)}×${String(h)}` : undefined
    }
    return deriveChipLabel(String(value), String(value))
  }
  if (item.type === 'slider') return String(value)
  // Option-based: show the selected option's localized label.
  const match = resolveOptions(item, params ?? {}, translate).find((opt) => String(opt.value) === String(value))
  return match?.label ?? String(value)
}

/**
 * Compact summary of the current parameter selection, shown on the params button so
 * the popover's choices are visible at a glance. Mirrors the form: each field's
 * effective value is `params[key] ?? item.initialValue` (PaintingFieldRenderer), so
 * registry defaults appear before the user explicitly changes them.
 */
function paramsSummary(
  params: Record<string, unknown>,
  items: BaseConfigItem[],
  translate: (key: string) => string
): string {
  const parts: string[] = []
  for (const item of items) {
    if (!item.key || !SUMMARY_TYPES.has(item.type)) continue
    if (item.condition && !item.condition(params ?? {})) continue
    const value = params?.[item.key] ?? item.initialValue
    if (value === undefined || value === null || value === '') continue
    const formatted = formatSummaryValue(item, value, params, translate)
    if (formatted) parts.push(formatted)
  }
  return parts.join(' · ')
}

/**
 * Bottom-toolbar popover hosting the generation parameter list — shared by the
 * Creation page's image and video composers. Hidden when the model declares no
 * fields for the active mode.
 */
const CreationParamsButton: FC<CreationParamsFormProps> = ({ items, params, onChange, onGenerateRandomSeed }) => {
  const { t } = useTranslation()
  const summary = useMemo(() => paramsSummary(params, items, t), [params, items, t])

  if (items.length === 0) return null

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={cn(COMPOSER_SELECTOR_BUTTON_CLASS, 'text-muted-foreground')}
          aria-label={summary ? `${t('common.settings')}: ${summary}` : t('common.settings')}>
          <Settings2 className="size-4" />
          {summary && (
            <span className="max-w-55 truncate" title={summary}>
              {summary}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" side="top" className="w-[min(340px,calc(100vw-2rem))] rounded-[8px] p-3">
        <div className="flex max-h-[60vh] flex-col gap-4 overflow-y-auto pr-1">
          <CreationParamsForm
            items={items}
            params={params}
            onChange={onChange}
            onGenerateRandomSeed={onGenerateRandomSeed}
          />
        </div>
      </PopoverContent>
    </Popover>
  )
}

export default CreationParamsButton
