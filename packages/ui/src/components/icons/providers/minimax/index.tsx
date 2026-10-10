import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { MinimaxAvatar } from './avatar'
import { MinimaxDark } from './dark'
import { MinimaxLight } from './light'

const Minimax = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <MinimaxLight {...props} className={className} />
  if (variant === 'dark') return <MinimaxDark {...props} className={className} />
  return (
    <>
      <MinimaxLight className={cn('dark:hidden', className)} {...props} />
      <MinimaxDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const MinimaxIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Minimax, {
  Avatar: MinimaxAvatar,
  colorPrimary: '#000000'
})

export default MinimaxIcon
