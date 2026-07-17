import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { HappyhorseAvatar } from './avatar'
import { HappyhorseLight } from './light'

const Happyhorse = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <HappyhorseLight {...props} className={cn('text-foreground', className)} />
  return <HappyhorseLight {...props} className={cn('text-foreground', className)} />
}

export const HappyhorseIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Happyhorse, {
  Avatar: HappyhorseAvatar,
  colorPrimary: '#000000'
})

export default HappyhorseIcon
