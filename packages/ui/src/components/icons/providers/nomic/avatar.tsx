import { Avatar, AvatarFallback } from '@cherrystudio/ui/components/primitives/avatar'
import { cn } from '@cherrystudio/ui/lib/utils'

import { type IconAvatarProps } from '../../types'
import { NomicDark } from './dark'
import { NomicLight } from './light'

export function NomicAvatar({ size = 32, shape = 'circle', className }: Omit<IconAvatarProps, 'icon'>) {
  return (
    <Avatar
      className={cn('overflow-hidden', shape === 'circle' ? 'rounded-full' : 'rounded-[20%]', className)}
      style={{ width: size, height: size }}>
      <AvatarFallback className="text-foreground bg-background">
        <NomicLight className="dark:hidden" style={{ width: size * 0.7, height: size * 0.7 }} />
        <NomicDark className="hidden dark:block" style={{ width: size * 0.7, height: size * 0.7 }} />
      </AvatarFallback>
    </Avatar>
  )
}
