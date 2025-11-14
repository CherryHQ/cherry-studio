import { cn, toUndefinedIfNull } from '@cherrystudio/ui/utils'
import type { VariantProps } from 'class-variance-authority'
import { cva } from 'class-variance-authority'
import { Edit2Icon, EyeIcon, EyeOffIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { useCallback, useMemo, useState } from 'react'

import type { InputProps } from '../../primitives/input'
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from '../../primitives/input-group'

const inputGroupVariants = cva(
  [
    'h-auto',
    'rounded-xs',
    'has-[[data-slot=input-group-control]:focus-visible]:ring-ring/40',
    'has-[[data-slot=input-group-control]:focus-visible]:border-[#3CD45A]'
  ],
  {
    variants: {
      disabled: {
        false: null,
        true: ['bg-background-subtle', 'border-border-hover', 'cursor-not-allowed']
      }
    },
    defaultVariants: {
      disabled: false
    }
  }
)

const inputVariants = cva(['p-0', 'h-fit', 'min-w-0'], {
  variants: {
    size: {
      sm: ['text-sm', 'leading-4'],
      md: ['leading-4.5'],
      lg: ['text-lg', 'leading-5']
    },
    variant: {
      default: [],
      button: [],
      email: [],
      select: []
    },
    disabled: {
      false: null,
      true: ['text-foreground/40', 'placeholder:text-foreground/40', 'disabled:opacity-100']
    }
  },
  defaultVariants: {
    size: 'md',
    variant: 'default',
    disabled: false
  }
})

const inputWrapperVariants = cva(['flex', 'flex-1', 'items-center', 'gap-2'], {
  variants: {
    size: {
      sm: ['p-3xs'],
      // Why only the md size is fixed height???
      md: ['p-3xs', 'h-5.5', 'box-content'],
      lg: ['px-2xs', 'py-3xs']
    },
    variant: {
      default: [],
      button: ['border-r-[1px]'],
      email: [],
      select: []
    },
    disabled: {
      false: null,
      true: ['border-background-subtle']
    }
  },
  defaultVariants: {
    disabled: false
  }
})

const iconVariants = cva([], {
  variants: {
    size: {
      sm: ['size-4.5'],
      md: ['size-5'],
      lg: ['size-6']
    },
    disabled: {
      false: null,
      true: ['text-foreground/40']
    }
  },
  defaultVariants: {
    size: 'md',
    disabled: false
  }
})

const iconButtonVariants = cva(['text-foreground/60 cursor-pointer transition-colors', 'hover:shadow-none'], {
  variants: {
    disabled: {
      false: null,
      true: []
    }
  },
  defaultVariants: {
    disabled: false
  }
})

const buttonVariants = cva(
  ['flex flex-col', 'text-foreground/60 cursor-pointer transition-colors', 'hover:shadow-none'],
  {
    variants: {
      size: {
        sm: ['p-3xs'],
        md: ['p-3xs'],
        lg: ['px-2xs', 'py-3xs']
      },
      disabled: {
        false: null,
        true: ['pointer-events-none']
      }
    },
    defaultVariants: {
      size: 'md',
      disabled: false
    }
  }
)

const buttonLabelVariants = cva([], {
  variants: {
    size: {
      // TODO: p/font-family, p/letter-spacing ... p?
      sm: ['text-sm leading-4'],
      md: ['leading-4.5'],
      lg: ['text-lg leading-5 tracking-normal']
    },
    disabled: {
      false: null,
      true: ['text-foreground/40']
    }
  },
  defaultVariants: {
    size: 'md',
    disabled: false
  }
})

function ShowPasswordButton({
  type,
  setType,
  size = 'md',
  disabled = false
}: {
  type: 'text' | 'password'
  setType: React.Dispatch<React.SetStateAction<'text' | 'password'>>
  size: VariantProps<typeof inputVariants>['size']
  disabled: boolean
}) {
  const togglePassword = useCallback(() => {
    if (disabled) return
    if (type === 'password') {
      setType('text')
    } else if (type === 'text') {
      setType('password')
    }
  }, [disabled, setType, type])

  const iconClassName = iconVariants({ size, disabled })

  return (
    <InputGroupButton onClick={togglePassword} disabled={disabled} className={iconButtonVariants({ disabled })}>
      {type === 'text' && <EyeIcon className={iconClassName} />}
      {type === 'password' && <EyeOffIcon className={iconClassName} />}
    </InputGroupButton>
  )
}

interface CompositeInputProps extends Omit<InputProps, 'size' | 'disabled'>, VariantProps<typeof inputVariants> {
  buttonProps?: {
    label: ReactNode
    onClick: React.DOMAttributes<HTMLButtonElement>['onClick']
  }
}

function CompositeInput({
  type = 'text',
  size = 'md',
  variant = 'default',
  disabled = false,
  buttonProps,
  className,
  ...rest
}: CompositeInputProps) {
  const isPassword = type === 'password'
  const [htmlType, setHtmlType] = useState<'text' | 'password'>('password')

  const startContent = useMemo(() => {
    switch (variant) {
      case 'default':
      case 'button':
        return <Edit2Icon className={iconVariants({ size, disabled })} />
      case 'email':
        return
    }
  }, [disabled, size, variant])

  const endContent = useMemo(() => {
    if ((variant === 'default' || variant === 'button') && isPassword) {
      return <ShowPasswordButton type={htmlType} setType={setHtmlType} size={size} disabled={!!disabled} />
    } else {
      return null
    }
  }, [disabled, htmlType, isPassword, size, variant])

  const buttonContent = useMemo(() => {
    if (buttonProps === undefined) {
      console.warn("CustomizedInput: 'button' variant requires a 'button' prop to be provided.")
      return null
    } else {
      return (
        <InputGroupButton className={buttonVariants({ size, disabled })} onClick={buttonProps.onClick}>
          <div className={buttonLabelVariants({ size, disabled })}>{buttonProps.label}</div>
        </InputGroupButton>
      )
    }
  }, [buttonProps, disabled, size])

  return (
    <InputGroup className={inputGroupVariants({ disabled })}>
      <div className={inputWrapperVariants({ size, variant, disabled })}>
        <InputGroupInput
          type={isPassword ? htmlType : type}
          disabled={toUndefinedIfNull(disabled)}
          className={cn(inputVariants({ size, variant, disabled }), className)}
          {...rest}
        />
        <InputGroupAddon className="p-0">{startContent}</InputGroupAddon>
        <InputGroupAddon align="inline-end" className="p-0">
          {endContent}
        </InputGroupAddon>
      </div>
      {variant === 'button' && buttonContent}
    </InputGroup>
  )
}

export { CompositeInput, type CompositeInputProps }
