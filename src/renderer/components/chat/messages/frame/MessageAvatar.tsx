import { Avatar, AvatarFallback, AvatarImage } from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'
import EmojiIcon from '@renderer/components/EmojiIcon'
import { isEmoji } from '@renderer/utils/naming'
import type { ComponentPropsWithoutRef, CSSProperties, KeyboardEvent, ReactNode } from 'react'

export const MESSAGE_AVATAR_SIZE = 30
export const MESSAGE_EMOJI_AVATAR_FONT_SIZE = 17
export const MESSAGE_AVATAR_CONTAINER_CLASS =
  'message-avatar flex size-[30px] shrink-0 items-center justify-center overflow-hidden rounded-full p-0'
export const MESSAGE_AVATAR_INNER_CLASS = 'size-full rounded-full p-0'
export const MESSAGE_AVATAR_IMAGE_CLASS = 'size-full object-cover p-0'
export const MESSAGE_AVATAR_FALLBACK_CLASS = 'size-full rounded-full p-0'
export const MESSAGE_MODEL_AVATAR_ICON_CLASS = 'size-full'

export const MessageAvatarFrame = ({
  className,
  onClick,
  onKeyDown,
  role,
  tabIndex,
  ...props
}: ComponentPropsWithoutRef<'div'>) => {
  const clickable = !!onClick
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    onKeyDown?.(event)
    if (event.defaultPrevented || !clickable || (event.key !== 'Enter' && event.key !== ' ')) return

    event.preventDefault()
    event.currentTarget.click()
  }

  return (
    <div
      className={cn(
        MESSAGE_AVATAR_CONTAINER_CLASS,
        clickable && 'cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
        className
      )}
      onClick={onClick}
      onKeyDown={handleKeyDown}
      role={clickable ? (role ?? 'button') : role}
      tabIndex={clickable ? (tabIndex ?? 0) : tabIndex}
      {...props}
    />
  )
}

interface MessageAvatarProps extends ComponentPropsWithoutRef<'div'> {
  avatar?: string
  fallback?: ReactNode
  fallbackAvatarStyle?: CSSProperties
}

const MessageAvatar = ({
  avatar = '',
  fallback,
  fallbackAvatarStyle,
  className,
  onClick,
  ...props
}: MessageAvatarProps) => {
  return (
    <MessageAvatarFrame className={className} onClick={onClick} {...props}>
      {isEmoji(avatar) ? (
        <EmojiIcon
          emoji={avatar}
          className="mr-0"
          size={MESSAGE_AVATAR_SIZE}
          fontSize={MESSAGE_EMOJI_AVATAR_FONT_SIZE}
        />
      ) : (
        <Avatar className={MESSAGE_AVATAR_INNER_CLASS} style={!avatar ? fallbackAvatarStyle : undefined}>
          {avatar && <AvatarImage className={MESSAGE_AVATAR_IMAGE_CLASS} src={avatar} />}
          {fallback !== undefined && (
            <AvatarFallback className={MESSAGE_AVATAR_FALLBACK_CLASS}>{fallback}</AvatarFallback>
          )}
        </Avatar>
      )}
    </MessageAvatarFrame>
  )
}

export default MessageAvatar
