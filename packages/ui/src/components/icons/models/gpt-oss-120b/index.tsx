import type { CompoundIcon, CompoundIconProps } from '../../types'
import { GptOss120bAvatar } from './avatar'
import { GptOss120bLight } from './light'

const GptOss120b = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <GptOss120bLight {...props} className={className} />
  return <GptOss120bLight {...props} className={className} />
}

export const GptOss120bIcon: CompoundIcon = /*#__PURE__*/ Object.assign(GptOss120b, {
  Avatar: GptOss120bAvatar,
  colorPrimary: '#000000'
})

export default GptOss120bIcon
