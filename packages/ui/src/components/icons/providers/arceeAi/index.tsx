import type { SVGProps } from 'react'

import { cn } from '../../../../lib/utils'
import type { CompoundIcon } from '../../types'
import { ArceeAiAvatar } from './avatar'
import { ArceeAiDark } from './dark'
import { ArceeAiLight } from './light'

const ArceeAi = ({ className, ...props }: SVGProps<SVGSVGElement>) => (
  <>
    <ArceeAiLight className={cn('dark:hidden', className)} {...props} />
    <ArceeAiDark className={cn('hidden dark:block', className)} {...props} />
  </>
)

export const ArceeAiIcon: CompoundIcon = /*#__PURE__*/ Object.assign(ArceeAi, {
  Light: ArceeAiLight,
  Dark: ArceeAiDark,
  Avatar: ArceeAiAvatar,
  colorPrimary: '#008C8C'
})

export default ArceeAiIcon
