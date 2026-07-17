import { cn } from '@cherrystudio/ui/lib/utils'
import EmojiIcon from '@renderer/components/EmojiIcon'
import type { EntityAvatar } from '@shared/data/types/entityAvatar'
import type { CSSProperties } from 'react'

type EntityAvatarIconProps = {
  avatar: EntityAvatar
  className?: string
  size?: number
  fontSize?: number
}

export function EntityAvatarIcon({ avatar, className, size = 26, fontSize = 15 }: EntityAvatarIconProps) {
  if (avatar.kind === 'emoji') {
    return <EmojiIcon emoji={avatar.emoji} className={className} size={size} fontSize={fontSize} />
  }

  const style: CSSProperties = { width: size, height: size }
  return (
    <div className={cn('mr-[3px] shrink-0 overflow-hidden rounded-full', className)} style={style}>
      <img src={avatar.src} alt="" className="size-full object-cover" />
    </div>
  )
}
