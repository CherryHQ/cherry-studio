import { Avatar, AvatarFallback } from '@cherrystudio/ui/components/primitives/avatar'
import { cn } from '@cherrystudio/ui/lib/utils'

import { type IconAvatarProps } from '../../types'
import { KimiDark } from './dark'
import { KimiLight } from './light'

export function KimiAvatar({ size = 32, shape = 'circle', className }: Omit<IconAvatarProps, 'icon'>) {
  return (
    <Avatar
      className={cn('overflow-hidden', shape === 'circle' ? 'rounded-full' : 'rounded-[20%]', className)}
      style={{ width: size, height: size }}>
      <AvatarFallback className="text-foreground">
        <KimiLight className="dark:hidden" style={{ width: size * 0.82, height: size * 0.82 }} />
        <KimiDark className="hidden dark:block" style={{ width: size * 0.82, height: size * 0.82 }} />
      </AvatarFallback>
    </Avatar>
  )
}
