import { cn } from '../../../../lib/utils'
import { type IconAvatarProps } from '../../types'
import { Gpt5Nano } from './color'

export function Gpt5NanoAvatar({ size = 32, shape = 'circle', className }: Omit<IconAvatarProps, 'icon'>) {
  return (
    <div
      className={cn(
        'overflow-hidden border-[0.5px] border-[var(--color-border)]',
        shape === 'circle' ? 'rounded-full' : 'rounded-[20%]',
        className
      )}
      style={{ width: size, height: size }}>
      <Gpt5Nano style={{ width: size, height: size }} />
    </div>
  )
}
