import type { CompoundIcon, CompoundIconProps } from '../../types'
import { GptLive1Avatar } from './avatar'
import { GptLive1Light } from './light'

const GptLive1 = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <GptLive1Light {...props} className={className} />

  return <GptLive1Light {...props} className={className} />
}

export const GptLive1Icon: CompoundIcon = /*#__PURE__*/ Object.assign(GptLive1, {
  Avatar: GptLive1Avatar,
  colorPrimary: '#97AFA3'
})

export default GptLive1Icon
