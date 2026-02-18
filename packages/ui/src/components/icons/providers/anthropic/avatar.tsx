import { cn } from '../../../../lib/utils'
import { type IconAvatarProps } from '../../types'
import { Anthropic } from './color'

export function AnthropicAvatar({ size = 32, shape = 'circle', className }: Omit<IconAvatarProps, 'icon'>) {
  return (
    <div
      className={cn(
        'overflow-hidden border-[0.5px] border-[var(--color-border)]',
        shape === 'circle' ? 'rounded-full' : 'rounded-[20%]',
        className
      )}
      style={{ width: size, height: size }}>
      <Anthropic style={{ width: size, height: size }} />
    </div>
  )
}
