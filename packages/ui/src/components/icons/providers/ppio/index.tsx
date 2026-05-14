import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { PpioAvatar } from './avatar'
import { PpioDark } from './dark'
import { PpioLight } from './light'

const Ppio = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <PpioLight {...props} className={className} />
  if (variant === 'dark') return <PpioDark {...props} className={className} />
  return (
    <>
      <PpioLight className={cn('dark:hidden', className)} {...props} />
      <PpioDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const PpioIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Ppio, {
  Avatar: PpioAvatar,
  colorPrimary: '#0062E2'
})

export default PpioIcon
