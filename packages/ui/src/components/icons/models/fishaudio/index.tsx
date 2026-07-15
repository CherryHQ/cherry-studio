import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { FishaudioAvatar } from './avatar'
import { FishaudioLight } from './light'

const Fishaudio = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <FishaudioLight {...props} className={cn('text-foreground', className)} />
  return <FishaudioLight {...props} className={cn('text-foreground', className)} />
}

export const FishaudioIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Fishaudio, {
  Avatar: FishaudioAvatar,
  colorPrimary: '#000000'
})

export default FishaudioIcon
