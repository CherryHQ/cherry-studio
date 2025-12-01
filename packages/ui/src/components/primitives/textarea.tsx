import { cn } from '@cherrystudio/ui/utils/index'
import { composeEventHandlers } from '@radix-ui/primitive'
import { createContext } from '@radix-ui/react-context'
import { useCallbackRef } from '@radix-ui/react-use-callback-ref'
import { useControllableState } from '@radix-ui/react-use-controllable-state'
import { cva } from 'class-variance-authority'
import * as React from 'react'

/* -------------------------------------------------------------------------------------------------
 * Textarea Context
 * -----------------------------------------------------------------------------------------------*/

type TextareaContextValue = {
  textareaId: string
  hasError: boolean
  disabled?: boolean
}

// eslint-disable-next-line @eslint-react/naming-convention/context-name
const [TextareaContext, useTextareaContext] = createContext<TextareaContextValue>('Textarea.TextareaContext', {
  textareaId: '',
  hasError: false,
  disabled: false
})

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

interface TextareaRootProps extends React.ComponentPropsWithoutRef<'div'> {
  error?: string
  disabled?: boolean
}

function TextareaRoot({ error, disabled, className, children, ...props }: TextareaRootProps) {
  const textareaId = React.useId()
  const hasError = !!error

  return (
    <TextareaContext textareaId={textareaId} hasError={hasError} disabled={disabled}>
      <div data-slot="textarea-root" {...props} className={cn('flex w-full flex-col gap-2', className)}>
        {children}
      </div>
    </TextareaContext>
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
}

const TextareaInput = function TextareaInput({
  ref,
  value: valueProp,
  defaultValue,
  onValueChange,
  className,
  ...props
}: TextareaInputProps & { ref?: React.RefObject<HTMLTextAreaElement | null> }) {
  const context = useTextareaContext(INPUT_NAME)

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
      id={context.textareaId}
      {...props}
      ref={ref}
      value={value}
      onChange={composeEventHandlers(props.onChange, handleChange)}
      disabled={context.disabled}
      aria-invalid={context.hasError}
      className={cn(textareaVariants({ hasError: context.hasError }), className)}
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
