import type { CompoundIcon, CompoundIconProps } from '../../types'
import { McpAvatar } from './avatar'
import { McpLight } from './light'

const Mcp = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <McpLight {...props} className={className} />
  return <McpLight {...props} className={className} />
}

export const McpIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Mcp, {
  Avatar: McpAvatar,
  colorPrimary: '#020202'
})

export default McpIcon
