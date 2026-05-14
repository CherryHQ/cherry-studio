import type { SVGProps } from 'react'

import { cn } from '../../../../lib/utils'
import type { CompoundIcon } from '../../types'
import { EssentialAiAvatar } from './avatar'
import { EssentialAiDark } from './dark'
import { EssentialAiLight } from './light'

const EssentialAi = ({ className, ...props }: SVGProps<SVGSVGElement>) => (
  <>
    <EssentialAiLight className={cn('dark:hidden', className)} {...props} />
    <EssentialAiDark className={cn('hidden dark:block', className)} {...props} />
  </>
)

export const EssentialAiIcon: CompoundIcon = /*#__PURE__*/ Object.assign(EssentialAi, {
  Light: EssentialAiLight,
  Dark: EssentialAiDark,
  Avatar: EssentialAiAvatar,
  colorPrimary: '#35058E'
})

export default EssentialAiIcon
