import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { AbacusAvatar } from './avatar'
import { AbacusDark } from './dark'
import { AbacusLight } from './light'

const Abacus = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <AbacusLight {...props} className={className} />
  if (variant === 'dark') return <AbacusDark {...props} className={className} />
  return (
    <>
      <AbacusLight className={cn('dark:hidden', className)} {...props} />
      <AbacusDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const AbacusIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Abacus, {
  Avatar: AbacusAvatar,
  colorPrimary: '#D7E5F0'
})

export default AbacusIcon
