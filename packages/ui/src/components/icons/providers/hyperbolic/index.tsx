import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { HyperbolicAvatar } from './avatar'
import { HyperbolicDark } from './dark'
import { HyperbolicLight } from './light'

const Hyperbolic = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <HyperbolicLight {...props} className={className} />
  if (variant === 'dark') return <HyperbolicDark {...props} className={className} />
  return (
    <>
      <HyperbolicLight className={cn('dark:hidden', className)} {...props} />
      <HyperbolicDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const HyperbolicIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Hyperbolic, {
  Avatar: HyperbolicAvatar,
  colorPrimary: '#594CE9'
})

export default HyperbolicIcon
