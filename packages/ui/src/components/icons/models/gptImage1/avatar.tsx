import { cn } from '../../../../lib/utils'
import { type IconAvatarProps } from '../../types'
import { GptImage1 } from './color'

export function GptImage1Avatar({ size = 32, shape = 'circle', className }: Omit<IconAvatarProps, 'icon'>) {
  return (
    <div
      className={cn(
        'overflow-hidden border-[0.5px] border-[var(--color-border)]',
        shape === 'circle' ? 'rounded-full' : 'rounded-[20%]',
        className
      )}
      style={{ width: size, height: size }}>
      <GptImage1 style={{ width: size, height: size }} />
    </div>
  )
}
