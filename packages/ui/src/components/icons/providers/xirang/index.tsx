import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { XirangAvatar } from './avatar'
import { XirangDark } from './dark'
import { XirangLight } from './light'

const Xirang = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <XirangLight {...props} className={className} />
  if (variant === 'dark') return <XirangDark {...props} className={className} />
  return (
    <>
      <XirangLight className={cn('dark:hidden', className)} {...props} />
      <XirangDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const XirangIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Xirang, {
  Avatar: XirangAvatar,
  colorPrimary: '#DF0428'
})

export default XirangIcon
