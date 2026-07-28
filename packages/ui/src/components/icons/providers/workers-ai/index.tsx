import type { CompoundIcon, CompoundIconProps } from '../../types'
import { WorkersAiAvatar } from './avatar'
import { WorkersAiLight } from './light'

const WorkersAi = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <WorkersAiLight {...props} className={className} />
  return <WorkersAiLight {...props} className={className} />
}

export const WorkersAiIcon: CompoundIcon = /*#__PURE__*/ Object.assign(WorkersAi, {
  Avatar: WorkersAiAvatar,
  colorPrimary: '#F38020'
})

export default WorkersAiIcon
