import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { HigressAvatar } from './avatar'
import { HigressDark } from './dark'
import { HigressLight } from './light'

const Higress = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <HigressLight {...props} className={className} />
  if (variant === 'dark') return <HigressDark {...props} className={className} />
  return (
    <>
      <HigressLight className={cn('dark:hidden', className)} {...props} />
      <HigressDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const HigressIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Higress, {
  Avatar: HigressAvatar,
  colorPrimary: '#000000'
})

export default HigressIcon
