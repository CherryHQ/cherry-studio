import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { ZAiAvatar } from './avatar'
import { ZAiLight } from './light'

const ZAi = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <ZAiLight {...props} className={cn('text-foreground', className)} />
  return <ZAiLight {...props} className={cn('text-foreground', className)} />
}

export const ZAiIcon: CompoundIcon = /*#__PURE__*/ Object.assign(ZAi, {
  Avatar: ZAiAvatar,
  colorPrimary: '#000000'
})

export default ZAiIcon
