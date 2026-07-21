import type { CompoundIcon, CompoundIconProps } from '../../types'
import { GptRealtime21Avatar } from './avatar'
import { GptRealtime21Light } from './light'

const GptRealtime21 = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <GptRealtime21Light {...props} className={className} />
  return <GptRealtime21Light {...props} className={className} />
}

export const GptRealtime21Icon: CompoundIcon = /*#__PURE__*/ Object.assign(GptRealtime21, {
  Avatar: GptRealtime21Avatar,
  colorPrimary: '#000000'
})

export default GptRealtime21Icon
