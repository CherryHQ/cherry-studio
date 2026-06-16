import type { InputProps } from '@cherrystudio/ui/components/primitives/input'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput
} from '@cherrystudio/ui/components/primitives/input-group'
import { cn } from '@cherrystudio/ui/lib/utils'
import { Search, X } from 'lucide-react'

type SearchInputClearProps =
  | {
      /**
       * Clear handler. When provided, a clear button appears while the
       * controlled input holds a non-empty value. Clicking it invokes this
       * callback; the caller owns resetting `value`.
       */
      onClear: () => void
      /** Accessible label for the clear button. Pass an i18n string from the caller. */
      clearLabel: string
    }
  | {
      onClear?: undefined
      clearLabel?: never
    }

export type SearchInputProps = Omit<InputProps, 'type'> & SearchInputClearProps

/**
 * Search field built on `InputGroup`: a leading search icon, a text input, and
 * an optional trailing clear button. Controlled via `value` / `onChange`.
 */
function SearchInput({ className, value, disabled, onClear, clearLabel, ...props }: SearchInputProps) {
  const hasValue = value !== undefined && value !== null && String(value).length > 0
  const showClear = onClear !== undefined && clearLabel !== undefined && hasValue

  return (
    <InputGroup data-disabled={disabled ? 'true' : undefined}>
      <InputGroupAddon>
        <Search />
      </InputGroupAddon>
      <InputGroupInput
        type="search"
        value={value}
        disabled={disabled}
        className={cn('[&::-webkit-search-cancel-button]:hidden', className)}
        {...props}
      />
      {showClear && (
        <InputGroupAddon align="inline-end">
          <InputGroupButton type="button" size="icon-xs" aria-label={clearLabel} disabled={disabled} onClick={onClear}>
            <X className="size-3.5" />
          </InputGroupButton>
        </InputGroupAddon>
      )}
    </InputGroup>
  )
}

export { SearchInput }
