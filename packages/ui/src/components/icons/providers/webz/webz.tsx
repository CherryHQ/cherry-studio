import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { WebzAvatar } from './avatar'
import { WebzDark } from './dark'
import { WebzLight } from './light'

const Webz = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <WebzLight {...props} className={className} />
  if (variant === 'dark') return <WebzDark {...props} className={className} />
  return (
    <>
      <WebzLight className={cn('dark:hidden', className)} {...props} />
      <WebzDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const WebzIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Webz, {
  Avatar: WebzAvatar,
  colorPrimary: '#000000'
})

export default WebzIcon
