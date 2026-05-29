import type { CompoundIcon, CompoundIconProps } from '../../types'
import { GeminiAvatar } from './avatar'
import { GeminiLight } from './light'

const Gemini = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <GeminiLight {...props} className={className} />
  return <GeminiLight {...props} className={className} />
}

export const GeminiIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Gemini, {
  Avatar: GeminiAvatar,
  colorPrimary: '#F6C013'
})

export default GeminiIcon
