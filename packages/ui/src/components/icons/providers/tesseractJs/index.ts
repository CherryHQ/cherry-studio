import type { CompoundIcon } from '../../types'
import { TesseractJs } from './color'
import { TesseractJsMono } from './mono'

export const TesseractJsIcon: CompoundIcon = /*#__PURE__*/ Object.assign(TesseractJs, {
  Color: TesseractJs,
  Mono: TesseractJsMono,
  colorPrimary: '#1866C0'
})
export default TesseractJsIcon
