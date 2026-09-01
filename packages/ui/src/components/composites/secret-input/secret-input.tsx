import type { InputProps } from '@cherrystudio/ui/components/primitives/input'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput
} from '@cherrystudio/ui/components/primitives/input-group'
import { NormalTooltip } from '@cherrystudio/ui/components/primitives/tooltip'
import { cn } from '@cherrystudio/ui/lib/utils'
import { Eye, EyeOff } from 'lucide-react'
import type * as React from 'react'
import { useRef, useState } from 'react'

export type SecretInputProps = Omit<InputProps, 'className' | 'size' | 'type'> & {
  /** Accessible and tooltip labels supplied by the localized caller. */
  showLabel: string
  hideLabel: string
  /** Classes for the outer input group. */
  className?: string
  /** Classes for the underlying input element. */
  inputClassName?: string
  /** Field height, forwarded to the underlying input group. */
  size?: React.ComponentProps<typeof InputGroup>['size']
}

function SecretInput({
  className,
  inputClassName,
  size,
  showLabel,
  hideLabel,
  disabled,
  ref,
  spellCheck,
  value,
  onChange,
  ...props
}: SecretInputProps) {
  const [isVisible, setIsVisible] = useState(false)
  const normalizedValue = value === undefined ? undefined : String(value)
  const lastUserValueRef = useRef(normalizedValue)
  const visibilityLabel = isVisible ? hideLabel : showLabel

  if (normalizedValue !== undefined && normalizedValue !== lastUserValueRef.current) {
    lastUserValueRef.current = normalizedValue
    if (isVisible) {
      setIsVisible(false)
    }
  }

  const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    lastUserValueRef.current = event.target.value
    onChange?.(event)
  }

  return (
    <InputGroup className={className} size={size} data-disabled={disabled ? 'true' : undefined}>
      <InputGroupInput
        {...props}
        ref={ref}
        value={value}
        onChange={handleChange}
        type={isVisible ? 'text' : 'password'}
        spellCheck={spellCheck ?? false}
        className={cn('h-full', inputClassName)}
        disabled={disabled}
      />
      <InputGroupAddon align="inline-end">
        <NormalTooltip content={visibilityLabel}>
          <InputGroupButton
            size="icon-xs"
            aria-label={visibilityLabel}
            aria-pressed={isVisible}
            disabled={disabled}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => setIsVisible((visible) => !visible)}>
            {isVisible ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
          </InputGroupButton>
        </NormalTooltip>
      </InputGroupAddon>
    </InputGroup>
  )
}

export { SecretInput }
