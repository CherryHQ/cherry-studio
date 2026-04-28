// Original path: src/renderer/src/components/EditableNumber/index.tsx
import { cn } from '@cherrystudio/ui/lib/utils'
import * as React from 'react'

export interface EditableNumberProps {
  value?: number | null
  min?: number
  max?: number
  step?: number
  precision?: number
  placeholder?: string
  disabled?: boolean
  changeOnBlur?: boolean
  onChange?: (value: number | null) => void
  onBlur?: () => void
  style?: React.CSSProperties
  className?: string
  size?: 'small' | 'middle' | 'large'
  suffix?: string
  prefix?: string
  align?: 'start' | 'center' | 'end'
  formatter?: (value: number | null) => string | number
}

const sizeClasses: Record<NonNullable<EditableNumberProps['size']>, string> = {
  small: 'h-8 text-sm',
  middle: 'h-9 text-sm',
  large: 'h-10 text-base'
}

const alignClasses: Record<NonNullable<EditableNumberProps['align']>, string> = {
  start: 'justify-start text-left',
  center: 'justify-center text-center',
  end: 'justify-end text-right'
}

const clamp = (value: number, min?: number, max?: number) => {
  if (min !== undefined && value < min) {
    return min
  }
  if (max !== undefined && value > max) {
    return max
  }
  return value
}

const normalizeNumber = (value: string, precision?: number, min?: number, max?: number) => {
  const trimmed = value.trim()
  if (!trimmed || trimmed === '-' || trimmed === '.' || trimmed === '-.') {
    return null
  }

  const parsed = Number(trimmed)
  if (Number.isNaN(parsed)) {
    return null
  }

  const clamped = clamp(parsed, min, max)
  if (precision === undefined) {
    return clamped
  }

  return Number(clamped.toFixed(precision))
}

const toInputValue = (value: number | null | undefined, precision?: number) => {
  if (value === null || value === undefined) {
    return ''
  }
  return precision === undefined ? String(value) : value.toFixed(precision)
}

const EditableNumber: React.FC<EditableNumberProps> = ({
  value,
  min,
  max,
  step = 0.01,
  precision,
  placeholder,
  disabled = false,
  onChange,
  onBlur,
  changeOnBlur = false,
  style,
  className,
  size = 'middle',
  align = 'end',
  suffix,
  prefix,
  formatter
}) => {
  const [isEditing, setIsEditing] = React.useState(false)
  const [inputValue, setInputValue] = React.useState(() => toInputValue(value, precision))
  const inputRef = React.useRef<HTMLInputElement>(null)

  React.useEffect(() => {
    if (!isEditing) {
      setInputValue(toInputValue(value, precision))
    }
  }, [isEditing, precision, value])

  const commitValue = React.useCallback(
    (nextValue: string) => {
      const normalized = normalizeNumber(nextValue, precision, min, max)
      onChange?.(normalized)
      return normalized
    },
    [max, min, onChange, precision]
  )

  const handleFocus = () => {
    if (disabled) {
      return
    }
    setIsEditing(true)
  }

  React.useEffect(() => {
    if (isEditing) {
      inputRef.current?.focus()
    }
  }, [isEditing])

  const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const nextValue = event.target.value
    setInputValue(nextValue)

    if (!changeOnBlur) {
      commitValue(nextValue)
    }
  }

  const handleBlur = () => {
    const normalized = changeOnBlur ? commitValue(inputValue) : normalizeNumber(inputValue, precision, min, max)
    setInputValue(toInputValue(normalized, precision))
    setIsEditing(false)
    onBlur?.()
  }

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.currentTarget.blur()
      return
    }

    if (event.key === 'Escape') {
      event.stopPropagation()
      setInputValue(toInputValue(value, precision))
      setIsEditing(false)
      event.currentTarget.blur()
    }
  }

  const displayValue = formatter ? formatter(value ?? null) : (value ?? placeholder)
  const shouldRenderDisplayValue = Boolean(formatter || prefix || suffix)
  const inputAlignClass = align === 'start' ? 'text-left' : align === 'center' ? 'text-center' : 'text-right'
  const inputClassName = cn(
    'border-input bg-background w-full rounded-md border px-3 text-sm shadow-xs outline-none transition-[color,box-shadow] [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none',
    'focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]',
    'disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50',
    sizeClasses[size],
    inputAlignClass,
    shouldRenderDisplayValue && !isEditing && 'hidden',
    className
  )

  const handleDisplayKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      handleFocus()
    }
  }

  return (
    <div className="relative inline-block">
      <input
        ref={inputRef}
        type="number"
        value={inputValue}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onChange={handleChange}
        onBlur={handleBlur}
        onFocus={handleFocus}
        onKeyDown={handleKeyDown}
        className={inputClassName}
        style={style}
      />
      {shouldRenderDisplayValue && !isEditing && (
        <div
          className={cn(
            'border-input bg-background flex w-full cursor-text items-center rounded-md border px-3 text-sm shadow-xs outline-none transition-[color,box-shadow]',
            'focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]',
            disabled && 'pointer-events-none cursor-not-allowed opacity-50',
            alignClasses[align],
            sizeClasses[size],
            className
          )}
          onClick={handleFocus}
          onKeyDown={handleDisplayKeyDown}
          tabIndex={disabled ? -1 : 0}
          style={style}>
          <span className="truncate">
            {prefix}
            {displayValue}
            {suffix}
          </span>
        </div>
      )}
    </div>
  )
}

export default EditableNumber
