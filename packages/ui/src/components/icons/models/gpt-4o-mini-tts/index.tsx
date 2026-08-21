import type { CompoundIcon, CompoundIconProps } from '../../types'
import { Gpt4oMiniTtsAvatar } from './avatar'
import { Gpt4oMiniTtsLight } from './light'

const Gpt4oMiniTts = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <Gpt4oMiniTtsLight {...props} className={className} />
  return <Gpt4oMiniTtsLight {...props} className={className} />
}

export const Gpt4oMiniTtsIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Gpt4oMiniTts, {
  Avatar: Gpt4oMiniTtsAvatar,
  colorPrimary: '#000000'
})

export default Gpt4oMiniTtsIcon
