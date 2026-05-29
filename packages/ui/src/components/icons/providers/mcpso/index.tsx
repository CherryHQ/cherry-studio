import type { CompoundIcon, CompoundIconProps } from '../../types'
import { McpsoAvatar } from './avatar'
import { McpsoLight } from './light'

const Mcpso = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <McpsoLight {...props} className={className} />
  return <McpsoLight {...props} className={className} />
}

export const McpsoIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Mcpso, {
  Avatar: McpsoAvatar,
  colorPrimary: '#3D5D83'
})

export default McpsoIcon
