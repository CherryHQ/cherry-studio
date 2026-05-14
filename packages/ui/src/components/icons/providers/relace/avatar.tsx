import { Avatar, AvatarFallback } from '@cherrystudio/ui/components/primitives/avatar'
import { cn } from '@cherrystudio/ui/lib/utils'

import { type IconAvatarProps } from '../../types'
import { RelaceDark } from './dark'
import { RelaceLight } from './light'

export function RelaceAvatar({ size = 32, shape = 'circle', className }: Omit<IconAvatarProps, 'icon'>) {
  return (
    <Avatar
      className={cn('overflow-hidden', shape === 'circle' ? 'rounded-full' : 'rounded-[20%]', className)}
      style={{ width: size, height: size }}>
      <AvatarFallback className="text-foreground bg-background">
        <RelaceLight className="dark:hidden" style={{ width: size * 0.85, height: size * 0.85 }} />
        <RelaceDark className="hidden dark:block" style={{ width: size * 0.85, height: size * 0.85 }} />
      </AvatarFallback>
    </Avatar>
  )
}
