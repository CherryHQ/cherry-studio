import { Button, EmojiAvatar, Popover, PopoverContent, PopoverTrigger } from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'
import ModelAvatar from '@renderer/components/Avatar/ModelAvatar'
import EmojiPicker from '@renderer/components/EmojiPicker'
import { CircleDashed } from 'lucide-react'
import { type ComponentProps, type ComponentPropsWithoutRef, type FC, type ReactNode } from 'react'

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
}> = ({ value, fallback, open, onOpenChange, onChange, ariaLabel, disabled, portalContainer, size = 'md' }) => {
  const avatarSize = size === 'sm' ? 36 : 40
  const fontSize = size === 'sm' ? 18 : 20

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          aria-label={ariaLabel}
          disabled={disabled}
          className={cn(
            'min-h-0 rounded-[20%] p-0 text-foreground shadow-none transition-opacity hover:bg-transparent hover:text-foreground hover:opacity-80 focus-visible:ring-2 focus-visible:ring-ring/50',
            size === 'sm' ? 'size-9' : 'size-10'
          )}>
          <EmojiAvatar size={avatarSize} fontSize={fontSize}>
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
        invalid && 'rounded-full ring-1 ring-destructive/50 ring-offset-1 ring-offset-background'
      )}>
      {children}
    </div>
  )
}

type DialogModelTriggerProps = Omit<ComponentPropsWithoutRef<typeof Button>, 'children'> & {
  displayLabel: ReactNode
  providerLabel?: ReactNode
  model?: ComponentProps<typeof ModelAvatar>['model']
  ariaLabel?: string
  ariaLabelledBy?: string
}

export const DialogModelTrigger = ({
  ref,
  displayLabel,
  providerLabel,
  disabled,
  model,
  ariaLabel,
  ariaLabelledBy,
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
      'h-8 min-w-0 max-w-full shrink-0 justify-start gap-2 rounded-md bg-muted/45 px-2 font-normal text-muted-foreground text-sm shadow-none transition-colors hover:bg-muted/70 hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring/40',
      !model && 'text-muted-foreground/70',
      className
    )}>
    {model ? (
      <ModelAvatar model={model} size={18} />
    ) : (
      <span
        className="flex size-4 shrink-0 items-center justify-center rounded-full border border-muted-foreground/35 border-dashed bg-background"
        data-testid="model-trigger-placeholder">
        <CircleDashed size={11} strokeWidth={1.8} />
      </span>
    )}
    <span className="min-w-0 flex-1 truncate text-left">
      {displayLabel}
      {providerLabel ? <span className="text-muted-foreground/70"> | {providerLabel}</span> : null}
    </span>
  </Button>
)

DialogModelTrigger.displayName = 'DialogModelTrigger'
