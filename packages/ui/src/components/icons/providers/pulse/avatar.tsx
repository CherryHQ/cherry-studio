import { cn } from '../../../../lib/utils'
import { type IconAvatarProps } from '../../types'
import { Pulse } from './color'

export function PulseAvatar({ size = 32, shape = 'circle', className }: Omit<IconAvatarProps, 'icon'>) {
  return (
    <div
      className={cn(
        'overflow-hidden border-[0.5px] border-[var(--color-border)]',
        shape === 'circle' ? 'rounded-full' : 'rounded-[20%]',
        className
      )}
      style={{ width: size, height: size }}>
      <Pulse style={{ width: size, height: size }} />
    </div>
  )
}
