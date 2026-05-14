import type { SVGProps } from 'react'

import { cn } from '../../../../lib/utils'
import type { CompoundIcon } from '../../types'
import { WorkersAiAvatar } from './avatar'
import { WorkersAiDark } from './dark'
import { WorkersAiLight } from './light'

const WorkersAi = ({ className, ...props }: SVGProps<SVGSVGElement>) => (
  <>
    <WorkersAiLight className={cn('dark:hidden', className)} {...props} />
    <WorkersAiDark className={cn('hidden dark:block', className)} {...props} />
  </>
)

export const WorkersAiIcon: CompoundIcon = /*#__PURE__*/ Object.assign(WorkersAi, {
  Light: WorkersAiLight,
  Dark: WorkersAiDark,
  Avatar: WorkersAiAvatar,
  colorPrimary: '#F38020'
})

export default WorkersAiIcon
