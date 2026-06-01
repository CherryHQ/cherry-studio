import { cn } from '@cherrystudio/ui/lib/utils'

import type { OptionItem } from '../../form/baseConfigItem'
import type { PaintingFieldComponentProps } from '../fieldRegistry'
import { resolveOptions } from '../resolveOptions'

const MAX_THUMB = 14
const MIN_THUMB = 6
const DEFAULT_COLUMNS = 3

const chipClass = {
  base: 'flex min-h-10 min-w-0 cursor-pointer flex-col items-center justify-center gap-0.5 rounded-[10px] px-2 py-1 text-[11px] leading-tight transition-all',
  active: 'bg-secondary-active text-foreground ring-1 ring-[var(--color-border-active)]',
  inactive: 'bg-muted text-muted-foreground/60 hover:bg-secondary-hover hover:text-foreground',
  disabled: 'cursor-not-allowed opacity-50'
}

type Dim = { w: number; h: number }

function parseRatio(value: string): Dim | null {
  const dims = value.match(/^(\d+)[x×](\d+)$/)
  if (dims) return { w: Number(dims[1]), h: Number(dims[2]) }

  const aspect = value.match(/^(?:ASPECT_)?(\d+)[_:](\d+)$/i)
  if (aspect) return { w: Number(aspect[1]), h: Number(aspect[2]) }

  return null
}

function parseDims(s: string): Dim | null {
  const m = s.match(/^(\d+)\s*[x×]\s*(\d+)$/)
  return m ? { w: Number(m[1]), h: Number(m[2]) } : null
}

function formatDims({ w, h }: Dim): string {
  return `${w}×${h}`
}

function splitParens(label: string): { head: string; inner: string } {
  const m = label.match(/^(.*?)\s*[(（]([^)）]+)[)）]\s*$/)
  return m ? { head: m[1].trim(), inner: m[2].trim() } : { head: label.trim(), inner: '' }
}

/**
 * Choose a single concise label for a chip. The visual `RatioThumb`
 * already conveys the shape, so chips never need both ratio AND pixel
 * dims at once. Selection logic:
 *
 *  - Pure aspect-ratio enum (`ASPECT_X_Y` from `supports.aspectRatio`,
 *    or bare `X:Y` / `X_Y`) → `X:Y`. Prevents the raw enum from
 *    leaking into the UI ("ASPECT_1_1") and keeps the chip width
 *    bounded so the grid follows the parent container.
 *  - Label with parenthesized pixel dims like `"1:1 (1024×1024)"` →
 *    use the head (`"1:1"`).
 *  - Pixel-size value `WxH` → `W×H` (formatted with U+00D7).
 *  - Anything else (`"auto"` → `"自动"`, `"1K"`, etc.) → the label
 *    verbatim.
 */
export function deriveChipLabel(label: string, value: string): string {
  const aspectMatch = value.match(/^(?:ASPECT_)?(\d+)[_:](\d+)$/i)
  if (aspectMatch) {
    return `${Number(aspectMatch[1])}:${Number(aspectMatch[2])}`
  }

  const { head, inner } = splitParens(label)
  if (parseDims(inner)) {
    return head
  }

  const dims = parseDims(value)
  if (dims) {
    return formatDims(dims)
  }

  return label
}

function RatioShape({ ratio, selected }: { ratio: Dim; selected: boolean }) {
  const scale = MAX_THUMB / Math.max(ratio.w, ratio.h)
  const w = Math.max(MIN_THUMB, Math.round(ratio.w * scale))
  const h = Math.max(MIN_THUMB, Math.round(ratio.h * scale))

  return (
    <span
      className={cn('inline-block rounded-[2px] border border-current transition-all', !selected && 'opacity-40')}
      style={{ width: w, height: h }}
    />
  )
}

function RatioThumb({ value, selected }: { value: string; selected: boolean }) {
  const ratio = parseRatio(value)
  return (
    <span className="flex shrink-0 items-center justify-center" style={{ width: MAX_THUMB, height: MAX_THUMB }}>
      {ratio ? <RatioShape ratio={ratio} selected={selected} /> : null}
    </span>
  )
}

/**
 * Pick a column count that keeps every chip readable. The sidebar's fixed
 * width can't accommodate three 9-char labels (`1280×1280`) — minmax(0, 1fr)
 * columns shrink and the chip text overflows / truncates. Drop to 2 cols
 * when any derived label is at least 8 chars. Aspect-ratio chips (`1:1`)
 * stay at 3 cols since their labels are short.
 */
function autoColumns(options: OptionItem[], explicit: number | undefined): number {
  if (explicit) return explicit
  let longest = 0
  for (const option of options) {
    const label = deriveChipLabel(String(option.label ?? option.value), String(option.value))
    if (label.length > longest) longest = label.length
  }
  return longest >= 8 ? 2 : DEFAULT_COLUMNS
}

export default function SizeChipsField({
  item,
  fieldKey,
  painting,
  translate,
  onChange,
  currentValue,
  disabled
}: PaintingFieldComponentProps) {
  const options = resolveOptions(item, painting, translate)
  const value = currentValue == null ? '' : String(currentValue)
  const columns = autoColumns(options, item.columns)

  return (
    <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
      {options.map((option) => {
        const optionValue = String(option.value)
        const label = option.label || optionValue
        const isSelected = value === optionValue
        const chipLabel = deriveChipLabel(label, optionValue)

        return (
          <button
            type="button"
            key={optionValue}
            disabled={disabled}
            title={label}
            className={cn(
              chipClass.base,
              isSelected ? chipClass.active : chipClass.inactive,
              disabled && chipClass.disabled
            )}
            onClick={() => onChange({ [fieldKey]: optionValue })}>
            <RatioThumb value={optionValue} selected={isSelected} />
            <span className="block max-w-full truncate font-medium tracking-tight">{chipLabel}</span>
          </button>
        )
      })}
    </div>
  )
}
