import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { OpenaiAvatar } from './avatar'
import { OpenaiLight } from './light'

const Openai = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <OpenaiLight {...props} className={cn('text-foreground', className)} />
  return <OpenaiLight {...props} className={cn('text-foreground', className)} />
}

export const OpenaiIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Openai, {
  Avatar: OpenaiAvatar,
  colorPrimary: '#000000'
})

export default OpenaiIcon
