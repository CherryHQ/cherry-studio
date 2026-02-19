import { cn } from '../../../../lib/utils'
import { Avatar } from '../../../primitives/Avatar'
import { type IconAvatarProps } from '../../types'
import { Macos } from './color'

export function MacosAvatar({ size = 32, shape = 'circle', className }: Omit<IconAvatarProps, 'icon'>) {
  return (
    <Avatar
      showFallback
      icon={<Macos style={{ width: size * 0.75, height: size * 0.75 }} />}
      radius={shape === 'circle' ? 'full' : 'none'}
      className={cn('overflow-hidden bg-background', shape !== 'circle' && 'rounded-[20%]', className)}
      style={{ width: size, height: size }}
    />
  )
}
