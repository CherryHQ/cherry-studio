import { cn } from '../../../../lib/utils'
import type { IconAvatarProps } from '../../types'
import { Gpt51Codex } from './color'

export function Gpt51CodexAvatar({ size = 32, shape = 'circle', className }: Omit<IconAvatarProps, 'icon'>) {
  return (
    <div
      className={cn(
        'overflow-hidden border-[0.5px] border-[var(--color-border)]',
        shape === 'circle' ? 'rounded-full' : 'rounded-[20%]',
        className
      )}
      style={{ width: size, height: size }}>
      <Gpt51Codex style={{ width: size, height: size }} />
    </div>
  )
}
