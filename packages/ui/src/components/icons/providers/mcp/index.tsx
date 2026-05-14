import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { McpAvatar } from './avatar'
import { McpDark } from './dark'
import { McpLight } from './light'

const Mcp = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <McpLight {...props} className={className} />
  if (variant === 'dark') return <McpDark {...props} className={className} />
  return (
    <>
      <McpLight className={cn('dark:hidden', className)} {...props} />
      <McpDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const McpIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Mcp, {
  Avatar: McpAvatar,
  colorPrimary: '#020202'
})

export default McpIcon
