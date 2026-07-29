import type { CompoundIcon, CompoundIconProps } from '../../types'
import { GptImage1MiniAvatar } from './avatar'
import { GptImage1MiniLight } from './light'

const GptImage1Mini = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <GptImage1MiniLight {...props} className={className} />
  return <GptImage1MiniLight {...props} className={className} />
}

export const GptImage1MiniIcon: CompoundIcon = /*#__PURE__*/ Object.assign(GptImage1Mini, {
  Avatar: GptImage1MiniAvatar,
  colorPrimary: '#000000'
})

export default GptImage1MiniIcon
