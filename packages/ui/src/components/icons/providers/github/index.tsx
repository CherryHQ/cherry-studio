import type { SVGProps } from 'react'

import { cn } from '../../../../lib/utils'
import type { CompoundIcon } from '../../types'
import { GithubAvatar } from './avatar'
import { GithubDark } from './dark'
import { GithubLight } from './light'

const Github = ({ className, ...props }: SVGProps<SVGSVGElement>) => (
  <>
    <GithubLight className={cn('dark:hidden', className)} {...props} />
    <GithubDark className={cn('hidden dark:block', className)} {...props} />
  </>
)

export const GithubIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Github, {
  Light: GithubLight,
  Dark: GithubDark,
  Avatar: GithubAvatar,
  colorPrimary: '#000000'
})

export default GithubIcon
