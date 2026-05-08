import { cn } from '@cherrystudio/ui/lib/utils'

import type { OptionItem } from '../../providers/shared/providerFieldSchema'
import type { PaintingFieldComponentProps } from '../fieldRegistry'

const MAX_THUMB = 18
const MIN_THUMB = 6
const RATIO_MAX_TERM = 32
const DEFAULT_COLUMNS = 3

const chipClass = {
  base: 'flex cursor-pointer flex-col items-center justify-center gap-1 rounded-[var(--painting-radius-control)] px-2 py-1.5 text-[11px] leading-tight transition-all',
  active:
    'bg-[var(--painting-choice-active-bg)] text-[var(--painting-choice-active-fg)] ring-1 ring-[var(--painting-choice-active-ring)]',
  inactive:
    'bg-[var(--painting-choice-bg)] text-muted-foreground/60 hover:bg-[var(--painting-choice-bg-hover)] hover:text-foreground',
  disabled: 'cursor-not-allowed opacity-50'
}

type Dim = { w: number; h: number }

function mapOptions(
  itemOptions: PaintingFieldComponentProps['item']['options'],
  item: PaintingFieldComponentProps['item'],
  painting: Record<string, unknown>,
  translate: (key: string) => string
): OptionItem[] {
  const rawOptions = typeof itemOptions === 'function' ? itemOptions(item, painting) : (itemOptions ?? [])
  return rawOptions.map((option) => ({
    ...option,
    label: option.labelKey ? translate(option.labelKey) : option.label
  }))
}

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

function gcd(a: number, b: number): number {
  while (b !== 0) {
    const t = b
    b = a % b
    a = t
  }
  return a
}

function simplifyRatio({ w, h }: Dim): string | null {
  const g = gcd(w, h)
  const sw = w / g
  const sh = h / g
  if (sw > RATIO_MAX_TERM || sh > RATIO_MAX_TERM) return null
  return `${sw}:${sh}`
}

function splitParens(label: string): { head: string; inner: string } {
  const m = label.match(/^(.*?)\s*[(（]([^)）]+)[)）]\s*$/)
  return m ? { head: m[1].trim(), inner: m[2].trim() } : { head: label.trim(), inner: '' }
}

function deriveLabelParts(label: string, value: string): { primary: string; secondary: string } {
  const { head, inner } = splitParens(label)
  const innerDims = parseDims(inner)
  const headDims = parseDims(head)

  if (innerDims && !headDims) {
    return { primary: head, secondary: formatDims(innerDims) }
  }

  const dims = headDims ?? parseDims(value)
  if (!dims) return { primary: label, secondary: '' }

  const ratio = simplifyRatio(dims)
  return ratio ? { primary: ratio, secondary: formatDims(dims) } : { primary: formatDims(dims), secondary: '' }
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

export default function SizeChipsField({
  item,
  fieldKey,
  painting,
  translate,
  onChange,
  currentValue,
  disabled
}: PaintingFieldComponentProps) {
  const options = mapOptions(item.options, item, painting, translate)
  const value = currentValue == null ? '' : String(currentValue)
  const columns = item.columns || DEFAULT_COLUMNS

  return (
    <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${columns}, minmax(min-content, 1fr))` }}>
      {options.map((option) => {
        const optionValue = String(option.value)
        const label = option.label || optionValue
        const isSelected = value === optionValue
        const { primary, secondary } = deriveLabelParts(label, optionValue)

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
            <span className="whitespace-nowrap font-medium tracking-tight">{primary}</span>
            {secondary ? (
              <span className="whitespace-nowrap text-[9px] tabular-nums tracking-tight opacity-70">{secondary}</span>
            ) : null}
          </button>
        )
      })}
    </div>
  )
}
