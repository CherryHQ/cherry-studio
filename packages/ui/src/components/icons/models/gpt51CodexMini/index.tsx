import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { Gpt51CodexMiniAvatar } from './avatar'
import { Gpt51CodexMiniDark } from './dark'
import { Gpt51CodexMiniLight } from './light'

const Gpt51CodexMini = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <Gpt51CodexMiniLight {...props} className={className} />
  if (variant === 'dark') return <Gpt51CodexMiniDark {...props} className={className} />
  return (
    <>
      <Gpt51CodexMiniLight className={cn('dark:hidden', className)} {...props} />
      <Gpt51CodexMiniDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const Gpt51CodexMiniIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Gpt51CodexMini, {
  Avatar: Gpt51CodexMiniAvatar,
  colorPrimary: '#000000'
})

export default Gpt51CodexMiniIcon
