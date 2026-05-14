import type { SVGProps } from 'react'

import { cn } from '../../../../lib/utils'
import type { CompoundIcon } from '../../types'
import { TogetherAvatar } from './avatar'
import { TogetherDark } from './dark'
import { TogetherLight } from './light'

const Together = ({ className, ...props }: SVGProps<SVGSVGElement>) => (
  <>
    <TogetherLight className={cn('dark:hidden', className)} {...props} />
    <TogetherDark className={cn('hidden dark:block', className)} {...props} />
  </>
)

export const TogetherIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Together, {
  Light: TogetherLight,
  Dark: TogetherDark,
  Avatar: TogetherAvatar,
  colorPrimary: '#000000'
})

export default TogetherIcon
