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
import { useState } from 'react'

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
  ...props
}: SecretInputProps) {
  const [isVisible, setIsVisible] = useState(false)
  const visibilityLabel = isVisible ? hideLabel : showLabel

  return (
    <InputGroup className={className} size={size} data-disabled={disabled ? 'true' : undefined}>
      <InputGroupInput
        {...props}
        ref={ref}
        type={isVisible ? 'text' : 'password'}
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
