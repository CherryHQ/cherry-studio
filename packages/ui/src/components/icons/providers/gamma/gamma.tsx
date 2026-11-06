import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { GammaAvatar } from './avatar'
import { GammaDark } from './dark'
import { GammaLight } from './light'

const Gamma = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <GammaLight {...props} className={className} />
  if (variant === 'dark') return <GammaDark {...props} className={className} />
  return (
    <>
      <GammaLight className={cn('dark:hidden', className)} {...props} />
      <GammaDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const GammaIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Gamma, {
  Avatar: GammaAvatar,
  colorPrimary: '#000000'
})

export default GammaIcon
