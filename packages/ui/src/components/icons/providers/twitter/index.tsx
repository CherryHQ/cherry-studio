import type { SVGProps } from 'react'

import { cn } from '../../../../lib/utils'
import type { CompoundIcon } from '../../types'
import { TwitterAvatar } from './avatar'
import { TwitterDark } from './dark'
import { TwitterLight } from './light'

const Twitter = ({ className, ...props }: SVGProps<SVGSVGElement>) => (
  <>
    <TwitterLight className={cn('dark:hidden', className)} {...props} />
    <TwitterDark className={cn('hidden dark:block', className)} {...props} />
  </>
)

export const TwitterIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Twitter, {
  Light: TwitterLight,
  Dark: TwitterDark,
  Avatar: TwitterAvatar,
  colorPrimary: '#000000'
})

export default TwitterIcon
