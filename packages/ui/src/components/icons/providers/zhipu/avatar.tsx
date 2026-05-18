import { Avatar, AvatarFallback } from '@cherrystudio/ui/components/primitives/avatar'
import { cn } from '@cherrystudio/ui/lib/utils'

import { type IconAvatarProps } from '../../types'
import { ZhipuDark } from './dark'
import { ZhipuLight } from './light'

export function ZhipuAvatar({ size = 32, shape = 'circle', className }: Omit<IconAvatarProps, 'icon'>) {
  return (
    <Avatar
      className={cn('overflow-hidden', shape === 'circle' ? 'rounded-full' : 'rounded-[20%]', className)}
      style={{ width: size, height: size }}>
      <AvatarFallback className="text-foreground bg-background">
        <ZhipuLight className="dark:hidden" style={{ width: size * 0.7, height: size * 0.7 }} />
        <ZhipuDark className="hidden dark:block" style={{ width: size * 0.7, height: size * 0.7 }} />
      </AvatarFallback>
    </Avatar>
  )
}
