import type { CompoundIcon, CompoundIconProps } from '../../types'
import { MiaodaAvatar } from './avatar'
import { MiaodaLight } from './light'

const Miaoda = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <MiaodaLight {...props} className={className} />
  return <MiaodaLight {...props} className={className} />
}

export const MiaodaIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Miaoda, {
  Avatar: MiaodaAvatar,
  colorPrimary: '#000000'
})

export default MiaodaIcon
