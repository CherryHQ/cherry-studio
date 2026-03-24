import { cn } from '../../../../lib/utils'
import { Avatar, AvatarFallback } from '../../../primitives/avatar'
import { type IconAvatarProps } from '../../types'
import { Gpt52Pro } from './color'

export function Gpt52ProAvatar({ size = 32, shape = 'circle', className }: Omit<IconAvatarProps, 'icon'>) {
  return (
    <Avatar
      className={cn('overflow-hidden', shape === 'circle' ? 'rounded-full' : 'rounded-[20%]', className)}
      style={{ width: size, height: size }}>
      <AvatarFallback className="text-foreground">
        <Gpt52Pro style={{ width: size, height: size }} />
      </AvatarFallback>
    </Avatar>
  )
}
