import { cn } from '../../../../lib/utils'
import { Avatar } from '../../../primitives/Avatar'
import { type IconAvatarProps } from '../../types'
import { N8n } from './color'

export function N8nAvatar({ size = 32, shape = 'circle', className }: Omit<IconAvatarProps, 'icon'>) {
  return (
    <Avatar
      showFallback
      icon={<N8n style={{ width: size * 0.75, height: size * 0.75 }} />}
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
