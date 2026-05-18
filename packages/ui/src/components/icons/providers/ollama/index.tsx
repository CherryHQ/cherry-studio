import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { OllamaAvatar } from './avatar'
import { OllamaLight } from './light'

const Ollama = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <OllamaLight {...props} className={cn('text-foreground', className)} />
  return <OllamaLight {...props} className={cn('text-foreground', className)} />
}

export const OllamaIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Ollama, {
  Avatar: OllamaAvatar,
  colorPrimary: '#000000'
})

export default OllamaIcon
