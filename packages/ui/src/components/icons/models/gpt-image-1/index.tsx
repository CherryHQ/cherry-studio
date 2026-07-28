import type { CompoundIcon, CompoundIconProps } from '../../types'
import { GptImage1Avatar } from './avatar'
import { GptImage1Light } from './light'

const GptImage1 = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <GptImage1Light {...props} className={className} />
  return <GptImage1Light {...props} className={className} />
}

export const GptImage1Icon: CompoundIcon = /*#__PURE__*/ Object.assign(GptImage1, {
  Avatar: GptImage1Avatar,
  colorPrimary: '#000000'
})

export default GptImage1Icon
