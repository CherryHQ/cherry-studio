import { Avatar, AvatarFallback } from '@cherrystudio/ui/components/primitives/avatar'
import { cn } from '@cherrystudio/ui/lib/utils'

import { type IconAvatarProps } from '../../types'
import { XiaomimimoDark } from './dark'
import { XiaomimimoLight } from './light'

export function XiaomimimoAvatar({ size = 32, shape = 'circle', className }: Omit<IconAvatarProps, 'icon'>) {
  return (
    <Avatar
      className={cn('overflow-hidden', shape === 'circle' ? 'rounded-full' : 'rounded-[20%]', className)}
      style={{ width: size, height: size }}>
      <AvatarFallback className="text-foreground bg-background">
        <XiaomimimoLight className="dark:hidden" style={{ width: size * 0.6, height: size * 0.6 }} />
        <XiaomimimoDark className="hidden dark:block" style={{ width: size * 0.6, height: size * 0.6 }} />
      </AvatarFallback>
    </Avatar>
  )
}
