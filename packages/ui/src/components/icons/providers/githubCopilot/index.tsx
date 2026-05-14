import type { SVGProps } from 'react'

import { cn } from '../../../../lib/utils'
import type { CompoundIcon } from '../../types'
import { GithubCopilotAvatar } from './avatar'
import { GithubCopilotDark } from './dark'
import { GithubCopilotLight } from './light'

const GithubCopilot = ({ className, ...props }: SVGProps<SVGSVGElement>) => (
  <>
    <GithubCopilotLight className={cn('dark:hidden', className)} {...props} />
    <GithubCopilotDark className={cn('hidden dark:block', className)} {...props} />
  </>
)

export const GithubCopilotIcon: CompoundIcon = /*#__PURE__*/ Object.assign(GithubCopilot, {
  Light: GithubCopilotLight,
  Dark: GithubCopilotDark,
  Avatar: GithubCopilotAvatar,
  colorPrimary: '#000000'
})

export default GithubCopilotIcon
