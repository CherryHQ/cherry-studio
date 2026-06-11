import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { RiverflowAvatar } from './avatar'
import { RiverflowDark } from './dark'
import { RiverflowLight } from './light'

const Riverflow = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <RiverflowLight {...props} className={className} />
  if (variant === 'dark') return <RiverflowDark {...props} className={className} />
  return (
    <>
      <RiverflowLight className={cn(className, 'dark:hidden')} {...props} />
      <RiverflowDark className={cn(className, 'hidden dark:block')} {...props} />
    </>
  )
}

export const RiverflowIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Riverflow, {
  Avatar: RiverflowAvatar,
  colorPrimary: '#1F0909'
})

export default RiverflowIcon
