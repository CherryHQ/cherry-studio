import type { CompoundIcon, CompoundIconProps } from '../../types'
import { GptImage26FlareAvatar } from './avatar'
import { GptImage26FlareLight } from './light'

const GptImage26Flare = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <GptImage26FlareLight {...props} className={className} />
  return <GptImage26FlareLight {...props} className={className} />
}

export const GptImage26FlareIcon: CompoundIcon = /*#__PURE__*/ Object.assign(GptImage26Flare, {
  Avatar: GptImage26FlareAvatar,
  colorPrimary: '#3768BB'
})

export default GptImage26FlareIcon
