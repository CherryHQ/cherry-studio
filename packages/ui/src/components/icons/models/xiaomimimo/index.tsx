import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { XiaomimimoAvatar } from './avatar'
import { XiaomimimoDark } from './dark'
import { XiaomimimoLight } from './light'

const Xiaomimimo = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <XiaomimimoLight {...props} className={className} />
  if (variant === 'dark') return <XiaomimimoDark {...props} className={className} />
  return (
    <>
      <XiaomimimoLight className={cn('dark:hidden', className)} {...props} />
      <XiaomimimoDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const XiaomimimoIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Xiaomimimo, {
  Avatar: XiaomimimoAvatar,
  colorPrimary: '#000000'
})

export default XiaomimimoIcon
