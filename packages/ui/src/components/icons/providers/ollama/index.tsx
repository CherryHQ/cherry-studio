import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { OllamaAvatar } from './avatar'
import { OllamaDark } from './dark'
import { OllamaLight } from './light'

const Ollama = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <OllamaLight {...props} className={className} />
  if (variant === 'dark') return <OllamaDark {...props} className={className} />
  return (
    <>
      <OllamaLight className={cn('dark:hidden', className)} {...props} />
      <OllamaDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const OllamaIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Ollama, {
  Avatar: OllamaAvatar,
  colorPrimary: '#000000'
})

export default OllamaIcon
