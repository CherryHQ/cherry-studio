import type { SVGProps } from 'react'

import { cn } from '../../../../lib/utils'
import type { CompoundIcon } from '../../types'
import { DolphinAiAvatar } from './avatar'
import { DolphinAiDark } from './dark'
import { DolphinAiLight } from './light'

const DolphinAi = ({ className, ...props }: SVGProps<SVGSVGElement>) => (
  <>
    <DolphinAiLight className={cn('dark:hidden', className)} {...props} />
    <DolphinAiDark className={cn('hidden dark:block', className)} {...props} />
  </>
)

export const DolphinAiIcon: CompoundIcon = /*#__PURE__*/ Object.assign(DolphinAi, {
  Light: DolphinAiLight,
  Dark: DolphinAiDark,
  Avatar: DolphinAiAvatar,
  colorPrimary: '#000'
})

export default DolphinAiIcon
