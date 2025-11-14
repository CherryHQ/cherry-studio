import { cn } from '@cherrystudio/ui/utils/index'
import { composeEventHandlers } from '@radix-ui/primitive'
import { createContext } from '@radix-ui/react-context'
import { useCallbackRef } from '@radix-ui/react-use-callback-ref'
import { useControllableState } from '@radix-ui/react-use-controllable-state'
import { cva } from 'class-variance-authority'
import { TriangleAlert } from 'lucide-react'
import * as React from 'react'

/* -------------------------------------------------------------------------------------------------
 * Textarea Context
 * -----------------------------------------------------------------------------------------------*/

type TextareaContextValue = {
  textareaId: string
  hasError: boolean
  disabled?: boolean
}

const [TextareaContextProvider, useTextareaContext] = createContext<TextareaContextValue>('Textarea.TextareaContext', {
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

const labelVariants = cva('text-lg font-bold leading-[22px]', {
  variants: {
    disabled: {
      true: 'cursor-not-allowed opacity-70',
      false: ''
    }
  },
  defaultVariants: {
    disabled: false
  }
})

const captionVariants = cva('text-sm flex items-center gap-1.5 leading-4', {
  variants: {
    hasError: {
      true: 'text-destructive',
      false: 'text-foreground-muted'
    }
  },
  defaultVariants: {
    hasError: false
  }
})

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
    <TextareaContextProvider textareaId={textareaId} hasError={hasError} disabled={disabled}>
      <div data-slot="textarea-root" {...props} className={cn('flex w-full flex-col gap-2', className)}>
        {children}
      </div>
    </TextareaContextProvider>
  )
}

TextareaRoot.displayName = ROOT_NAME

/* -------------------------------------------------------------------------------------------------
 * TextareaLabel
 * -----------------------------------------------------------------------------------------------*/

const LABEL_NAME = 'TextareaLabel'

interface TextareaLabelProps extends React.ComponentPropsWithoutRef<'label'> {
  required?: boolean
}

function TextareaLabel({ required, className, children, ...props }: TextareaLabelProps) {
  const context = useTextareaContext(LABEL_NAME)

  return (
    <label
      data-slot="textarea-label"
      {...props}
      htmlFor={context.textareaId}
      className={cn(labelVariants({ disabled: context.disabled }), className)}>
      {required && <span className="text-destructive mr-1">*</span>}
      {children}
    </label>
  )
}

TextareaLabel.displayName = LABEL_NAME

/* -------------------------------------------------------------------------------------------------
 * TextareaInput
 * -----------------------------------------------------------------------------------------------*/

const INPUT_NAME = 'TextareaInput'

interface TextareaInputProps extends Omit<React.ComponentPropsWithoutRef<'textarea'>, 'value' | 'defaultValue'> {
  value?: string
  defaultValue?: string
  onValueChange?: (value: string) => void
  autoSize?: boolean
  ref?: React.Ref<HTMLTextAreaElement>
}

function TextareaInput({
  value: valueProp,
  defaultValue,
  onValueChange,
  autoSize = false,
  className,
  ref,
  ...props
}: TextareaInputProps) {
  const context = useTextareaContext(INPUT_NAME)
  const textareaRef = React.useRef<HTMLTextAreaElement>(null)

  // Compose refs using React 19 pattern
  React.useEffect(() => {
    if (!ref || !textareaRef.current) return

    if (typeof ref === 'function') {
      ref(textareaRef.current)
    } else if (typeof ref === 'object' && ref !== null) {
      ref.current = textareaRef.current
    }
  }, [ref])

  const [value = '', setValue] = useControllableState({
    prop: valueProp,
    defaultProp: defaultValue ?? '',
    onChange: onValueChange
  })

  // Auto resize
  React.useEffect(() => {
    if (autoSize && textareaRef.current) {
      const textarea = textareaRef.current
      textarea.style.height = 'auto'
      textarea.style.height = `${textarea.scrollHeight}px`
    }
  }, [value, autoSize])

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
      ref={textareaRef}
      value={value}
      onChange={composeEventHandlers(props.onChange, handleChange)}
      disabled={context.disabled}
      aria-invalid={context.hasError}
      className={cn(textareaVariants({ hasError: context.hasError }), className)}
      style={autoSize ? { resize: 'none', overflow: 'hidden' } : undefined}
    />
  )
}

TextareaInput.displayName = INPUT_NAME

/* -------------------------------------------------------------------------------------------------
 * TextareaCaption
 * -----------------------------------------------------------------------------------------------*/

const CAPTION_NAME = 'TextareaCaption'

type TextareaCaptionProps = React.ComponentPropsWithoutRef<'div'>

function TextareaCaption({ className, children, ...props }: TextareaCaptionProps) {
  const context = useTextareaContext(CAPTION_NAME)

  return (
    <div
      data-slot="textarea-caption"
      {...props}
      className={cn(captionVariants({ hasError: context.hasError }), className)}>
      {context.hasError && <TriangleAlert className="h-4 w-4 shrink-0" />}
      <span>{children}</span>
    </div>
  )
}

TextareaCaption.displayName = CAPTION_NAME

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
const Label = TextareaLabel
const Input = TextareaInput
const Caption = TextareaCaption
const CharCount = TextareaCharCount

export {
  Caption,
  captionVariants,
  CharCount,
  Input,
  Label,
  labelVariants,
  Root,
  TextareaCaption,
  TextareaCharCount,
  TextareaInput,
  TextareaLabel,
  TextareaRoot,
  textareaVariants
}
export type { TextareaCaptionProps, TextareaCharCountProps, TextareaInputProps, TextareaLabelProps, TextareaRootProps }
