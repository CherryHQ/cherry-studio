import { cn } from '../../../../lib/utils'
import { Avatar } from '../../../primitives/Avatar'
import { type IconAvatarProps } from '../../types'
import { Fireworks } from './color'

export function FireworksAvatar({ size = 32, shape = 'circle', className }: Omit<IconAvatarProps, 'icon'>) {
  return (
    <Avatar
      showFallback
      icon={<Fireworks style={{ width: size * 0.75, height: size * 0.75 }} />}
      radius={shape === 'circle' ? 'full' : 'none'}
      className={cn(
        'overflow-hidden border-[0.5px] border-[var(--color-border)] bg-background',
        shape !== 'circle' && 'rounded-[20%]',
        className
      )}
      style={{ width: size, height: size }}
    />
  )
}
