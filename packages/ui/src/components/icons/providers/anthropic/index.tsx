import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { AnthropicAvatar } from './avatar'
import { AnthropicDark } from './dark'
import { AnthropicLight } from './light'

const Anthropic = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <AnthropicLight {...props} className={className} />
  if (variant === 'dark') return <AnthropicDark {...props} className={className} />
  return (
    <>
      <AnthropicLight className={cn('dark:hidden', className)} {...props} />
      <AnthropicDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const AnthropicIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Anthropic, {
  Avatar: AnthropicAvatar,
  colorPrimary: '#CA9F7B'
})

export default AnthropicIcon
