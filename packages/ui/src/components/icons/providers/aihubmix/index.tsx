import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { AihubmixAvatar } from './avatar'
import { AihubmixDark } from './dark'
import { AihubmixLight } from './light'

const Aihubmix = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <AihubmixLight {...props} className={className} />
  if (variant === 'dark') return <AihubmixDark {...props} className={className} />
  return (
    <>
      <AihubmixLight className={cn('dark:hidden', className)} {...props} />
      <AihubmixDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const AihubmixIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Aihubmix, {
  Avatar: AihubmixAvatar,
  colorPrimary: '#006FFB'
})

export default AihubmixIcon
