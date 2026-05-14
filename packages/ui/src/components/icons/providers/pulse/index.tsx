import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { PulseAvatar } from './avatar'
import { PulseDark } from './dark'
import { PulseLight } from './light'

const Pulse = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <PulseLight {...props} className={className} />
  if (variant === 'dark') return <PulseDark {...props} className={className} />
  return (
    <>
      <PulseLight className={cn('dark:hidden', className)} {...props} />
      <PulseDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const PulseIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Pulse, {
  Avatar: PulseAvatar,
  colorPrimary: '#302F7D'
})

export default PulseIcon
