import type { CompoundIcon, CompoundIconProps } from '../../types'
import { LeptonAvatar } from './avatar'
import { LeptonLight } from './light'

const Lepton = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <LeptonLight {...props} className={className} />
  return <LeptonLight {...props} className={className} />
}

export const LeptonIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Lepton, {
  Avatar: LeptonAvatar,
  colorPrimary: '#2D9CDB'
})

export default LeptonIcon
