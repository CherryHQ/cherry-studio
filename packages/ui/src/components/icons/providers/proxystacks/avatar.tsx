import { Avatar, AvatarFallback } from '@cherrystudio/ui/components/primitives/avatar';
import { cn } from '@cherrystudio/ui/lib/utils';

import { type IconAvatarProps } from '../../types';
import { ProxystacksDark } from './dark';
import { ProxystacksLight } from './light';

export function ProxystacksAvatar({ size = 32, shape = 'circle', className }: Omit<IconAvatarProps, 'icon'>) {
  return (
      <Avatar
        className={cn(
          'overflow-hidden',
          shape === 'circle' ? 'rounded-full' : 'rounded-[20%]',
          className
        )}
        style={{ width: size, height: size }}
      >
        <AvatarFallback className="text-foreground">
          <ProxystacksLight
            className="dark:hidden"
            style={{ width: size, height: size }}
          />
          <ProxystacksDark
            className="hidden dark:block"
            style={{ width: size, height: size }}
          />
        </AvatarFallback>
      </Avatar>
    )
}
