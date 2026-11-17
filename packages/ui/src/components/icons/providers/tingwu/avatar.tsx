import { Avatar, AvatarFallback } from '@cherrystudio/ui/components/primitives/avatar'
import { cn } from '@cherrystudio/ui/lib/utils'

import { type IconAvatarProps } from '../../types'
import { TingwuDark } from './dark'
import { TingwuLight } from './light'

export function TingwuAvatar({ size = 32, shape = 'circle', className }: Omit<IconAvatarProps, 'icon'>) {
  return (
    <Avatar
      className={cn('overflow-hidden', shape === 'circle' ? 'rounded-full' : 'rounded-[20%]', className)}
      style={{ width: size, height: size }}>
      <AvatarFallback className="text-foreground">
        <TingwuLight className="dark:hidden" style={{ width: size, height: size }} />
        <TingwuDark className="hidden dark:block" style={{ width: size, height: size }} />
      </AvatarFallback>
    </Avatar>
  )
}
