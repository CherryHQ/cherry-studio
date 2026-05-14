import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { Gpt5MiniAvatar } from './avatar'
import { Gpt5MiniDark } from './dark'
import { Gpt5MiniLight } from './light'

const Gpt5Mini = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <Gpt5MiniLight {...props} className={className} />
  if (variant === 'dark') return <Gpt5MiniDark {...props} className={className} />
  return (
    <>
      <Gpt5MiniLight className={cn('dark:hidden', className)} {...props} />
      <Gpt5MiniDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const Gpt5MiniIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Gpt5Mini, {
  Avatar: Gpt5MiniAvatar,
  colorPrimary: '#000000'
})

export default Gpt5MiniIcon
