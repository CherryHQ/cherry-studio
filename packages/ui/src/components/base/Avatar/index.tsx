import type { AvatarProps as HeroUIAvatarProps } from '@heroui/react'
import { Avatar as HeroUIAvatar, AvatarGroup as HeroUIAvatarGroup, cn } from '@heroui/react'

import EmojiAvatar from './EmojiAvatar'

export interface AvatarProps extends Omit<HeroUIAvatarProps, 'size'> {
  size?: 'xs' | 'sm' | 'md' | 'lg'
}

const Avatar = (props: AvatarProps) => {
  const { size, className = '', ...rest } = props
  const isExtraSmall = size === 'xs'

  const resolvedSize = isExtraSmall ? undefined : size
  const mergedClassName = cn(isExtraSmall && 'w-6 h-6 text-tiny', 'shadow-lg', className)

  return <HeroUIAvatar size={resolvedSize} className={mergedClassName} {...rest} />
}

Avatar.displayName = 'Avatar'

const AvatarGroup = HeroUIAvatarGroup

AvatarGroup.displayName = 'AvatarGroup'

export { Avatar, AvatarGroup, EmojiAvatar }
