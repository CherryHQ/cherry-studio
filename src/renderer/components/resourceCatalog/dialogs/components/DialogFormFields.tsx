import { ChevronDown } from 'lucide-react'
import { type ComponentProps, type ComponentPropsWithoutRef, type FC, type ReactNode } from 'react'

import { Button, EmojiAvatar, Popover, PopoverContent, PopoverTrigger } from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'
import ModelAvatar from '@renderer/components/Avatar/ModelAvatar'
import { EmojiPicker } from '@renderer/components/EmojiPicker'

export const EmojiAvatarPicker: FC<{
  value: string
  fallback: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onChange: (emoji: string) => void
  ariaLabel: string
  disabled?: boolean
  portalContainer: HTMLElement | null
  size?: 'sm' | 'md'
  avatarClassName?: string
  avatarFontSize?: number
}> = ({
  value,
  fallback,
  open,
  onOpenChange,
  onChange,
  ariaLabel,
  disabled,
  portalContainer,
  size = 'md',
  avatarClassName,
  avatarFontSize
}) => {
  // 'md' matches the h-8 Input the avatar sits beside in the edit dialogs.
  const avatarSize = size === 'sm' ? 36 : 32
  const fontSize = avatarFontSize ?? (size === 'sm' ? 18 : 16)

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          aria-label={ariaLabel}
          disabled={disabled}
          className={cn(
            'min-h-0 rounded-lg p-0 text-foreground shadow-none transition-opacity hover:bg-transparent hover:text-foreground hover:opacity-80 focus-visible:bg-transparent focus-visible:opacity-80',
            size === 'sm' ? 'size-9' : 'size-8'
          )}>
          {/* Match the adjacent Input's rounded-lg + hairline border. */}
          <EmojiAvatar
            size={avatarSize}
            fontSize={fontSize}
            className={cn('rounded-lg border border-border', avatarClassName)}>
            {value || fallback}
          </EmojiAvatar>
        </Button>
      </PopoverTrigger>
      <PopoverContent portalContainer={portalContainer} className="w-auto p-0">
        <EmojiPicker
          onEmojiClick={(emoji) => {
            onChange(emoji)
            onOpenChange(false)
          }}
        />
      </PopoverContent>
    </Popover>
  )
}

export function DialogModelFrame({ invalid, children }: { invalid?: boolean; children: ReactNode }) {
  return (
    <div
      className={cn(
        'flex w-full min-w-0 items-center transition-colors',
        invalid && 'rounded-md ring-1 ring-destructive/50 ring-offset-1 ring-offset-background'
      )}>
      {children}
    </div>
  )
}

type DialogModelTriggerProps = Omit<ComponentPropsWithoutRef<typeof Button>, 'children'> & {
  displayLabel: ReactNode
  model?: ComponentProps<typeof ModelAvatar>['model']
  ariaLabel?: string
  ariaLabelledBy?: string
  chevronClassName?: string
}

export const DialogModelTrigger = ({
  ref,
  displayLabel,
  disabled,
  model,
  ariaLabel,
  ariaLabelledBy,
  chevronClassName,
  className,
  type,
  ...props
}: DialogModelTriggerProps & { ref?: React.RefObject<HTMLButtonElement | null> }) => (
  <Button
    {...props}
    ref={ref}
    type={type ?? 'button'}
    variant="ghost"
    size="sm"
    disabled={disabled}
    aria-label={ariaLabel}
    aria-labelledby={ariaLabelledBy}
    className={cn(
      // Mirrors the shared SelectTrigger recipe (bg-muted/50, borderless, rounded-lg).
      'h-8 max-w-full min-w-0 shrink-0 justify-between gap-2 rounded-lg bg-muted/50 px-2.5 text-sm font-normal shadow-none transition-colors hover:bg-muted hover:text-foreground focus-visible:bg-muted focus-visible:text-foreground aria-expanded:bg-muted',
      model ? 'text-foreground' : 'text-muted-foreground',
      className
    )}>
    <span className="flex min-w-0 flex-1 items-center gap-2">
      {model ? <ModelAvatar model={model} size={18} /> : null}
      <span className="min-w-0 flex-1 truncate text-left">{displayLabel}</span>
    </span>
    <ChevronDown
      aria-hidden="true"
      className={cn('size-3.5 shrink-0 text-muted-foreground transition-opacity', chevronClassName)}
    />
  </Button>
)

DialogModelTrigger.displayName = 'DialogModelTrigger'
