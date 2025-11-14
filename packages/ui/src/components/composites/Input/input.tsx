import { toUndefinedIfNull } from '@cherrystudio/ui/utils'
import type { VariantProps } from 'class-variance-authority'
import { cva } from 'class-variance-authority'
import { Edit2Icon, EyeIcon, EyeOffIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { useCallback, useMemo, useState } from 'react'

import { Button } from '../../primitives/button'
import type { InputProps } from '../../primitives/input'
import { InputGroup, InputGroupAddon, InputGroupInput } from '../../primitives/input-group'

const compositeInputVariants = cva([], {
  variants: {
    size: {
      sm: [],
      md: [],
      lg: []
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

const iconVariants = cva([], {
  variants: {
    size: {
      sm: [],
      md: [],
      lg: []
    }
  },
  defaultVariants: {
    size: 'md'
  }
})

function ShowPasswordButton({
  type,
  setType,
  iconClassName
}: {
  type: 'text' | 'password'
  setType: React.Dispatch<React.SetStateAction<'text' | 'password'>>
  iconClassName: string
}) {
  const togglePassword = useCallback(() => {
    if (type === 'password') {
      setType('text')
    } else if (type === 'text') {
      setType('password')
    }
  }, [setType, type])

  return (
    <Button onClick={togglePassword}>
      {type === 'text' && <EyeIcon className={iconClassName} />}
      {type === 'password' && <EyeOffIcon className={iconClassName} />}
    </Button>
  )
}

interface CompositeInputProps
  extends Omit<InputProps, 'size' | 'disabled'>,
    VariantProps<typeof compositeInputVariants> {
  button?: {
    label: ReactNode
    onClick: React.DOMAttributes<HTMLButtonElement>['onClick']
  }
}

function CompositeInput({ type, size, variant = 'default', disabled, button, ...rest }: CompositeInputProps) {
  const iconClassName = iconVariants({ size })
  const isPassword = type === 'password'
  const [htmlType, setHtmlType] = useState<'text' | 'password'>('password')

  if (variant === 'button' && button === undefined) {
    console.warn("CustomizedInput: 'button' variant requires a 'button' prop to be provided.")
  }

  const startContent = useMemo(() => {
    switch (variant) {
      case 'default':
      case 'button':
        return <Edit2Icon className={iconClassName} />
      case 'email':
        return
    }
  }, [iconClassName, variant])

  const endContent = useMemo(() => {
    return (
      <>
        {(variant === 'default' || variant === 'button') && isPassword && (
          <ShowPasswordButton type={htmlType} setType={setHtmlType} iconClassName={iconClassName} />
        )}
        {variant === 'button' && (
          <Button className="border-l-[1px]" onClick={button?.onClick}>
            {button?.label}
          </Button>
        )}
      </>
    )
  }, [button?.label, button?.onClick, htmlType, iconClassName, isPassword, variant])

  return (
    <InputGroup>
      <InputGroupInput type={isPassword ? htmlType : type} disabled={toUndefinedIfNull(disabled)} {...rest} />
      <InputGroupAddon>{startContent}</InputGroupAddon>
      <InputGroupAddon align="inline-end">{endContent}</InputGroupAddon>
    </InputGroup>
  )
}

export { CompositeInput, type CompositeInputProps }
