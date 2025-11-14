import { cn, toUndefinedIfNull } from '@cherrystudio/ui/utils'
import type { VariantProps } from 'class-variance-authority'
import { cva } from 'class-variance-authority'
import { Edit2Icon, EyeIcon, EyeOffIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { useCallback, useMemo, useState } from 'react'

import type { InputProps } from '../../primitives/input'
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from '../../primitives/input-group'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue
} from '../../primitives/select'

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
        sm: ['px-3xs py-3xs'],
        md: ['px-3xs py-3xs'],
        lg: ['px-2xs py-3xs']
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

const prefixVariants = cva(['font-medium', 'border-r-[1px]', 'text-foreground/60'], {
  variants: {
    size: {
      // TODO: semantic letter-spacing
      sm: ['text-sm leading-4', 'p-3xs'],
      md: ['leading-4.5', 'p-3xs'],
      lg: ['leading-5 tracking-normal', 'px-2xs py-3xs']
    },
    disabled: {
      false: null,
      true: 'text-foreground/40'
    }
  },
  defaultVariants: {
    size: 'md',
    disabled: false
  }
})

const selectPrefixVariants = cva(['font-medium', 'border-r-[1px]', 'text-foreground/60'], {
  variants: {
    size: {
      // TODO: semantic letter-spacing
      sm: ['text-sm leading-4', 'px-3xs py-4xs'],
      md: ['leading-4.5', 'px-3xs py-4xs'],
      lg: ['leading-5 tracking-normal', 'px-2xs py-3xs']
    },
    disabled: {
      false: null,
      true: 'text-foreground/40'
    }
  },
  defaultVariants: {
    size: 'md',
    disabled: false
  }
})

const selectTriggerLabelVariants = cva([], {
  variants: {
    size: {
      // TODO: p/font-family, p/letter-spacing ... p?
      sm: ['text-sm leading-4'],
      md: ['leading-4.5'],
      lg: ['text-lg leading-5 tracking-normal']
    }
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

interface SelectItem {
  label: ReactNode
  value: string
}

interface SelectGroup {
  label: ReactNode
  items: SelectItem[]
}

interface CompositeInputProps
  extends Omit<InputProps, 'size' | 'disabled' | 'prefix'>,
    VariantProps<typeof inputVariants> {
  buttonProps?: {
    label?: ReactNode
    onClick: React.DOMAttributes<HTMLButtonElement>['onClick']
  }
  prefix?: ReactNode
  selectProps?: {
    groups: SelectGroup[]
    placeholder?: string
  }
}

function CompositeInput({
  type = 'text',
  size = 'md',
  variant = 'default',
  disabled = false,
  buttonProps,
  prefix,
  selectProps,
  className,
  ...rest
}: CompositeInputProps) {
  const isPassword = type === 'password'
  const [htmlType, setHtmlType] = useState<'text' | 'password'>('password')

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

  const emailContent = useMemo(() => {
    if (!prefix) {
      console.warn('CompositeInput: "email" variant requires a "prefix" prop to be provided.')
      return null
    } else {
      return <div className={prefixVariants({ size, disabled })}>{prefix}</div>
    }
  }, [disabled, prefix, size])

  const selectContent = useMemo(() => {
    if (!selectProps) {
      console.warn('CompositeInput: "select" variant requires a "selectProps" prop to be provided.')
      return null
    } else {
      return (
        <div className={selectPrefixVariants({ size, disabled })}>
          <Select>
            <SelectTrigger className={cn('border-none py-2 pl-3 aria-expanded:border-none aria-expanded:ring-0')}>
              <SelectValue placeholder={selectProps.placeholder} className={selectTriggerLabelVariants({ size })} />
            </SelectTrigger>
            <SelectContent>
              {selectProps.groups.map((group, index) => (
                <SelectGroup key={index}>
                  <SelectLabel>{group.label}</SelectLabel>
                  {group.items.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              ))}
            </SelectContent>
          </Select>
        </div>
      )
    }
  }, [disabled, selectProps, size])

  return (
    <InputGroup className={inputGroupVariants({ disabled })}>
      {variant === 'email' && emailContent}
      {variant === 'select' && selectContent}
      <div className={inputWrapperVariants({ size, variant, disabled })}>
        <InputGroupInput
          type={isPassword ? htmlType : type}
          disabled={toUndefinedIfNull(disabled)}
          className={cn(inputVariants({ size, variant, disabled }), className)}
          {...rest}
        />
        {(variant === 'default' || variant === 'button') && (
          <>
            <InputGroupAddon className="p-0">
              <Edit2Icon className={iconVariants({ size, disabled })} />
            </InputGroupAddon>
            <InputGroupAddon align="inline-end" className="p-0">
              <ShowPasswordButton type={htmlType} setType={setHtmlType} size={size} disabled={!!disabled} />
            </InputGroupAddon>
          </>
        )}
      </div>
      {variant === 'button' && buttonContent}
    </InputGroup>
  )
}

export { CompositeInput, type CompositeInputProps, type SelectGroup, type SelectItem }
