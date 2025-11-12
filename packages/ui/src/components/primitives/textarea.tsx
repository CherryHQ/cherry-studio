import { cn } from '@cherrystudio/ui/utils/index'
import { cva, type VariantProps } from 'class-variance-authority'
import * as React from 'react'

/**
 * Textarea variants based on Figma design system
 * Reference: https://www.figma.com/design/NNrHQ41XLXjA3fZWJS3ark/Cherry-UI---PC?node-id=254-30750
 */
const textareaVariants = cva(
  cn(
    'w-full border border-solid transition-colors resize-none overflow-hidden font-normal',
    'focus-visible:outline-none'
  ),
  {
    variants: {
      variant: {
        default: cn(
          'border-[rgba(0,0,0,0.1)]',
          'placeholder:text-[rgba(0,0,0,0.6)]',
          'text-[rgba(0,0,0,0.9)]',
          'focus:border-[var(--cs-primary,#3cd45a)] focus:text-[rgba(0,0,0,0.9)]'
        ),
        error: cn(
          'border-[var(--cs-red-500,#ef4444)]',
          'placeholder:text-[rgba(0,0,0,0.6)]',
          'text-[rgba(0,0,0,0.9)]',
          'focus:border-[var(--cs-red-500,#ef4444)]'
        )
      },
      size: {
        sm: cn(
          'text-[14px] leading-[16px]',
          'p-[12px]',
          'rounded-[12px]',
          'min-h-[108px]' // Matches Figma design
        ),
        md: cn('text-[16px] leading-[18px]', 'px-[16px] py-[12px]', 'rounded-[12px]', 'min-h-[108px]'),
        lg: cn('text-[18px] leading-[20px]', 'px-[16px] py-[12px]', 'rounded-[16px]', 'min-h-[108px]')
      },
      isDisabled: {
        true: cn(
          'bg-[rgba(0,0,0,0.02)]',
          'border-[rgba(0,0,0,0.2)]',
          'text-[rgba(0,0,0,0.4)]',
          'placeholder:text-[rgba(0,0,0,0.4)]',
          'cursor-not-allowed'
        ),
        false: 'bg-transparent'
      }
    },
    defaultVariants: {
      variant: 'default',
      size: 'md',
      isDisabled: false
    }
  }
)

const labelVariants = cva('font-bold flex items-center gap-[4px]', {
  variants: {
    size: {
      sm: 'text-[14px] leading-[16px]',
      md: 'text-[16px] leading-[18px]',
      lg: 'text-[18px] leading-[22px]'
    }
  },
  defaultVariants: {
    size: 'md'
  }
})

const captionVariants = cva('font-normal flex items-center gap-[8px]', {
  variants: {
    size: {
      sm: 'text-[10px] leading-[12px]',
      md: 'text-[12px] leading-[14px]',
      lg: 'text-[14px] leading-[16px]'
    },
    variant: {
      default: 'text-[rgba(0,0,0,0.4)]',
      error: 'text-[var(--cs-red-500,#ef4444)]'
    }
  },
  defaultVariants: {
    size: 'md',
    variant: 'default'
  }
})

export interface TextareaProps
  extends Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, 'size'>,
    VariantProps<typeof textareaVariants> {
  /**
   * Label text displayed above the textarea
   */
  label?: string
  /**
   * Error message to display below the textarea
   */
  error?: string
  /**
   * Caption/helper text to display below the textarea
   */
  caption?: string
  /**
   * Show character count
   */
  showCount?: boolean
  /**
   * Auto resize to fit content
   */
  autoResize?: boolean
  /**
   * Minimum number of rows when auto-resizing
   */
  minRows?: number
  /**
   * Maximum number of rows when auto-resizing
   */
  maxRows?: number
  /**
   * Ref for the textarea element
   */
  ref?: React.Ref<HTMLTextAreaElement>
}

function Textarea({
  className,
  variant,
  size = 'md',
  label,
  error,
  caption,
  showCount = false,
  autoResize = false,
  minRows = 3,
  maxRows,
  value,
  onChange,
  required,
  disabled,
  maxLength,
  ref,
  ...props
}: TextareaProps) {
  const textareaRef = React.useRef<HTMLTextAreaElement>(null)
  const [charCount, setCharCount] = React.useState(0)

  // Auto-resize functionality
  React.useEffect(() => {
    if (autoResize && textareaRef.current) {
      const textarea = textareaRef.current
      textarea.style.height = 'auto'

      const lineHeight = parseInt(window.getComputedStyle(textarea).lineHeight)
      const minHeight = lineHeight * minRows
      const maxHeight = maxRows ? lineHeight * maxRows : Infinity

      const scrollHeight = textarea.scrollHeight
      const newHeight = Math.min(Math.max(scrollHeight, minHeight), maxHeight)

      textarea.style.height = `${newHeight}px`
    }
  }, [value, autoResize, minRows, maxRows])

  // Character count
  React.useEffect(() => {
    if (value !== undefined) {
      setCharCount(String(value).length)
    }
  }, [value])

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = e.target.value
    if (maxLength && newValue.length > maxLength) {
      return
    }
    setCharCount(newValue.length)
    onChange?.(e)
  }

  // Combine refs
  React.useImperativeHandle(ref, () => textareaRef.current!)

  const effectiveVariant = error ? 'error' : variant

  return (
    <div className="flex w-full flex-col gap-[8px]">
      {label && (
        <div className={labelVariants({ size })}>
          {required && (
            <span className="text-[var(--cs-red-500,#ef4444)] font-medium text-[16px] leading-[24px]">*</span>
          )}
          <span className="text-[rgba(0,0,0,0.9)]">{label}</span>
        </div>
      )}

      <div className="relative w-full">
        <textarea
          ref={textareaRef}
          className={cn(
            textareaVariants({
              variant: effectiveVariant,
              size,
              isDisabled: disabled
            }),
            className
          )}
          value={value}
          onChange={handleChange}
          maxLength={maxLength}
          required={required}
          disabled={disabled}
          {...props}
        />

        {showCount && maxLength && (
          <div
            className={cn(
              'absolute bottom-2 right-2',
              size === 'sm' && 'text-[10px]',
              size === 'md' && 'text-[12px]',
              size === 'lg' && 'text-[14px]',
              'text-[rgba(0,0,0,0.4)]'
            )}>
            {charCount}/{maxLength}
          </div>
        )}
      </div>

      {(error || caption) && (
        <div className={captionVariants({ size, variant: error ? 'error' : 'default' })}>
          {error && (
            <svg
              width="20"
              height="20"
              viewBox="0 0 20 20"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              className="shrink-0">
              <path
                d="M8.57465 3.21366L1.51632 14.9966C1.37078 15.2479 1.29379 15.5314 1.29215 15.82C1.29051 16.1086 1.36429 16.3929 1.5068 16.6458C1.64932 16.8987 1.85571 17.1115 2.10546 17.2637C2.3552 17.4158 2.64009 17.5021 2.93215 17.5137H17.0488C17.3409 17.5021 17.6258 17.4158 17.8755 17.2637C18.1253 17.1115 18.3317 16.8987 18.4742 16.6458C18.6167 16.3929 18.6905 16.1086 18.6888 15.82C18.6872 15.5314 18.6102 15.2479 18.4647 14.9966L11.4063 3.21366C11.2569 2.97169 11.0479 2.77073 10.7989 2.62928C10.5498 2.48784 10.2688 2.41113 9.98215 2.40625C9.69548 2.40136 9.41213 2.46844 9.15836 2.60086C8.90459 2.73329 8.68863 2.92651 8.53049 3.16366L8.57465 3.21366Z"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d="M10 7.5V10.8333"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d="M10 14.1665H10.0083"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          )}
          <span>{error || caption}</span>
        </div>
      )}
    </div>
  )
}

export { Textarea, textareaVariants }
