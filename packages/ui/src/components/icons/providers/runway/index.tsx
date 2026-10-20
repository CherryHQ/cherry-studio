import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { RunwayAvatar } from './avatar'
import { RunwayDark } from './dark'
import { RunwayLight } from './light'

const Runway = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <RunwayLight {...props} className={className} />
  if (variant === 'dark') return <RunwayDark {...props} className={className} />
  return (
    <>
      <RunwayLight className={cn('dark:hidden', className)} {...props} />
      <RunwayDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const RunwayIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Runway, {
  Avatar: RunwayAvatar,
  colorPrimary: '#000000'
})

export default RunwayIcon
