import type { SVGProps } from 'react'

import { cn } from '../../../../lib/utils'
import type { CompoundIcon } from '../../types'
import { GraphRagAvatar } from './avatar'
import { GraphRagDark } from './dark'
import { GraphRagLight } from './light'

const GraphRag = ({ className, ...props }: SVGProps<SVGSVGElement>) => (
  <>
    <GraphRagLight className={cn('dark:hidden', className)} {...props} />
    <GraphRagDark className={cn('hidden dark:block', className)} {...props} />
  </>
)

export const GraphRagIcon: CompoundIcon = /*#__PURE__*/ Object.assign(GraphRag, {
  Light: GraphRagLight,
  Dark: GraphRagDark,
  Avatar: GraphRagAvatar,
  colorPrimary: '#F8E71C'
})

export default GraphRagIcon
