import type { SVGProps } from 'react'

import { cn } from '../../../../lib/utils'
import type { CompoundIcon } from '../../types'
import { GiteeAiAvatar } from './avatar'
import { GiteeAiDark } from './dark'
import { GiteeAiLight } from './light'

const GiteeAi = ({ className, ...props }: SVGProps<SVGSVGElement>) => (
  <>
    <GiteeAiLight className={cn('dark:hidden', className)} {...props} />
    <GiteeAiDark className={cn('hidden dark:block', className)} {...props} />
  </>
)

export const GiteeAiIcon: CompoundIcon = /*#__PURE__*/ Object.assign(GiteeAi, {
  Light: GiteeAiLight,
  Dark: GiteeAiDark,
  Avatar: GiteeAiAvatar,
  colorPrimary: '#000000'
})

export default GiteeAiIcon
