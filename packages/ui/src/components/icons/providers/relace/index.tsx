import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { RelaceAvatar } from './avatar'
import { RelaceLight } from './light'

const Relace = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <RelaceLight {...props} className={cn('text-foreground', className)} />
  return <RelaceLight {...props} className={cn('text-foreground', className)} />
}

export const RelaceIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Relace, {
  Avatar: RelaceAvatar,
  colorPrimary: '#000000'
})

export default RelaceIcon
