import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { ZeroOneAvatar } from './avatar'
import { ZeroOneDark } from './dark'
import { ZeroOneLight } from './light'

const ZeroOne = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <ZeroOneLight {...props} className={className} />
  if (variant === 'dark') return <ZeroOneDark {...props} className={className} />
  return (
    <>
      <ZeroOneLight className={cn('dark:hidden', className)} {...props} />
      <ZeroOneDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const ZeroOneIcon: CompoundIcon = /*#__PURE__*/ Object.assign(ZeroOne, {
  Avatar: ZeroOneAvatar,
  colorPrimary: '#133426'
})

export default ZeroOneIcon
