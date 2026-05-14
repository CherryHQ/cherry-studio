import type { SVGProps } from 'react'

import { cn } from '../../../../lib/utils'
import type { CompoundIcon } from '../../types'
import { SmitheryAvatar } from './avatar'
import { SmitheryDark } from './dark'
import { SmitheryLight } from './light'

const Smithery = ({ className, ...props }: SVGProps<SVGSVGElement>) => (
  <>
    <SmitheryLight className={cn('dark:hidden', className)} {...props} />
    <SmitheryDark className={cn('hidden dark:block', className)} {...props} />
  </>
)

export const SmitheryIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Smithery, {
  Light: SmitheryLight,
  Dark: SmitheryDark,
  Avatar: SmitheryAvatar,
  colorPrimary: '#FF5601'
})

export default SmitheryIcon
