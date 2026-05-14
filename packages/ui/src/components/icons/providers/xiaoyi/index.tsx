import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { XiaoyiAvatar } from './avatar'
import { XiaoyiDark } from './dark'
import { XiaoyiLight } from './light'

const Xiaoyi = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <XiaoyiLight {...props} className={className} />
  if (variant === 'dark') return <XiaoyiDark {...props} className={className} />
  return (
    <>
      <XiaoyiLight className={cn('dark:hidden', className)} {...props} />
      <XiaoyiDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const XiaoyiIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Xiaoyi, {
  Avatar: XiaoyiAvatar,
  colorPrimary: '#000000'
})

export default XiaoyiIcon
