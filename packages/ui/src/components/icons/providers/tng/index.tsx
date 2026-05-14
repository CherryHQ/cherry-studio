import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { TngAvatar } from './avatar'
import { TngDark } from './dark'
import { TngLight } from './light'

const Tng = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <TngLight {...props} className={className} />
  if (variant === 'dark') return <TngDark {...props} className={className} />
  return (
    <>
      <TngLight className={cn('dark:hidden', className)} {...props} />
      <TngDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const TngIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Tng, {
  Avatar: TngAvatar,
  colorPrimary: '#FDFEFE'
})

export default TngIcon
