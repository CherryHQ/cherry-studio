import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { FortytwoAvatar } from './avatar'
import { FortytwoDark } from './dark'
import { FortytwoLight } from './light'

const Fortytwo = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <FortytwoLight {...props} className={className} />
  if (variant === 'dark') return <FortytwoDark {...props} className={className} />
  return (
    <>
      <FortytwoLight className={cn('dark:hidden', className)} {...props} />
      <FortytwoDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const FortytwoIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Fortytwo, {
  Avatar: FortytwoAvatar,
  colorPrimary: '#000000'
})

export default FortytwoIcon
