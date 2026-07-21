import type { CompoundIcon, CompoundIconProps } from '../../types'
import { GptAudio15Avatar } from './avatar'
import { GptAudio15Light } from './light'

const GptAudio15 = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <GptAudio15Light {...props} className={className} />
  return <GptAudio15Light {...props} className={className} />
}

export const GptAudio15Icon: CompoundIcon = /*#__PURE__*/ Object.assign(GptAudio15, {
  Avatar: GptAudio15Avatar,
  colorPrimary: '#000000'
})

export default GptAudio15Icon
