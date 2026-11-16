import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { ApplicationAvatar } from './avatar'
import { ApplicationDark } from './dark'
import { ApplicationLight } from './light'

const Application = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <ApplicationLight {...props} className={className} />
  if (variant === 'dark') return <ApplicationDark {...props} className={className} />
  return (
    <>
      <ApplicationLight className={cn('dark:hidden', className)} {...props} />
      <ApplicationDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const ApplicationIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Application, {
  Avatar: ApplicationAvatar,
  colorPrimary: '#2BA471'
})

export default ApplicationIcon
