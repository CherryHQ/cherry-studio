import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { LitellmAvatar } from './avatar'
import { LitellmDark } from './dark'
import { LitellmLight } from './light'

const Litellm = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <LitellmLight {...props} className={className} />
  if (variant === 'dark') return <LitellmDark {...props} className={className} />
  return (
    <>
      <LitellmLight className={cn('dark:hidden', className)} {...props} />
      <LitellmDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const LitellmIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Litellm, {
  Avatar: LitellmAvatar,
  colorPrimary: '#0117BE'
})

export default LitellmIcon
