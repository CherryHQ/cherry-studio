import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { PhindAvatar } from './avatar'
import { PhindDark } from './dark'
import { PhindLight } from './light'

const Phind = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <PhindLight {...props} className={className} />
  if (variant === 'dark') return <PhindDark {...props} className={className} />
  return (
    <>
      <PhindLight className={cn('dark:hidden', className)} {...props} />
      <PhindDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const PhindIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Phind, {
  Avatar: PhindAvatar,
  colorPrimary: '#000000'
})

export default PhindIcon
