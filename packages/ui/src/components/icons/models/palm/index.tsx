import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { PalmAvatar } from './avatar'
import { PalmDark } from './dark'
import { PalmLight } from './light'

const Palm = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <PalmLight {...props} className={className} />
  if (variant === 'dark') return <PalmDark {...props} className={className} />
  return (
    <>
      <PalmLight className={cn('dark:hidden', className)} {...props} />
      <PalmDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const PalmIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Palm, {
  Avatar: PalmAvatar,
  colorPrimary: '#FEFEFE'
})

export default PalmIcon
