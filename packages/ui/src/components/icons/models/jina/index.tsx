import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { JinaAvatar } from './avatar'
import { JinaLight } from './light'

const Jina = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <JinaLight {...props} className={cn('text-foreground', className)} />
  return <JinaLight {...props} className={cn('text-foreground', className)} />
}

export const JinaIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Jina, {
  Avatar: JinaAvatar,
  colorPrimary: '#000000'
})

export default JinaIcon
