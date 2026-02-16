import type { CompoundIcon } from '../../types'
import { Zhipu } from './color'
import { ZhipuMono } from './mono'

export const ZhipuIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Zhipu, {
  Color: Zhipu,
  Mono: ZhipuMono,
  colorPrimary: '#3859FF'
})
export default ZhipuIcon
