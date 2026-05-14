import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { BflAvatar } from './avatar'
import { BflDark } from './dark'
import { BflLight } from './light'

const Bfl = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <BflLight {...props} className={className} />
  if (variant === 'dark') return <BflDark {...props} className={className} />
  return (
    <>
      <BflLight className={cn('dark:hidden', className)} {...props} />
      <BflDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const BflIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Bfl, {
  Avatar: BflAvatar,
  colorPrimary: '#000000'
})

export default BflIcon
