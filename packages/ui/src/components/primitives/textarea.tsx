import { cn } from '@cherrystudio/ui/utils/index'
import { composeEventHandlers } from '@radix-ui/primitive'
import { useCallbackRef } from '@radix-ui/react-use-callback-ref'
import { useControllableState } from '@radix-ui/react-use-controllable-state'
import { cva } from 'class-variance-authority'
import * as React from 'react'

/* -------------------------------------------------------------------------------------------------
 * Variants
 * -----------------------------------------------------------------------------------------------*/

const textareaVariants = cva(
  cn(
    'flex field-sizing-content min-h-16 w-full border bg-transparent px-4 py-3 text-lg shadow-xs transition-[color,box-shadow] outline-none resize-y',
    'rounded-xs',
    'border-input text-foreground placeholder:text-foreground-secondary',
    'focus-visible:border-primary focus-visible:ring-ring focus-visible:ring-[3px]',
    'disabled:cursor-not-allowed disabled:opacity-50',
    'md:text-sm'
  ),
  {
    variants: {
      hasError: {
        true: 'aria-invalid:border-destructive aria-invalid:ring-destructive/20',
        false: ''
      }
    },
    defaultVariants: {
      hasError: false
    }
  }
)

/* -------------------------------------------------------------------------------------------------
 * TextareaRoot
 * -----------------------------------------------------------------------------------------------*/

const ROOT_NAME = 'TextareaRoot'

interface TextareaRootProps extends React.ComponentPropsWithoutRef<'div'> {}

function TextareaRoot({ className, children, ...props }: TextareaRootProps) {
  return (
    <div data-slot="textarea-root" {...props} className={cn('flex w-full flex-col gap-2', className)}>
      {children}
    </div>
  )
}

TextareaRoot.displayName = ROOT_NAME

/* -------------------------------------------------------------------------------------------------
 * TextareaInput
 * -----------------------------------------------------------------------------------------------*/

const INPUT_NAME = 'TextareaInput'

interface TextareaInputProps extends Omit<React.ComponentPropsWithoutRef<'textarea'>, 'value' | 'defaultValue'> {
  value?: string
  defaultValue?: string
  onValueChange?: (value: string) => void
  hasError?: boolean
  ref?: React.Ref<HTMLTextAreaElement>
}

function TextareaInput({
  value: valueProp,
  defaultValue,
  onValueChange,
  hasError = false,
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
      className={cn(textareaVariants({ hasError }), className)}
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

const Root = TextareaRoot
const Input = TextareaInput
const CharCount = TextareaCharCount

export { CharCount, Input, Root }
export type { TextareaCharCountProps, TextareaInputProps, TextareaRootProps }
