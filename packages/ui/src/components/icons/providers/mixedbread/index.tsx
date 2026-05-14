import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { MixedbreadAvatar } from './avatar'
import { MixedbreadDark } from './dark'
import { MixedbreadLight } from './light'

const Mixedbread = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <MixedbreadLight {...props} className={className} />
  if (variant === 'dark') return <MixedbreadDark {...props} className={className} />
  return (
    <>
      <MixedbreadLight className={cn('dark:hidden', className)} {...props} />
      <MixedbreadDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const MixedbreadIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Mixedbread, {
  Avatar: MixedbreadAvatar,
  colorPrimary: '#EC6168'
})

export default MixedbreadIcon
