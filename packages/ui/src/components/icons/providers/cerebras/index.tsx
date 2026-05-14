import type { CompoundIcon, CompoundIconProps } from '../../types'
import { CerebrasAvatar } from './avatar'
import { CerebrasLight } from './light'

const Cerebras = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <CerebrasLight {...props} className={className} />
  return <CerebrasLight {...props} className={className} />
}

export const CerebrasIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Cerebras, {
  Avatar: CerebrasAvatar,
  colorPrimary: '#F05A28'
})

export default CerebrasIcon
