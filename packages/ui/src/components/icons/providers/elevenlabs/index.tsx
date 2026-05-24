import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { ElevenlabsAvatar } from './avatar'
import { ElevenlabsLight } from './light'

const Elevenlabs = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <ElevenlabsLight {...props} className={cn('text-foreground', className)} />
  return <ElevenlabsLight {...props} className={cn('text-foreground', className)} />
}

export const ElevenlabsIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Elevenlabs, {
  Avatar: ElevenlabsAvatar,
  colorPrimary: '#000000'
})

export default ElevenlabsIcon
