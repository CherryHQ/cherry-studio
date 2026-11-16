import { Avatar, AvatarFallback } from '@cherrystudio/ui/components/primitives/avatar'
import { cn } from '@cherrystudio/ui/lib/utils'

import { type IconAvatarProps } from '../../types'
import { Gpt6LunaLight } from './light'

export function Gpt6LunaAvatar({ size = 32, shape = 'circle', className }: Omit<IconAvatarProps, 'icon'>) {
  return (
    <Avatar
      className={cn('overflow-hidden', shape === 'circle' ? 'rounded-full' : 'rounded-[20%]', className)}
      style={{ width: size, height: size }}>
      <AvatarFallback className="text-foreground">
        <Gpt6LunaLight style={{ width: size, height: size }} />
      </AvatarFallback>
    </Avatar>
  )
}
