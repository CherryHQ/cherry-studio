import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { McpsoAvatar } from './avatar'
import { McpsoDark } from './dark'
import { McpsoLight } from './light'

const Mcpso = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <McpsoLight {...props} className={className} />
  if (variant === 'dark') return <McpsoDark {...props} className={className} />
  return (
    <>
      <McpsoLight className={cn('dark:hidden', className)} {...props} />
      <McpsoDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const McpsoIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Mcpso, {
  Avatar: McpsoAvatar,
  colorPrimary: '#3D5D83'
})

export default McpsoIcon
