import { Avatar, AvatarFallback } from '@cherrystudio/ui/components/primitives/avatar'
import { cn } from '@cherrystudio/ui/lib/utils'

import { type IconAvatarProps } from '../../types'
import { BailianDark } from './dark'
import { BailianLight } from './light'

export function BailianAvatar({ size = 32, shape = 'circle', className }: Omit<IconAvatarProps, 'icon'>) {
  return (
    <Avatar
      className={cn('overflow-hidden', shape === 'circle' ? 'rounded-full' : 'rounded-[20%]', className)}
      style={{ width: size, height: size }}>
      <AvatarFallback className="text-foreground bg-background">
        <BailianLight className="dark:hidden" style={{ width: size * 0.85, height: size * 0.85 }} />
        <BailianDark className="hidden dark:block" style={{ width: size * 0.85, height: size * 0.85 }} />
      </AvatarFallback>
    </Avatar>
  )
}
