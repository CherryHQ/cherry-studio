import type { CompoundIcon, CompoundIconProps } from '../../types'
import { GptImage26SunburstAvatar } from './avatar'
import { GptImage26SunburstLight } from './light'

const GptImage26Sunburst = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <GptImage26SunburstLight {...props} className={className} />

  return <GptImage26SunburstLight {...props} className={className} />
}

export const GptImage26SunburstIcon: CompoundIcon = /*#__PURE__*/ Object.assign(GptImage26Sunburst, {
  Avatar: GptImage26SunburstAvatar,
  colorPrimary: '#F3C495'
})

export default GptImage26SunburstIcon
