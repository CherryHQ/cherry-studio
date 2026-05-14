import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { ViduAvatar } from './avatar'
import { ViduDark } from './dark'
import { ViduLight } from './light'

const Vidu = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <ViduLight {...props} className={className} />
  if (variant === 'dark') return <ViduDark {...props} className={className} />
  return (
    <>
      <ViduLight className={cn('dark:hidden', className)} {...props} />
      <ViduDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const ViduIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Vidu, {
  Avatar: ViduAvatar,
  colorPrimary: '#000000'
})

export default ViduIcon
