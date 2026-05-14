import type { SVGProps } from 'react'

import { cn } from '../../../../lib/utils'
import type { CompoundIcon } from '../../types'
import { ComposioAvatar } from './avatar'
import { ComposioDark } from './dark'
import { ComposioLight } from './light'

const Composio = ({ className, ...props }: SVGProps<SVGSVGElement>) => (
  <>
    <ComposioLight className={cn('dark:hidden', className)} {...props} />
    <ComposioDark className={cn('hidden dark:block', className)} {...props} />
  </>
)

export const ComposioIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Composio, {
  Light: ComposioLight,
  Dark: ComposioDark,
  Avatar: ComposioAvatar,
  colorPrimary: '#000000'
})

export default ComposioIcon
