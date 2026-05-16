import type { CompoundIcon, CompoundIconProps } from '../../types'
import { BingAvatar } from './avatar'
import { BingLight } from './light'

const Bing = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <BingLight {...props} className={className} />
  return <BingLight {...props} className={className} />
}

export const BingIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Bing, {
  Avatar: BingAvatar,
  colorPrimary: '#000000'
})

export default BingIcon
