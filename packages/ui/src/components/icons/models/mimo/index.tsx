import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { MimoAvatar } from './avatar'
import { MimoDark } from './dark'
import { MimoLight } from './light'

const Mimo = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <MimoLight {...props} className={className} />
  if (variant === 'dark') return <MimoDark {...props} className={className} />
  return (
    <>
      <MimoLight className={cn('dark:hidden', className)} {...props} />
      <MimoDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const MimoIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Mimo, {
  Avatar: MimoAvatar,
  colorPrimary: '#000000'
})

export default MimoIcon
