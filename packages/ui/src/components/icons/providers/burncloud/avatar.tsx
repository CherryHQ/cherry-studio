import { cn } from '../../../../lib/utils'
import { Avatar } from '../../../primitives/Avatar'
import { type IconAvatarProps } from '../../types'
import { Burncloud } from './color'

export function BurncloudAvatar({ size = 32, shape = 'circle', className }: Omit<IconAvatarProps, 'icon'>) {
  return (
    <Avatar
      showFallback
      icon={<Burncloud style={{ width: size, height: size }} />}
      radius={shape === 'circle' ? 'full' : 'none'}
      className={cn('overflow-hidden', shape !== 'circle' && 'rounded-[20%]', className)}
      style={{ width: size, height: size }}
    />
  )
}
