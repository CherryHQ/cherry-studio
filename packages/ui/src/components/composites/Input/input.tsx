import { cn, toUndefinedIfNull } from '@cherrystudio/ui/utils'
import type { VariantProps } from 'class-variance-authority'
import { cva } from 'class-variance-authority'
import { Edit2Icon, EyeIcon, EyeOffIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { useCallback, useMemo, useState } from 'react'

import type { InputProps } from '../../primitives/input'
import { InputGroup, InputGroupAddon, InputGroupInput } from '../../primitives/input-group'

const inputGroupVariants = cva(
  [
    'h-auto',
    'rounded-xs',
    'has-[[data-slot=input-group-control]:focus-visible]:ring-ring/40',
    'has-[[data-slot=input-group-control]:focus-visible]:border-[#3CD45A]'
  ],
  {
    variants: {}
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
      true: []
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
    }
  }
})

const iconVariants = cva([], {
  variants: {
    size: {
      sm: ['size-4.5'],
      md: ['size-5'],
      lg: ['size-6']
    }
  },
  defaultVariants: {
    size: 'md'
  }
})

const buttonVariants = cva(['flex', 'flex-col'], {
  variants: {
    size: {
      sm: ['p-3xs'],
      md: ['p-3xs'],
      lg: ['px-2xs', 'py-3xs']
    }
  },
  defaultVariants: {
    size: 'md'
  }
})

const buttonLabelVariants = cva([], {
  variants: {
    size: {
      // TODO: p/font-family, p/letter-spacing ... p?
      sm: ['text-sm leading-4'],
      md: ['leading-4.5'],
      lg: ['text-lg leading-5 tracking-normal']
    }
  },
  defaultVariants: {
    size: 'md'
  }
})

function ShowPasswordButton({
  type,
  setType,
  size = 'md'
}: {
  type: 'text' | 'password'
  setType: React.Dispatch<React.SetStateAction<'text' | 'password'>>
  size: VariantProps<typeof inputVariants>['size']
}) {
  const togglePassword = useCallback(() => {
    if (type === 'password') {
      setType('text')
    } else if (type === 'text') {
      setType('password')
    }
  }, [setType, type])

  return (
    <button type="button" onClick={togglePassword} className="w-auto">
      {type === 'text' && <EyeIcon className={iconVariants({ size })} />}
      {type === 'password' && <EyeOffIcon className={iconVariants({ size })} />}
    </button>
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
        return <Edit2Icon className={iconVariants({ size })} />
      case 'email':
        return
    }
  }, [size, variant])

  const endContent = useMemo(() => {
    if ((variant === 'default' || variant === 'button') && isPassword) {
      return <ShowPasswordButton type={htmlType} setType={setHtmlType} size={size} />
    } else {
      return null
    }
  }, [htmlType, isPassword, size, variant])

  const buttonContent = useMemo(() => {
    if (buttonProps === undefined) {
      console.warn("CustomizedInput: 'button' variant requires a 'button' prop to be provided.")
      return null
    } else {
      return (
        <button type="button" className={buttonVariants({ size })} onClick={buttonProps.onClick}>
          <div className={buttonLabelVariants({ size })}>{buttonProps.label}</div>
        </button>
      )
    }
  }, [buttonProps, size])

  return (
    <InputGroup className={inputGroupVariants()}>
      <div className={inputWrapperVariants({ size, variant })}>
        <InputGroupInput
          type={isPassword ? htmlType : type}
          disabled={toUndefinedIfNull(disabled)}
          className={cn(inputVariants({ size, variant, disabled }), className)}
          {...rest}
        />
        <InputGroupAddon className="p-0">{startContent}</InputGroupAddon>
        <InputGroupAddon align="inline-end" className="p-0 has-[>button]:mr-0">
          {endContent}
        </InputGroupAddon>
      </div>
      {variant === 'button' && buttonContent}
    </InputGroup>
  )
}

export { CompositeInput, type CompositeInputProps }
