import type { SVGProps } from 'react'

import { cn } from '../../../../lib/utils'
import type { CompoundIcon } from '../../types'
import { VertexaiAvatar } from './avatar'
import { VertexaiDark } from './dark'
import { VertexaiLight } from './light'

const Vertexai = ({ className, ...props }: SVGProps<SVGSVGElement>) => (
  <>
    <VertexaiLight className={cn('dark:hidden', className)} {...props} />
    <VertexaiDark className={cn('hidden dark:block', className)} {...props} />
  </>
)

export const VertexaiIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Vertexai, {
  Light: VertexaiLight,
  Dark: VertexaiDark,
  Avatar: VertexaiAvatar,
  colorPrimary: '#4285F4'
})

export default VertexaiIcon
