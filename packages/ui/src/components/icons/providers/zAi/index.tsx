import type { SVGProps } from 'react'

import { cn } from '../../../../lib/utils'
import type { CompoundIcon } from '../../types'
import { ZAiAvatar } from './avatar'
import { ZAiDark } from './dark'
import { ZAiLight } from './light'

const ZAi = ({ className, ...props }: SVGProps<SVGSVGElement>) => (
  <>
    <ZAiLight className={cn('dark:hidden', className)} {...props} />
    <ZAiDark className={cn('hidden dark:block', className)} {...props} />
  </>
)

export const ZAiIcon: CompoundIcon = /*#__PURE__*/ Object.assign(ZAi, {
  Light: ZAiLight,
  Dark: ZAiDark,
  Avatar: ZAiAvatar,
  colorPrimary: '#000000'
})

export default ZAiIcon
