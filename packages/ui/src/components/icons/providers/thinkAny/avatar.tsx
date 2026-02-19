import { cn } from '../../../../lib/utils'
import { Avatar, AvatarFallback } from '../../../primitives/avatar'
import { type IconAvatarProps } from '../../types'
import { ThinkAny } from './color'

export function ThinkAnyAvatar({ size = 32, shape = 'circle', className }: Omit<IconAvatarProps, 'icon'>) {
  return (
    <Avatar
      className={cn('overflow-hidden', shape === 'circle' ? 'rounded-full' : 'rounded-[20%]', className)}
      style={{ width: size, height: size }}>
      <AvatarFallback className="text-foreground bg-background">
        <ThinkAny style={{ width: size * 0.75, height: size * 0.75 }} />
      </AvatarFallback>
    </Avatar>
  )
}
