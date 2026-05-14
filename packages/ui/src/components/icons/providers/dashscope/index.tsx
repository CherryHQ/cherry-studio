import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { DashscopeAvatar } from './avatar'
import { DashscopeDark } from './dark'
import { DashscopeLight } from './light'

const Dashscope = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <DashscopeLight {...props} className={className} />
  if (variant === 'dark') return <DashscopeDark {...props} className={className} />
  return (
    <>
      <DashscopeLight className={cn('dark:hidden', className)} {...props} />
      <DashscopeDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const DashscopeIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Dashscope, {
  Avatar: DashscopeAvatar,
  colorPrimary: '#000000'
})

export default DashscopeIcon
