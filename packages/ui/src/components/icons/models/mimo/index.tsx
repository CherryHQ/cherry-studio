import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { MimoAvatar } from './avatar'
import { MimoDark } from './dark'
import { MimoLight } from './light'

const Mimo = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <MimoLight {...props} className={cn('text-foreground', className)} />
  if (variant === 'dark') return <MimoDark {...props} className={cn('text-foreground', className)} />
  return (
    <>
      <MimoLight className={cn('text-foreground', className, 'dark:hidden')} {...props} />
      <MimoDark className={cn('text-foreground', className, 'hidden dark:block')} {...props} />
    </>
  )
}

export const MimoIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Mimo, {
  Avatar: MimoAvatar,
  colorPrimary: '#000000'
})

export default MimoIcon
