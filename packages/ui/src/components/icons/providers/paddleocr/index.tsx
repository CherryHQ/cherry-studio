import type { CompoundIcon, CompoundIconProps } from '../../types'
import { PaddleocrAvatar } from './avatar'
import { PaddleocrLight } from './light'

const Paddleocr = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <PaddleocrLight {...props} className={className} />
  return <PaddleocrLight {...props} className={className} />
}

export const PaddleocrIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Paddleocr, {
  Avatar: PaddleocrAvatar,
  colorPrimary: '#363FE5'
})

export default PaddleocrIcon
