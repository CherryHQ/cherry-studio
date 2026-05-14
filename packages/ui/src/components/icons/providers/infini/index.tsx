import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { InfiniAvatar } from './avatar'
import { InfiniDark } from './dark'
import { InfiniLight } from './light'

const Infini = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <InfiniLight {...props} className={className} />
  if (variant === 'dark') return <InfiniDark {...props} className={className} />
  return (
    <>
      <InfiniLight className={cn('dark:hidden', className)} {...props} />
      <InfiniDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const InfiniIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Infini, {
  Avatar: InfiniAvatar,
  colorPrimary: '#6A3CFD'
})

export default InfiniIcon
