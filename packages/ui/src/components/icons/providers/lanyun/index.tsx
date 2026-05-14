import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { LanyunAvatar } from './avatar'
import { LanyunDark } from './dark'
import { LanyunLight } from './light'

const Lanyun = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <LanyunLight {...props} className={className} />
  if (variant === 'dark') return <LanyunDark {...props} className={className} />
  return (
    <>
      <LanyunLight className={cn('dark:hidden', className)} {...props} />
      <LanyunDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const LanyunIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Lanyun, {
  Avatar: LanyunAvatar,
  colorPrimary: '#000000'
})

export default LanyunIcon
