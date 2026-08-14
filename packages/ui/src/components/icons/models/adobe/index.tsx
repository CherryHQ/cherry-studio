import type { CompoundIcon, CompoundIconProps } from '../../types'
import { AdobeAvatar } from './avatar'
import { AdobeLight } from './light'

const Adobe = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <AdobeLight {...props} className={className} />
  return <AdobeLight {...props} className={className} />
}

export const AdobeIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Adobe, {
  Avatar: AdobeAvatar,
  colorPrimary: '#EB1000'
})

export default AdobeIcon
