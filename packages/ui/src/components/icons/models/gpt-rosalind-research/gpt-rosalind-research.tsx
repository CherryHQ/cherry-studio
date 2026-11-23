import type { CompoundIcon, CompoundIconProps } from '../../types'
import { GptRosalindResearchAvatar } from './avatar'
import { GptRosalindResearchLight } from './light'

const GptRosalindResearch = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <GptRosalindResearchLight {...props} className={className} />

  return <GptRosalindResearchLight {...props} className={className} />
}

export const GptRosalindResearchIcon: CompoundIcon = /*#__PURE__*/ Object.assign(GptRosalindResearch, {
  Avatar: GptRosalindResearchAvatar,
  colorPrimary: '#010101'
})

export default GptRosalindResearchIcon
