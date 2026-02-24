import { cn } from '../../../../lib/utils'
import { Avatar, AvatarFallback } from '../../../primitives/avatar'
import { type IconAvatarProps } from '../../types'
import { Genspark } from './color'

export function GensparkAvatar({ size = 32, shape = 'circle', className }: Omit<IconAvatarProps, 'icon'>) {
  return (
    <Avatar
      className={cn('overflow-hidden', shape === 'circle' ? 'rounded-full' : 'rounded-[20%]', className)}
      style={{ width: size, height: size }}>
      <AvatarFallback className="text-foreground">
        <Genspark style={{ width: size, height: size }} />
      </AvatarFallback>
    </Avatar>
  )
}
