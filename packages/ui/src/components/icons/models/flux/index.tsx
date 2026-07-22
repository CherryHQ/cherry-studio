import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { FluxAvatar } from './avatar'
import { FluxDark } from './dark'
import { FluxLight } from './light'

const Flux = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <FluxLight {...props} className={className} />
  if (variant === 'dark') return <FluxDark {...props} className={className} />
  return (
    <>
      <FluxLight className={cn('dark:hidden', className)} {...props} />
      <FluxDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const FluxIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Flux, {
  Avatar: FluxAvatar,
  colorPrimary: '#000000'
})

export default FluxIcon
