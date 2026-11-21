import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { HopbaseAvatar } from './avatar'
import { HopbaseDark } from './dark'
import { HopbaseLight } from './light'

const Hopbase = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <HopbaseLight {...props} className={className} />
  if (variant === 'dark') return <HopbaseDark {...props} className={className} />
  return (
    <>
      <HopbaseLight className={cn('dark:hidden', className)} {...props} />
      <HopbaseDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const HopbaseIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Hopbase, {
  Avatar: HopbaseAvatar,
  colorPrimary: '#000'
})

export default HopbaseIcon
