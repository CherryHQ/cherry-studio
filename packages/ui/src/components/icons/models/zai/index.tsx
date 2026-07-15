import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { ZaiAvatar } from './avatar'
import { ZaiLight } from './light'

const Zai = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <ZaiLight {...props} className={cn('text-foreground', className)} />
  return <ZaiLight {...props} className={cn('text-foreground', className)} />
}

export const ZaiIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Zai, {
  Avatar: ZaiAvatar,
  colorPrimary: '#000000'
})

export default ZaiIcon
