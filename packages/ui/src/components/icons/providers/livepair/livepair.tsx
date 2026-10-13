import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { LivepairAvatar } from './avatar'
import { LivepairDark } from './dark'
import { LivepairLight } from './light'

const Livepair = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <LivepairLight {...props} className={className} />
  if (variant === 'dark') return <LivepairDark {...props} className={className} />
  return (
    <>
      <LivepairLight className={cn('dark:hidden', className)} {...props} />
      <LivepairDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const LivepairIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Livepair, {
  Avatar: LivepairAvatar,
  colorPrimary: '#2563EB'
})

export default LivepairIcon
