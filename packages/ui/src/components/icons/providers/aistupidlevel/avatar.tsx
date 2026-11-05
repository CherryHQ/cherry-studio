import { Avatar, AvatarFallback } from '@cherrystudio/ui/components/primitives/avatar'
import { cn } from '@cherrystudio/ui/lib/utils'

import { type IconAvatarProps } from '../../types'
import { AistupidlevelDark } from './dark'
import { AistupidlevelLight } from './light'

export function AistupidlevelAvatar({ size = 32, shape = 'circle', className }: Omit<IconAvatarProps, 'icon'>) {
  return (
    <Avatar
      className={cn('overflow-hidden', shape === 'circle' ? 'rounded-full' : 'rounded-[20%]', className)}
      style={{ width: size, height: size }}>
      <AvatarFallback className="text-foreground bg-background">
        <AistupidlevelLight className="dark:hidden" style={{ width: size, height: size }} />
        <AistupidlevelDark className="hidden dark:block" style={{ width: size, height: size }} />
      </AvatarFallback>
    </Avatar>
  )
}
