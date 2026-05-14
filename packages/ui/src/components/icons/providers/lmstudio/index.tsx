import type { SVGProps } from 'react'

import { cn } from '../../../../lib/utils'
import type { CompoundIcon } from '../../types'
import { LmstudioAvatar } from './avatar'
import { LmstudioDark } from './dark'
import { LmstudioLight } from './light'

const Lmstudio = ({ className, ...props }: SVGProps<SVGSVGElement>) => (
  <>
    <LmstudioLight className={cn('dark:hidden', className)} {...props} />
    <LmstudioDark className={cn('hidden dark:block', className)} {...props} />
  </>
)

export const LmstudioIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Lmstudio, {
  Light: LmstudioLight,
  Dark: LmstudioDark,
  Avatar: LmstudioAvatar,
  colorPrimary: '#000000'
})

export default LmstudioIcon
