import type { SVGProps } from 'react'

import { cn } from '../../../../lib/utils'
import type { CompoundIcon } from '../../types'
import { AiStudioAvatar } from './avatar'
import { AiStudioDark } from './dark'
import { AiStudioLight } from './light'

const AiStudio = ({ className, ...props }: SVGProps<SVGSVGElement>) => (
  <>
    <AiStudioLight className={cn('dark:hidden', className)} {...props} />
    <AiStudioDark className={cn('hidden dark:block', className)} {...props} />
  </>
)

export const AiStudioIcon: CompoundIcon = /*#__PURE__*/ Object.assign(AiStudio, {
  Light: AiStudioLight,
  Dark: AiStudioDark,
  Avatar: AiStudioAvatar,
  colorPrimary: '#1A1A1A'
})

export default AiStudioIcon
