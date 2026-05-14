import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { Gpt5CodexAvatar } from './avatar'
import { Gpt5CodexDark } from './dark'
import { Gpt5CodexLight } from './light'

const Gpt5Codex = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <Gpt5CodexLight {...props} className={className} />
  if (variant === 'dark') return <Gpt5CodexDark {...props} className={className} />
  return (
    <>
      <Gpt5CodexLight className={cn('dark:hidden', className)} {...props} />
      <Gpt5CodexDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const Gpt5CodexIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Gpt5Codex, {
  Avatar: Gpt5CodexAvatar,
  colorPrimary: '#000000'
})

export default Gpt5CodexIcon
