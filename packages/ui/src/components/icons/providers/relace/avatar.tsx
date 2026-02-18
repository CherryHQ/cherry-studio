import { cn } from '../../../../lib/utils'
import type { IconAvatarProps } from '../../types'
import { Relace } from './color'

export function RelaceAvatar({ size = 32, shape = 'circle', className }: Omit<IconAvatarProps, 'icon'>) {
  return (
    <div
      className={cn(
        'overflow-hidden border-[0.5px] border-[var(--color-border)]',
        shape === 'circle' ? 'rounded-full' : 'rounded-[20%]',
        className
      )}
      style={{ width: size, height: size }}>
      <Relace style={{ width: size, height: size }} />
    </div>
  )
}
