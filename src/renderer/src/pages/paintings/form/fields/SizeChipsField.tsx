import type { OptionItem } from '../../providers/shared/providerFieldSchema'
import type { PaintingFieldComponentProps } from '../fieldRegistry'

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

const MAX_THUMB = 18

function parseRatio(value: string): { w: number; h: number } | null {
  const dimMatch = value.match(/^(\d+)[x×](\d+)$/)
  if (dimMatch) return { w: Number(dimMatch[1]), h: Number(dimMatch[2]) }

  const ratioMatch = value.match(/^(?:ASPECT_)?(\d+)[_:](\d+)$/i)
  if (ratioMatch) return { w: Number(ratioMatch[1]), h: Number(ratioMatch[2]) }

  return null
}

function RatioThumb({ value, selected }: { value: string; selected: boolean }) {
  const ratio = parseRatio(value)
  if (!ratio) return null

  const scale = MAX_THUMB / Math.max(ratio.w, ratio.h)
  const w = Math.max(6, Math.round(ratio.w * scale))
  const h = Math.max(6, Math.round(ratio.h * scale))

  return (
    <span
      className={`inline-block shrink-0 rounded-[2px] border transition-all ${
        selected ? 'border-primary' : 'border-current opacity-50'
      }`}
      style={{ width: w, height: h }}
    />
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
  const value = currentValue !== undefined && currentValue !== null ? String(currentValue) : ''
  const columns = item.columns || 3

  return (
    <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
      {options.map((option) => {
        const optionValue = String(option.value)
        const isSelected = value === optionValue

        return (
          <button
            type="button"
            key={optionValue}
            disabled={disabled}
            className={`flex cursor-pointer flex-col items-center justify-center rounded-[0.75rem] border px-2 py-1.5 text-[11px] transition-all ${
              isSelected
                ? 'border-primary bg-primary/5 text-primary'
                : 'border-transparent bg-muted/40 text-muted-foreground hover:bg-muted/60 hover:text-foreground'
            } ${disabled ? 'cursor-not-allowed opacity-50' : ''}`}
            onClick={() => onChange({ [fieldKey]: optionValue })}>
            <RatioThumb value={optionValue} selected={isSelected} />
            <span className="mt-0.5 font-medium tracking-tight">{option.label || optionValue}</span>
          </button>
        )
      })}
    </div>
  )
}
