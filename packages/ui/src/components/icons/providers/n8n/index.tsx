import type { SVGProps } from 'react'

import { cn } from '../../../../lib/utils'
import type { CompoundIcon } from '../../types'
import { N8nAvatar } from './avatar'
import { N8nDark } from './dark'
import { N8nLight } from './light'

const N8n = ({ className, ...props }: SVGProps<SVGSVGElement>) => (
  <>
    <N8nLight className={cn('dark:hidden', className)} {...props} />
    <N8nDark className={cn('hidden dark:block', className)} {...props} />
  </>
)

export const N8nIcon: CompoundIcon = /*#__PURE__*/ Object.assign(N8n, {
  Light: N8nLight,
  Dark: N8nDark,
  Avatar: N8nAvatar,
  colorPrimary: '#EA4B71'
})

export default N8nIcon
