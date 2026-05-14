import type { SVGProps } from 'react'

import { cn } from '../../../../lib/utils'
import type { CompoundIcon } from '../../types'
import { McpAvatar } from './avatar'
import { McpDark } from './dark'
import { McpLight } from './light'

const Mcp = ({ className, ...props }: SVGProps<SVGSVGElement>) => (
  <>
    <McpLight className={cn('dark:hidden', className)} {...props} />
    <McpDark className={cn('hidden dark:block', className)} {...props} />
  </>
)

export const McpIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Mcp, {
  Light: McpLight,
  Dark: McpDark,
  Avatar: McpAvatar,
  colorPrimary: '#020202'
})

export default McpIcon
