import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { DolphinAvatar } from './avatar'
import { DolphinDark } from './dark'
import { DolphinLight } from './light'

const Dolphin = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <DolphinLight {...props} className={className} />
  if (variant === 'dark') return <DolphinDark {...props} className={className} />
  return (
    <>
      <DolphinLight className={cn('dark:hidden', className)} {...props} />
      <DolphinDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const DolphinIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Dolphin, {
  Avatar: DolphinAvatar,
  colorPrimary: '#000000'
})

export default DolphinIcon
