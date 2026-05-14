import type { CompoundIcon, CompoundIconProps } from '../../types'
import { VertexaiAvatar } from './avatar'
import { VertexaiLight } from './light'

const Vertexai = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <VertexaiLight {...props} className={className} />
  return <VertexaiLight {...props} className={className} />
}

export const VertexaiIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Vertexai, {
  Avatar: VertexaiAvatar,
  colorPrimary: '#4285F4'
})

export default VertexaiIcon
