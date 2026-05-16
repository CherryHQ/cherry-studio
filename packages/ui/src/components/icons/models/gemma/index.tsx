import type { CompoundIcon, CompoundIconProps } from '../../types'
import { GemmaAvatar } from './avatar'
import { GemmaLight } from './light'

const Gemma = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <GemmaLight {...props} className={className} />
  return <GemmaLight {...props} className={className} />
}

export const GemmaIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Gemma, {
  Avatar: GemmaAvatar,
  colorPrimary: '#53A3FF'
})

export default GemmaIcon
