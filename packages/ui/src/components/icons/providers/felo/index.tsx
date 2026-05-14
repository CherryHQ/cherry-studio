import type { CompoundIcon, CompoundIconProps } from '../../types'
import { FeloAvatar } from './avatar'
import { FeloLight } from './light'

const Felo = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <FeloLight {...props} className={className} />
  return <FeloLight {...props} className={className} />
}

export const FeloIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Felo, {
  Avatar: FeloAvatar,
  colorPrimary: '#000000'
})

export default FeloIcon
