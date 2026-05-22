import type { CompoundIcon, CompoundIconProps } from '../../types'
import { GraphRagAvatar } from './avatar'
import { GraphRagLight } from './light'

const GraphRag = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <GraphRagLight {...props} className={className} />
  return <GraphRagLight {...props} className={className} />
}

export const GraphRagIcon: CompoundIcon = /*#__PURE__*/ Object.assign(GraphRag, {
  Avatar: GraphRagAvatar,
  colorPrimary: '#F8E71C'
})

export default GraphRagIcon
