import type { CompoundIcon, CompoundIconProps } from '../../types'
import { GptImage25SunburstAvatar } from './avatar'
import { GptImage25SunburstLight } from './light'

const GptImage25Sunburst = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <GptImage25SunburstLight {...props} className={className} />

  return <GptImage25SunburstLight {...props} className={className} />
}

export const GptImage25SunburstIcon: CompoundIcon = /*#__PURE__*/ Object.assign(GptImage25Sunburst, {
  Avatar: GptImage25SunburstAvatar,
  colorPrimary: '#5D77FB'
})

export default GptImage25SunburstIcon
