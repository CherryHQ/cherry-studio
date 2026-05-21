import type { CompoundIcon, CompoundIconProps } from '../../types'
import { IbmAvatar } from './avatar'
import { IbmLight } from './light'

const Ibm = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <IbmLight {...props} className={className} />
  return <IbmLight {...props} className={className} />
}

export const IbmIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Ibm, {
  Avatar: IbmAvatar,
  colorPrimary: '#DFE9F3'
})

export default IbmIcon
