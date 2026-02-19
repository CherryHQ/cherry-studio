import { cn } from '../../../../lib/utils'
import { Avatar } from '../../../primitives/Avatar'
import { type IconAvatarProps } from '../../types'
import { Mcprouter } from './color'

export function McprouterAvatar({ size = 32, shape = 'circle', className }: Omit<IconAvatarProps, 'icon'>) {
  return (
    <Avatar
      showFallback
      icon={<Mcprouter style={{ width: size, height: size }} />}
      radius={shape === 'circle' ? 'full' : 'none'}
      className={cn('overflow-hidden', shape !== 'circle' && 'rounded-[20%]', className)}
      style={{ width: size, height: size }}
    />
  )
}
