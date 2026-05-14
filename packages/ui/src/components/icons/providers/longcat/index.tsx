import type { SVGProps } from 'react'

import { cn } from '../../../../lib/utils'
import type { CompoundIcon } from '../../types'
import { LongcatAvatar } from './avatar'
import { LongcatDark } from './dark'
import { LongcatLight } from './light'

const Longcat = ({ className, ...props }: SVGProps<SVGSVGElement>) => (
  <>
    <LongcatLight className={cn('dark:hidden', className)} {...props} />
    <LongcatDark className={cn('hidden dark:block', className)} {...props} />
  </>
)

export const LongcatIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Longcat, {
  Light: LongcatLight,
  Dark: LongcatDark,
  Avatar: LongcatAvatar,
  colorPrimary: '#29E154'
})

export default LongcatIcon
