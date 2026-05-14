import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { XinghuoAvatar } from './avatar'
import { XinghuoDark } from './dark'
import { XinghuoLight } from './light'

const Xinghuo = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <XinghuoLight {...props} className={className} />
  if (variant === 'dark') return <XinghuoDark {...props} className={className} />
  return (
    <>
      <XinghuoLight className={cn('dark:hidden', className)} {...props} />
      <XinghuoDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const XinghuoIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Xinghuo, {
  Avatar: XinghuoAvatar,
  colorPrimary: '#3DC8F9'
})

export default XinghuoIcon
