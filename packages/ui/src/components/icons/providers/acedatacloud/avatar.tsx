import { Avatar, AvatarFallback } from '@cherrystudio/ui/components/primitives/avatar'
import { cn } from '@cherrystudio/ui/lib/utils'

import { type IconAvatarProps } from '../../types'
import { AcedatacloudDark } from './dark'
import { AcedatacloudLight } from './light'

export function AcedatacloudAvatar({ size = 32, shape = 'circle', className }: Omit<IconAvatarProps, 'icon'>) {
  return (
    <Avatar
      className={cn('overflow-hidden', shape === 'circle' ? 'rounded-full' : 'rounded-[20%]', className)}
      style={{ width: size, height: size }}>
      <AvatarFallback className="text-foreground bg-background">
        <AcedatacloudLight className="dark:hidden" style={{ width: size, height: size }} />
        <AcedatacloudDark className="hidden dark:block" style={{ width: size, height: size }} />
      </AvatarFallback>
    </Avatar>
  )
}
