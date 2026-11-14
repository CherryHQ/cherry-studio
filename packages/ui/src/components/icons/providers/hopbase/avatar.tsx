import { Avatar, AvatarFallback } from '@cherrystudio/ui/components/primitives/avatar'
import { cn } from '@cherrystudio/ui/lib/utils'

import { type IconAvatarProps } from '../../types'
import { HopbaseDark } from './dark'
import { HopbaseLight } from './light'

export function HopbaseAvatar({ size = 32, shape = 'circle', className }: Omit<IconAvatarProps, 'icon'>) {
  return (
    <Avatar
      className={cn('overflow-hidden', shape === 'circle' ? 'rounded-full' : 'rounded-[20%]', className)}
      style={{ width: size, height: size }}>
      <AvatarFallback className="text-foreground bg-background">
        <HopbaseLight className="dark:hidden" style={{ width: size, height: size }} />
        <HopbaseDark className="hidden dark:block" style={{ width: size, height: size }} />
      </AvatarFallback>
    </Avatar>
  )
}
