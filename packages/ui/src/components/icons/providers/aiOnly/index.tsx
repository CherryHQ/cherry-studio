import type { SVGProps } from 'react'

import { cn } from '../../../../lib/utils'
import type { CompoundIcon } from '../../types'
import { AiOnlyAvatar } from './avatar'
import { AiOnlyDark } from './dark'
import { AiOnlyLight } from './light'

const AiOnly = ({ className, ...props }: SVGProps<SVGSVGElement>) => (
  <>
    <AiOnlyLight className={cn('dark:hidden', className)} {...props} />
    <AiOnlyDark className={cn('hidden dark:block', className)} {...props} />
  </>
)

export const AiOnlyIcon: CompoundIcon = /*#__PURE__*/ Object.assign(AiOnly, {
  Light: AiOnlyLight,
  Dark: AiOnlyDark,
  Avatar: AiOnlyAvatar,
  colorPrimary: '#00E5E5'
})

export default AiOnlyIcon
