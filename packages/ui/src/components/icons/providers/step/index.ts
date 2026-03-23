import { type CompoundIcon } from '../../types'
import { StepAvatar } from './avatar'
import { Step } from './color'
import { StepMono } from './mono'

export const StepIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Step, {
  Color: Step,
  Mono: StepMono,
  Avatar: StepAvatar,
  colorPrimary: '#000000'
})

export default StepIcon
