import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { Gpt51CodexAvatar } from './avatar'
import { Gpt51CodexDark } from './dark'
import { Gpt51CodexLight } from './light'

const Gpt51Codex = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <Gpt51CodexLight {...props} className={className} />
  if (variant === 'dark') return <Gpt51CodexDark {...props} className={className} />
  return (
    <>
      <Gpt51CodexLight className={cn('dark:hidden', className)} {...props} />
      <Gpt51CodexDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const Gpt51CodexIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Gpt51Codex, {
  Avatar: Gpt51CodexAvatar,
  colorPrimary: '#000000'
})

export default Gpt51CodexIcon
