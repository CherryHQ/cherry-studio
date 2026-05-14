import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { WenxinAvatar } from './avatar'
import { WenxinDark } from './dark'
import { WenxinLight } from './light'

const Wenxin = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <WenxinLight {...props} className={className} />
  if (variant === 'dark') return <WenxinDark {...props} className={className} />
  return (
    <>
      <WenxinLight className={cn('dark:hidden', className)} {...props} />
      <WenxinDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const WenxinIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Wenxin, {
  Avatar: WenxinAvatar,
  colorPrimary: '#012F8D'
})

export default WenxinIcon
