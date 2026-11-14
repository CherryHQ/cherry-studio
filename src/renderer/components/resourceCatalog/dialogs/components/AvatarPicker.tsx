import { Dices, ImageUp, RotateCcw } from 'lucide-react'
import { type ReactNode, useRef } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, EmojiAvatar, Popover, PopoverContent, PopoverTrigger, Tooltip } from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'
import { AssistantAvatarImage } from '@renderer/components/Avatar/AssistantAvatarImage'
import { EmojiPicker } from '@renderer/components/EmojiPicker'

const RANDOM_AVATAR_EMOJIS = [
  '💬',
  '✍️',
  '🧑‍💻',
  '📚',
  '🧠',
  '🔍',
  '🎨',
  '📈',
  '🧪',
  '🌐',
  '🗂️',
  '📝',
  '⚡️',
  '🛠️',
  '🎯',
  '🍒',
  '🦉',
  '🐙',
  '🚀',
  '🧭',
  '📮',
  '🎧',
  '🧾',
  '🦊',
  '🐼',
  '🐳',
  '🌱',
  '🍀',
  '🌈',
  '🔮',
  '🎲'
]

/** A random avatar emoji that differs from `current`. */
export function pickRandomAvatarEmoji(current?: string): string {
  const pool = RANDOM_AVATAR_EMOJIS.filter((emoji) => emoji !== current)
  return pool[Math.floor(Math.random() * pool.length)]
}

type AvatarPickerProps = {
  /** The emoji shown when there is no image (callers apply their own fallback). */
  emoji: string
  imageSrc?: string
  open: boolean
  onOpenChange: (open: boolean) => void
  /** A picked or randomly rolled emoji. */
  onEmojiChange: (emoji: string) => void
  onUpload: (file: File) => void
  /** Removes the image; offered only while there is one. */
  onReset: () => void
  ariaLabel: string
  disabled?: boolean
  /** Locks the popover while the caller is applying a change. */
  pending?: boolean
  portalContainer: HTMLElement | null
  size?: 'sm' | 'md' | 'lg'
  avatarClassName?: string
  avatarFontSize?: number
}

function HeaderAction({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <Tooltip content={label}>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={label}
        onClick={onClick}
        className="size-8 shrink-0 rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground">
        {children}
      </Button>
    </Tooltip>
  )
}

/**
 * Avatar trigger plus one popover: a header with remove-image, upload and 🎲 actions over the
 * emoji picker. It only reports choices; the caller saves them (edit) or keeps a draft (create).
 */
export function AvatarPicker({
  emoji,
  imageSrc,
  open,
  onOpenChange,
  onEmojiChange,
  onUpload,
  onReset,
  ariaLabel,
  disabled,
  pending = false,
  portalContainer,
  size = 'md',
  avatarClassName,
  avatarFontSize
}: AvatarPickerProps) {
  const { t } = useTranslation()
  const inputRef = useRef<HTMLInputElement>(null)
  // 'md' matches the h-8 Input the avatar sits beside in the edit dialogs.
  const avatarSize = size === 'lg' ? 84 : size === 'sm' ? 36 : 32
  const fontSize = avatarFontSize ?? (size === 'lg' ? 42 : size === 'sm' ? 18 : 16)
  const uploadLabel = t('library.config.dialogs.create.avatar_upload')

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          aria-label={ariaLabel}
          disabled={disabled || pending}
          className={cn(
            'min-h-0 rounded-lg p-0 text-foreground shadow-none transition-opacity hover:bg-transparent hover:text-foreground hover:opacity-80 focus-visible:bg-transparent focus-visible:opacity-80',
            size === 'lg' ? 'size-21 rounded-[28%]' : size === 'sm' ? 'size-9' : 'size-8'
          )}>
          <AssistantAvatarImage
            src={imageSrc}
            alt={ariaLabel}
            size={avatarSize}
            className={cn('rounded-lg object-cover', avatarClassName)}
            fallback={
              // Match the adjacent Input's rounded-lg + hairline border.
              <EmojiAvatar
                size={avatarSize}
                fontSize={fontSize}
                className={cn('rounded-lg border border-border', avatarClassName)}>
                {emoji}
              </EmojiAvatar>
            }
          />
        </Button>
      </PopoverTrigger>
      <PopoverContent portalContainer={portalContainer} className="w-auto overflow-hidden p-0">
        <fieldset disabled={pending} aria-busy={pending} className="m-0 min-w-0 border-0 p-0">
          <div className="flex items-center justify-between gap-2 px-3 pt-3">
            <span className="font-medium text-foreground text-sm">{ariaLabel}</span>
            <div className="flex items-center">
              {imageSrc ? (
                <HeaderAction label={t('library.config.dialogs.create.avatar_remove_image')} onClick={onReset}>
                  <RotateCcw className="size-4" />
                </HeaderAction>
              ) : null}
              <input
                ref={inputRef}
                type="file"
                className="hidden"
                aria-label={uploadLabel}
                accept="image/png, image/jpeg, image/gif, image/webp"
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  event.target.value = ''
                  if (file) onUpload(file)
                }}
              />
              <HeaderAction label={uploadLabel} onClick={() => inputRef.current?.click()}>
                <ImageUp className="size-4" />
              </HeaderAction>
              <HeaderAction
                label={t('library.config.dialogs.create.avatar_random')}
                onClick={() => onEmojiChange(pickRandomAvatarEmoji(emoji))}>
                <Dices className="size-4" />
              </HeaderAction>
            </div>
          </div>
          <EmojiPicker
            onEmojiClick={(next) => {
              onEmojiChange(next)
              onOpenChange(false)
            }}
          />
        </fieldset>
      </PopoverContent>
    </Popover>
  )
}
