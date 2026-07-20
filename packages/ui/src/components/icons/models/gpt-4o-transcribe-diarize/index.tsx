import type { CompoundIcon, CompoundIconProps } from '../../types'
import { Gpt4oTranscribeDiarizeAvatar } from './avatar'
import { Gpt4oTranscribeDiarizeLight } from './light'

const Gpt4oTranscribeDiarize = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <Gpt4oTranscribeDiarizeLight {...props} className={className} />
  return <Gpt4oTranscribeDiarizeLight {...props} className={className} />
}

export const Gpt4oTranscribeDiarizeIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Gpt4oTranscribeDiarize, {
  Avatar: Gpt4oTranscribeDiarizeAvatar,
  colorPrimary: '#000000'
})

export default Gpt4oTranscribeDiarizeIcon
