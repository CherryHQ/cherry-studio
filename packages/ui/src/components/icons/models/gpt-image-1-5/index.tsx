import type { CompoundIcon, CompoundIconProps } from '../../types'
import { GptImage15Avatar } from './avatar'
import { GptImage15Light } from './light'

const GptImage15 = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <GptImage15Light {...props} className={className} />
  return <GptImage15Light {...props} className={className} />
}

export const GptImage15Icon: CompoundIcon = /*#__PURE__*/ Object.assign(GptImage15, {
  Avatar: GptImage15Avatar,
  colorPrimary: '#000000'
})

export default GptImage15Icon
