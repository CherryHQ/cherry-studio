import type { SVGProps } from 'react'

import { cn } from '../../../../lib/utils'
import type { CompoundIcon } from '../../types'
import { McpsoAvatar } from './avatar'
import { McpsoDark } from './dark'
import { McpsoLight } from './light'

const Mcpso = ({ className, ...props }: SVGProps<SVGSVGElement>) => (
  <>
    <McpsoLight className={cn('dark:hidden', className)} {...props} />
    <McpsoDark className={cn('hidden dark:block', className)} {...props} />
  </>
)

export const McpsoIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Mcpso, {
  Light: McpsoLight,
  Dark: McpsoDark,
  Avatar: McpsoAvatar,
  colorPrimary: '#3D5D83'
})

export default McpsoIcon
