import type { CompoundIcon, CompoundIconProps } from '../../types'
import { GptImage25FlareAvatar } from './avatar'
import { GptImage25FlareLight } from './light'

const GptImage25Flare = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <GptImage25FlareLight {...props} className={className} />
  return <GptImage25FlareLight {...props} className={className} />
}

export const GptImage25FlareIcon: CompoundIcon = /*#__PURE__*/ Object.assign(GptImage25Flare, {
  Avatar: GptImage25FlareAvatar,
  colorPrimary: '#7389FC'
})

export default GptImage25FlareIcon
