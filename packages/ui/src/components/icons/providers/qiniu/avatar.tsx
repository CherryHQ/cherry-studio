import { Avatar, AvatarFallback } from '@cherrystudio/ui/components/primitives/avatar'
import { cn } from '@cherrystudio/ui/lib/utils'

import { type IconAvatarProps } from '../../types'
import { QiniuDark } from './dark'
import { QiniuLight } from './light'

export function QiniuAvatar({ size = 32, shape = 'circle', className }: Omit<IconAvatarProps, 'icon'>) {
  return (
    <Avatar
      className={cn('overflow-hidden', shape === 'circle' ? 'rounded-full' : 'rounded-[20%]', className)}
      style={{ width: size, height: size }}>
      <AvatarFallback className="text-foreground bg-background">
        <QiniuLight className="dark:hidden" style={{ width: size * 0.85, height: size * 0.85 }} />
        <QiniuDark className="hidden dark:block" style={{ width: size * 0.85, height: size * 0.85 }} />
      </AvatarFallback>
    </Avatar>
  )
}
