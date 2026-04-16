import { type CompoundIcon } from '../../types'
import { DeepcogitoAvatar } from './avatar'
import { Deepcogito } from './color'
import { DeepcogitoMono } from './mono'

export const DeepcogitoIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Deepcogito, {
  Color: Deepcogito,
  Mono: DeepcogitoMono,
  Avatar: DeepcogitoAvatar,
  colorPrimary: '#4E81EE'
})

export default DeepcogitoIcon
