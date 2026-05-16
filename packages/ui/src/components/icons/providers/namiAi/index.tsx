import type { CompoundIcon, CompoundIconProps } from '../../types'
import { NamiAiAvatar } from './avatar'
import { NamiAiLight } from './light'

const NamiAi = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <NamiAiLight {...props} className={className} />
  return <NamiAiLight {...props} className={className} />
}

export const NamiAiIcon: CompoundIcon = /*#__PURE__*/ Object.assign(NamiAi, {
  Avatar: NamiAiAvatar,
  colorPrimary: '#000000'
})

export default NamiAiIcon
