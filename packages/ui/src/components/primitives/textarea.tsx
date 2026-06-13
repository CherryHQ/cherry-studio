import { cn } from '@cherrystudio/ui/lib/utils'
import { composeEventHandlers } from '@radix-ui/primitive'
import { useCallbackRef } from '@radix-ui/react-use-callback-ref'
import { useControllableState } from '@radix-ui/react-use-controllable-state'
import { cva, type VariantProps } from 'class-variance-authority'
import * as React from 'react'

/* -------------------------------------------------------------------------------------------------
 * Variants
 * -----------------------------------------------------------------------------------------------*/

const textareaVariants = cva(
  cn(
    'flex field-sizing-content w-full border bg-transparent transition-[color,box-shadow] outline-none resize-y',
    'rounded-md',
    'border-input text-foreground placeholder:text-foreground-secondary',
    'focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]',
    'disabled:cursor-not-allowed disabled:opacity-50'
  ),
  {
    variants: {
      hasError: {
        true: 'aria-invalid:border-destructive aria-invalid:ring-destructive/20',
        false: ''
      },
      density: {
        default: 'min-h-16 px-4 py-3 text-lg md:text-sm',
        compact: 'min-h-12 px-3 py-2 text-sm'
      }
    },
    defaultVariants: {
      hasError: false,
      density: 'default'
    }
  }
)

/* -------------------------------------------------------------------------------------------------
 * TextareaInput
 * -----------------------------------------------------------------------------------------------*/

const INPUT_NAME = 'TextareaInput'

interface TextareaInputProps extends Omit<React.ComponentPropsWithoutRef<'textarea'>, 'value' | 'defaultValue'> {
  value?: string
  defaultValue?: string
  onValueChange?: (value: string) => void
  hasError?: boolean
  density?: VariantProps<typeof textareaVariants>['density']
  ref?: React.Ref<HTMLTextAreaElement>
}

function TextareaInput({
  value: valueProp,
  defaultValue,
  onValueChange,
  hasError = false,
  density = 'default',
  className,
  ref,
  ...props
}: TextareaInputProps) {
  const [value = '', setValue] = useControllableState({
    prop: valueProp,
    defaultProp: defaultValue ?? '',
    onChange: onValueChange
  })

  const handleChange = useCallbackRef((event: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = event.target.value
    if (props.maxLength && newValue.length > props.maxLength) {
      return
    }
    setValue(newValue)
  })

  return (
    <textarea
      data-slot="textarea-input"
      {...props}
      ref={ref}
      value={value}
      onChange={composeEventHandlers(props.onChange, handleChange)}
      aria-invalid={hasError}
      className={cn(textareaVariants({ hasError, density }), className)}
    />
  )
}

TextareaInput.displayName = INPUT_NAME

/* -------------------------------------------------------------------------------------------------
 * TextareaCharCount
 * -----------------------------------------------------------------------------------------------*/

const CHAR_COUNT_NAME = 'TextareaCharCount'

interface TextareaCharCountProps extends React.ComponentPropsWithoutRef<'div'> {
  value?: string
  maxLength?: number
}

function TextareaCharCount({ value = '', maxLength, className, ...props }: TextareaCharCountProps) {
  return (
    <div
      data-slot="textarea-char-count"
      {...props}
      className={cn('absolute bottom-2 right-2 text-xs text-muted-foreground', className)}>
      {value.length}/{maxLength}
    </div>
  )
}

TextareaCharCount.displayName = CHAR_COUNT_NAME

/* ---------------------------------------------------------------------------------------------- */

const Input = TextareaInput
const CharCount = TextareaCharCount

export { CharCount, Input }
export type { TextareaCharCountProps, TextareaInputProps }
