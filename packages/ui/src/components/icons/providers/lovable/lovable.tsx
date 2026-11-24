import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { LovableAvatar } from './avatar'
import { LovableDark } from './dark'
import { LovableLight } from './light'

const Lovable = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <LovableLight {...props} className={className} />
  if (variant === 'dark') return <LovableDark {...props} className={className} />
  return (
    <>
      <LovableLight className={cn('dark:hidden', className)} {...props} />
      <LovableDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const LovableIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Lovable, {
  Avatar: LovableAvatar,
  colorPrimary: '#000000'
})

export default LovableIcon
