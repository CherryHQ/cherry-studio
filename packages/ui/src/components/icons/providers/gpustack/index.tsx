import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { GpustackAvatar } from './avatar'
import { GpustackDark } from './dark'
import { GpustackLight } from './light'

const Gpustack = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <GpustackLight {...props} className={className} />
  if (variant === 'dark') return <GpustackDark {...props} className={className} />
  return (
    <>
      <GpustackLight className={cn('dark:hidden', className)} {...props} />
      <GpustackDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const GpustackIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Gpustack, {
  Avatar: GpustackAvatar,
  colorPrimary: '#000000'
})

export default GpustackIcon
