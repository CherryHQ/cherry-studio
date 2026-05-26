import type { CompoundIcon, CompoundIconProps } from '../../types'
import { TesseractJsAvatar } from './avatar'
import { TesseractJsLight } from './light'

const TesseractJs = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <TesseractJsLight {...props} className={className} />
  return <TesseractJsLight {...props} className={className} />
}

export const TesseractJsIcon: CompoundIcon = /*#__PURE__*/ Object.assign(TesseractJs, {
  Avatar: TesseractJsAvatar,
  colorPrimary: '#FDFDFE'
})

export default TesseractJsIcon
