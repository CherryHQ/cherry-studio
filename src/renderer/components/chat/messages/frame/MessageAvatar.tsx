import { Avatar, AvatarFallback, AvatarImage, EmojiAvatar } from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'
import { isEmoji } from '@renderer/utils'
import type { ComponentPropsWithoutRef, CSSProperties, ReactNode } from 'react'

export const MESSAGE_AVATAR_SIZE = 30
export const MESSAGE_EMOJI_AVATAR_FONT_SIZE = 17
export const MESSAGE_AVATAR_CONTAINER_CLASS =
  'message-avatar flex size-[30px] shrink-0 items-center justify-center overflow-hidden rounded-full p-0'
export const MESSAGE_AVATAR_INNER_CLASS = 'size-full rounded-full p-0'
export const MESSAGE_AVATAR_IMAGE_CLASS = 'size-full object-cover p-0'
export const MESSAGE_AVATAR_FALLBACK_CLASS = 'size-full rounded-full p-0'
export const MESSAGE_MODEL_AVATAR_ICON_CLASS = 'size-full'

export const MessageAvatarFrame = ({ className, ...props }: ComponentPropsWithoutRef<'div'>) => (
  <div className={cn(MESSAGE_AVATAR_CONTAINER_CLASS, className)} {...props} />
)

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
  const clickable = !!onClick

  return (
    <MessageAvatarFrame className={cn(clickable && 'cursor-pointer', className)} onClick={onClick} {...props}>
      {isEmoji(avatar) ? (
        <EmojiAvatar
          className={MESSAGE_AVATAR_INNER_CLASS}
          size={MESSAGE_AVATAR_SIZE}
          fontSize={MESSAGE_EMOJI_AVATAR_FONT_SIZE}>
          {avatar}
        </EmojiAvatar>
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
