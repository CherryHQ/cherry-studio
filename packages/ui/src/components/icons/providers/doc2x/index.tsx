import type { SVGProps } from 'react'

import { cn } from '../../../../lib/utils'
import type { CompoundIcon } from '../../types'
import { Doc2xAvatar } from './avatar'
import { Doc2xDark } from './dark'
import { Doc2xLight } from './light'

const Doc2x = ({ className, ...props }: SVGProps<SVGSVGElement>) => (
  <>
    <Doc2xLight className={cn('dark:hidden', className)} {...props} />
    <Doc2xDark className={cn('hidden dark:block', className)} {...props} />
  </>
)

export const Doc2xIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Doc2x, {
  Light: Doc2xLight,
  Dark: Doc2xDark,
  Avatar: Doc2xAvatar,
  colorPrimary: '#7748F9'
})

export default Doc2xIcon
