import type { CompoundIcon, CompoundIconProps } from '../../types'
import { MinimaxAgentAvatar } from './avatar'
import { MinimaxAgentLight } from './light'

const MinimaxAgent = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <MinimaxAgentLight {...props} className={className} />
  return <MinimaxAgentLight {...props} className={className} />
}

export const MinimaxAgentIcon: CompoundIcon = /*#__PURE__*/ Object.assign(MinimaxAgent, {
  Avatar: MinimaxAgentAvatar,
  colorPrimary: '#7EC7FF'
})

export default MinimaxAgentIcon
