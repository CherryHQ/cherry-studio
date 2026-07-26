import type { CompoundIcon, CompoundIconProps } from '../../types'
import { GptRealtime15Avatar } from './avatar'
import { GptRealtime15Light } from './light'

const GptRealtime15 = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <GptRealtime15Light {...props} className={className} />
  return <GptRealtime15Light {...props} className={className} />
}

export const GptRealtime15Icon: CompoundIcon = /*#__PURE__*/ Object.assign(GptRealtime15, {
  Avatar: GptRealtime15Avatar,
  colorPrimary: '#000000'
})

export default GptRealtime15Icon
