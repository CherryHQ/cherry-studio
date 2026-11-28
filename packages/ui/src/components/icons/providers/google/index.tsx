import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { GoogleAvatar } from './avatar'
import { GoogleDark } from './dark'
import { GoogleLight } from './light'

const Google = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <GoogleLight {...props} className={className} />
  if (variant === 'dark') return <GoogleDark {...props} className={className} />
  return (
    <>
      <GoogleLight className={cn('dark:hidden', className)} {...props} />
      <GoogleDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const GoogleIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Google, {
  Avatar: GoogleAvatar,
  colorPrimary: '#3086FF'
})

export default GoogleIcon
