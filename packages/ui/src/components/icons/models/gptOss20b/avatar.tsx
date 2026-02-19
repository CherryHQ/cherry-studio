import { cn } from '../../../../lib/utils'
import { Avatar } from '../../../primitives/Avatar'
import { type IconAvatarProps } from '../../types'
import { GptOss20b } from './color'

export function GptOss20bAvatar({ size = 32, shape = 'circle', className }: Omit<IconAvatarProps, 'icon'>) {
  return (
    <Avatar
      showFallback
      icon={<GptOss20b style={{ width: size, height: size }} />}
      radius={shape === 'circle' ? 'full' : 'none'}
      className={cn('overflow-hidden', shape !== 'circle' && 'rounded-[20%]', className)}
      style={{ width: size, height: size }}
    />
  )
}
