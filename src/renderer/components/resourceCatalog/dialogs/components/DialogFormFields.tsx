import { Avatar, AvatarImage, Button, EmojiAvatar, Popover, PopoverContent, PopoverTrigger } from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'
import ModelAvatar from '@renderer/components/Avatar/ModelAvatar'
import { EmojiPicker } from '@renderer/components/EmojiPicker'
import { ChevronDown } from 'lucide-react'
import {
  type ComponentProps,
  type ComponentPropsWithoutRef,
  type FC,
  type ReactNode,
  useMemo,
  useRef,
  useState
} from 'react'

function imageDataUrl(data: Uint8Array | null | undefined): string | undefined {
  if (!data) return undefined
  let binary = ''
  const chunkSize = 0x8000
  for (let offset = 0; offset < data.length; offset += chunkSize) {
    binary += String.fromCharCode(...data.subarray(offset, offset + chunkSize))
  }
  return `data:image/webp;base64,${btoa(binary)}`
}

export const EmojiAvatarPicker: FC<{
  value: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onChange: (emoji: string) => void | Promise<void>
  ariaLabel: string
  disabled?: boolean
  portalContainer: HTMLElement | null
  size?: 'sm' | 'md'
  imageSrc?: string
  imageData?: Uint8Array | null
  onImageSelect?: (file: File) => void
  uploading?: boolean
  uploadLabel?: string
  emojiLabel?: string
}> = ({
  value,
  open,
  onOpenChange,
  onChange,
  ariaLabel,
  disabled,
  portalContainer,
  size = 'md',
  imageSrc,
  imageData,
  onImageSelect,
  uploading = false,
  uploadLabel = 'Upload image',
  emojiLabel = 'Choose emoji'
}) => {
  // 'md' matches the h-8 Input the avatar sits beside in the edit dialogs.
  const avatarSize = size === 'sm' ? 36 : 32
  const fontSize = size === 'sm' ? 18 : 16
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [view, setView] = useState<'menu' | 'emoji'>('menu')
  const stagedImageSrc = useMemo(() => imageDataUrl(imageData), [imageData])
  const displayedImageSrc = stagedImageSrc ?? imageSrc

  const handleOpenChange = (nextOpen: boolean) => {
    onOpenChange(nextOpen)
    if (!nextOpen) setView('menu')
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          aria-label={ariaLabel}
          disabled={disabled}
          className={cn(
            'min-h-0 rounded-lg p-0 text-foreground shadow-none transition-opacity hover:bg-transparent hover:text-foreground hover:opacity-80 focus-visible:ring-2 focus-visible:ring-ring/50',
            size === 'sm' ? 'size-9' : 'size-8'
          )}>
          {/* Match the adjacent Input's rounded-lg + hairline border. */}
          {displayedImageSrc ? (
            <Avatar
              className={cn('rounded-lg border border-border', size === 'sm' ? 'size-9' : 'size-8')}
              style={{ width: avatarSize, height: avatarSize }}>
              <AvatarImage src={displayedImageSrc} className="object-cover" />
            </Avatar>
          ) : (
            <EmojiAvatar size={avatarSize} fontSize={fontSize} className="rounded-lg border border-border">
              {value}
            </EmojiAvatar>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent portalContainer={portalContainer} className="w-auto p-2">
        {view === 'emoji' || !onImageSelect ? (
          <EmojiPicker
            onEmojiClick={(emoji) => {
              void Promise.resolve(onChange(emoji)).then(() => handleOpenChange(false))
            }}
          />
        ) : (
          <div className="flex w-40 flex-col gap-1">
            <input
              ref={fileInputRef}
              className="hidden"
              type="file"
              accept="image/png,image/jpeg,image/gif,image/webp"
              onChange={(event) => {
                const file = event.target.files?.[0]
                event.target.value = ''
                if (file) onImageSelect(file)
              }}
            />
            <Button
              type="button"
              variant="ghost"
              loading={uploading}
              className="w-full justify-center"
              onClick={() => fileInputRef.current?.click()}>
              {uploadLabel}
            </Button>
            <Button type="button" variant="ghost" className="w-full justify-center" onClick={() => setView('emoji')}>
              {emojiLabel}
            </Button>
          </div>
        )}
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
      'h-8 min-w-0 max-w-full shrink-0 justify-between gap-2 rounded-lg bg-muted/50 px-2.5 font-normal text-sm shadow-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring/40 aria-expanded:bg-muted',
      model ? 'text-foreground' : 'text-muted-foreground',
      className
    )}>
    <span className="flex min-w-0 flex-1 items-center gap-2">
      {model ? <ModelAvatar model={model} size={18} /> : null}
      <span className="min-w-0 flex-1 truncate text-left">{displayLabel}</span>
    </span>
    <ChevronDown
      aria-hidden="true"
      className={cn('size-3.5 shrink-0 text-muted-foreground/70 transition-opacity', chevronClassName)}
    />
  </Button>
)

DialogModelTrigger.displayName = 'DialogModelTrigger'
