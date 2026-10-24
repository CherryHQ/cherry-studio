import type { CompoundIcon, CompoundIconProps } from '../../types'
import { PowertokensAvatar } from './avatar'
import { PowertokensLight } from './light'

const Powertokens = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <PowertokensLight {...props} className={className} />
  return <PowertokensLight {...props} className={className} />
}

export const PowertokensIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Powertokens, {
  Avatar: PowertokensAvatar,
  colorPrimary: '#000000'
})

export default PowertokensIcon
