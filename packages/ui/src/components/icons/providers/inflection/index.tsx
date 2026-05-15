import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { InflectionAvatar } from './avatar'
import { InflectionLight } from './light'

const Inflection = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <InflectionLight {...props} className={cn('text-foreground', className)} />
  return <InflectionLight {...props} className={cn('text-foreground', className)} />
}

export const InflectionIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Inflection, {
  Avatar: InflectionAvatar,
  colorPrimary: '#000000'
})

export default InflectionIcon
